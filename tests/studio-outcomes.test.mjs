import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {abi,isSuccessful} from 'genlayer-js';
import {verifyFinalizedOutcome,verifyReceipt} from '../src/studio.mjs';
import {finalized,finalizedExecutionFailure,FinalizedExecutionError,studioTransactionStatus} from '../github/runtime.mjs';
import {recoverReceipt} from '../github/receipt-recovery.mjs';
import {journaledTransaction} from '../github/journaled-transaction.mjs';
import {blockedOpenConsensus} from '../github/open-worker.mjs';

const observations=JSON.parse(fs.readFileSync(new URL('fixtures/studio-consensus-outcomes.json',import.meta.url)));
const address='0x'+'1'.repeat(40),sender='0x'+'2'.repeat(40),args=['contribution-id',0],method='adjudicate';
const encoded=Buffer.from(abi.calldata.encode({method,args}));
const bound=name=>({...structuredClone(observations[name]),from_address:sender,to_address:address,data:{calldata:{raw:[...encoded]}}});
const expected=r=>({hash:r.hash,address,sender,method,args,independent:true});
const provider=r=>({getTransaction:async()=>r,request:async()=>[{hash:r.hash,type:2,from_address:sender,to_address:address,data:{calldata:encoded.toString('base64')}}]});

test('observed current acceptance and historical accepted consensus both retain exact-call verification',async()=>{
 for(const name of ['modernAccepted','legacyAccepted']){
  const r=bound(name);assert.equal(verifyReceipt(r,expected(r)),true);
  assert.deepEqual(await finalized(provider(r),r.hash,expected(r)),r);
  assert.equal((await recoverReceipt(provider(r),expected(r))).hash,r.hash);
  assert.throws(()=>verifyReceipt(r,{...expected(r),args:['different',0]}),/Wrong contract method/);
 }
 const raw=bound('modernAccepted');delete raw.lifecycle;
 assert.equal(verifyReceipt(raw,expected(raw)),true,'raw RPC has explicit consensus and execution without SDK lifecycle');
});

test('actual finalized C disagreement cannot pass any authority path despite leader success and one agreeing validator',async()=>{
 const r=bound('modernUndetermined');
 assert.equal(isSuccessful(r),true,'SDK execution helper alone does not establish accepted Studio consensus');
 assert.throws(()=>verifyReceipt(r,expected(r)),{code:'STUDIO_FINALIZED_OUTCOME_INVALID'});
 for(const binding of [undefined,expected(r)])await assert.rejects(finalized(provider(r),r.hash,binding),{code:'STUDIO_FINALIZED_OUTCOME_INVALID'});
 await assert.rejects(recoverReceipt(provider(r),expected(r)),{code:'STUDIO_MATCH_INVALID',hash:r.hash});
 let writes=0,saves=0;const client={...provider(r),account:{address:sender},writeContract:async()=>{writes++;throw Error('must not write');}};
 const transactions={};
 const run=()=>journaledTransaction({client,address,sender,method,args,independent:true,transactions,stage:'adjudicate-r0',save:async()=>{saves++;}});
 await assert.rejects(run(),{code:'STUDIO_MATCH_INVALID'});
 assert.equal(transactions['adjudicate-r0'].hash,r.hash);assert.equal(saves,1);
 await assert.rejects(run(),error=>blockedOpenConsensus(error)&&error.code==='STUDIO_FINALIZED_OUTCOME_INVALID');
 assert.equal(writes,0);assert.equal(transactions['adjudicate-r0'].receipt,undefined);assert.equal(transactions['adjudicate-r0'].failedReceipt,undefined);
});

