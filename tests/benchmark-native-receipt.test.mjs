import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {abi} from 'genlayer-js';
import {checkNativeBenchmarkCapture} from '../scripts/check-benchmark-native.mjs';

const root=resolve('fixtures/benchmark/captures/federation-2026-11-24');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(caseId='A'){
 const capture=JSON.parse(await readFile(resolve(root,'native',caseId+'.capture.json'),'utf8'));
 const prompt=await readFile(resolve(root,'inputs',caseId+'.prompt.txt'),'utf8');
 return {capture,prompt};
}
const decoded=value=>abi.calldata.decode(Buffer.from(typeof value==='string'?value:value.raw,'base64').subarray(1));
const encoded=value=>Buffer.concat([Buffer.from([0]),Buffer.from(abi.calldata.encode(value))]).toString('base64');

test('frozen A and B native judgments pass the actual journal checker and bind their exact prompt',async()=>{
 for(const [caseId,accept,budget] of [['A',false,'0'],['B',true,'300']]){
  const input=await fixture(caseId),before=structuredClone(input.capture);
  const result=await checkNativeBenchmarkCapture(input);
  assert.equal(result.outcome.accept,accept);assert.equal(result.award,budget);
  for(const field of ['novelty','significance','reusability'])assert.equal(result.outcome[field],accept?1:0);
  assert.equal(result.validation.receipt_reads,1);assert.equal(result.validation.network_calls,0);
  assert.equal(result.validation.exact_call_and_sender_verified,true);
  assert.equal(result.validation.independent_validator_agreement,true);
  assert.equal(result.validation.independent_validator_model_responses_captured,false);
  assert.equal(result.validation.full_protocol_completion_claimed,false);
  assert.equal(result.validation.distinct_validator_count,null);
  assert.deepEqual(input.capture,before,'checking a frozen receipt must not mutate the capture');
 }
});

test('rejects unresolved native finality immediately instead of polling or trusting a success label',async()=>{
 for(const change of [{status:5},{result_name:'MAJORITY_UNDETERMINED'},{txExecutionResult:2},{leader_only:true}]){
  const input=await fixture();Object.assign(input.capture.journal.receipt,change);
  await assert.rejects(checkNativeBenchmarkCapture(input),/Invalid finalized/);
 }
});

test('journal verification rejects a wrong sender, method, hash, round or ABI integer type',async()=>{
 for(const mutate of [
  c=>{c.journal.receipt.from_address='0x'+'1'.repeat(40);},
  c=>{c.journal.intent.method='finalize';},
  c=>{c.journal.hash='0x'+'1'.repeat(64);},
  c=>{c.journal.receipt.data.calldata.raw=[...abi.calldata.encode({method:'adjudicate',args:[c.submission_id,1]})];},
  c=>{c.journal.receipt.data.calldata.raw=[...abi.calldata.encode({method:'adjudicate',args:[c.submission_id,'0']})];},
 ]){
  const input=await fixture();mutate(input.capture);
  await assert.rejects(checkNativeBenchmarkCapture(input),/sender|intent|Invalid finalized execution receipt|Wrong contract method/);
 }
});

test('rejects unbound prompts, evidence digests, record verdicts and source revisions',async()=>{
 for(const mutate of [
  x=>{x.prompt+=' ';},
  x=>{x.capture.record.digest='0'.repeat(64);},
  x=>{x.capture.record.verdict.reason='A changed reason is not the judgment returned by this transaction.';},
  x=>{x.capture.source_code_sha256='0'.repeat(64);},
  x=>{x.capture.record.round=1;},
 ]){
  const input=await fixture();mutate(input);
  await assert.rejects(checkNativeBenchmarkCapture(input),/prompt hash|evidence digest|native record verdict|unreviewed|initial adjudication/);
 }
});

test('does not silently convert stringified original registration integers into prompt integers',async()=>{
 const input=await fixture(),e=JSON.parse(input.capture.evidence_json);
 e.pr=String(e.pr);input.capture.evidence_json=JSON.stringify(e);input.capture.record.evidence=e;
 input.capture.record.digest=hash(input.capture.evidence_json);
 const marker='\nUNTRUSTED_DATA=',index=input.prompt.indexOf(marker),data=JSON.parse(input.prompt.slice(index+marker.length));
 data.submission.pr=e.pr;input.prompt=input.prompt.slice(0,index+marker.length)+JSON.stringify(data);
 input.capture.prompt_sha256=hash(input.prompt);
 await assert.rejects(checkNativeBenchmarkCapture(input),/original registration integer type lost/);
});

test('checks actual successful validator return bytes, including later duplicate entries',async()=>{
 const input=await fixture();
 const validators=input.capture.journal.receipt.consensus_data.validators;
 const successful=validators.filter(v=>v.mode==='validator'&&v.vote==='agree'&&v.execution_result==='SUCCESS');
 assert.ok(successful.length>=1);
 const corrupt=structuredClone(successful[0]),value=decoded(corrupt.result);
 value.set('reason','The validator return was changed despite preserving its agree vote and success flag.');
 corrupt.result=encoded(value);validators.push(corrupt);
 await assert.rejects(checkNativeBenchmarkCapture(input),/agreeing validator return differs/);
});

test('requires successful validator agreement and the actual first nondeterministic output',async()=>{
 const missing=await fixture();missing.capture.journal.receipt.consensus_data.validators=[];
 await assert.rejects(checkNativeBenchmarkCapture(missing),/Independent adjudication required/);
 const changed=await fixture();
 const leader=changed.capture.journal.receipt.consensus_data.leader_receipt[0],value=decoded(leader.eq_outputs['0']);
 value.set('reason','This changes the actual model output while leaving the transaction return intact.');
 leader.eq_outputs['0']=encoded(value);
 await assert.rejects(checkNativeBenchmarkCapture(changed),/nondeterministic output differs/);
 const rollback=await fixture();
 rollback.capture.journal.receipt.consensus_data.leader_receipt[0].result='AmlkbGU=';
 await assert.rejects(checkNativeBenchmarkCapture(rollback),/successful ABI return required/);
});