test('unknown, missing, conflicting and mixed-era outcomes fail closed',()=>{
 for(const update of [
  {result:0},{result:2},{result:3},{result:4},{result:5},{result:6},{result:99},{result:'1'},
  {result_name:'MAJORITY_DISAGREE'},{resultName:'MAJORITY_DISAGREE'},
  {status:'UNDETERMINED'},{status_name:'ACCEPTED'},
  {lifecycle:{state:'finalized'}},{lifecycle:{state:'finalized',outcome:'undetermined'}},{lifecycle:{state:'decided',outcome:'accepted'}},{lifecycle:null},
  {txExecutionResult:2},{txExecutionResultName:'FINISHED_WITH_ERROR'},{txExecutionResult:undefined},
 ])assert.throws(()=>verifyFinalizedOutcome({...bound('modernAccepted'),...update}),{code:'STUDIO_FINALIZED_OUTCOME_INVALID'});
 for(const field of ['result','result_name','txExecutionResult','txExecutionResultName']){
  const r=bound('modernAccepted');delete r[field];assert.throws(()=>verifyFinalizedOutcome(r),{code:'STUDIO_FINALIZED_OUTCOME_INVALID'},field);
 }
 for(const update of [{result:7},{result:1},{result_name:'AGREE'},{lifecycle:undefined},{lifecycle:{state:'finalized',outcome:'accepted'}},{txExecutionResult:1}])
  assert.throws(()=>verifyFinalizedOutcome({...bound('legacyAccepted'),...update}),{code:'STUDIO_FINALIZED_OUTCOME_INVALID'});
 const missing=bound('legacyAccepted');delete missing.result;delete missing.result_name;
 assert.throws(()=>verifyFinalizedOutcome(missing),{code:'STUDIO_FINALIZED_OUTCOME_INVALID'});
});

test('only agreed contract execution errors may become terminal registration rejections',async()=>{
 const args=['exact evidence'],data={calldata:{raw:[...abi.calldata.encode({method:'register',args})]}};
 for(const name of ['modernAccepted','legacyAccepted']){
  const r={...bound(name),data,consensus_data:{leader_receipt:[{execution_result:'ERROR',result:{status:'rollback',payload:'UserError: signed claim already registered'}}]}};
  if(name==='modernAccepted'){r.txExecutionResult=2;r.txExecutionResultName='FINISHED_WITH_ERROR';}
  const e={hash:r.hash,address,sender,method:'register',args};
  const failure=finalizedExecutionFailure(r,e);
  assert(failure instanceof FinalizedExecutionError);assert.equal(failure.reason,'signed claim already registered');
  assert.equal(failure.receipt.result,r.result);
  assert.throws(()=>verifyFinalizedOutcome(r),{code:'STUDIO_FINALIZED_OUTCOME_INVALID'});
  const disputed={...r,result:name==='modernAccepted'?2:7,result_name:'MAJORITY_DISAGREE'};
  assert.throws(()=>finalizedExecutionFailure(disputed,e),{code:'STUDIO_FINALIZED_OUTCOME_INVALID'});
  await assert.rejects(finalized(provider(disputed),r.hash,e),error=>!(error instanceof FinalizedExecutionError)&&blockedOpenConsensus(error));
 }
});


test('malformed receipt objects are classified as blocked rather than resumable TypeErrors',async()=>{
 for(const receipt of [null,undefined,[],7,'FINALIZED',{}, {statusName:'UNKNOWN'}]){
  assert.throws(()=>verifyFinalizedOutcome(receipt),{code:'STUDIO_FINALIZED_OUTCOME_INVALID'});
  await assert.rejects(finalized({getTransaction:async()=>receipt},observations.modernUndetermined.hash),error=>
   error.code==='STUDIO_FINALIZED_OUTCOME_INVALID'&&blockedOpenConsensus(error));
 }
});


test('recovery preserves a matching hash with missing or unknown status without treating it as resumable progress',async()=>{
 for(const changes of [{status:undefined,statusName:undefined},{statusName:'UNKNOWN'},{statusName:'PENDING'}]){
  const receipt={...bound('modernAccepted'),...changes};
  await assert.rejects(recoverReceipt(provider(receipt),expected(receipt)),error=>
   error.code==='STUDIO_MATCH_INVALID'&&error.hash===receipt.hash&&blockedOpenConsensus(error));
 }
 for(const status of ['PENDING','PROPOSING','COMMITTING','REVEALING','ACCEPTED','APPEAL_COMMITTING','APPEAL_REVEALING','LEADER_REVEALING'])
  assert.equal(studioTransactionStatus({statusName:status}),status,'valid in-progress receipts need no outcome fields');
});
