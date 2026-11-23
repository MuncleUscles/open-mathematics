import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import {message} from '../src/security.mjs';
import {sha256} from '../src/open-research.mjs';
import {openBuildPlan} from '../github/open-build-plan.mjs';

const account=privateKeyToAccount('0x'+'37'.repeat(32));
const createdAt='2026-11-23T21:00:00.000Z';
const baseRecord={schema_version:3,problem:'p-vs-np',kind:'research-note',title:'A supported limitation in the proposed reduction',
 claim:'This note identifies a specific missing assumption in a proposed reduction and explains its consequences.',
 novelty:'The note isolates a previously unstated premise; it makes no formal verification or discovery claim.',
 prior_art:[],research_direction:'Assumptions and limits of proposed reductions',
 provenance:{mode:'extension',sources:[],discovery_basis:'This is a controlled integration fixture, with no exhaustive literature search or mathematical priority claim.'},
 evidence:{kind:'research-note',artifact_path:'research/notes/example.md',reproduce:'Read the argument and inspect its explicit assumptions and references.'},
 dependencies:[],attribution:{wallet:account.address,contributions:'The test author wrote this bounded, explicitly nonformal argument.'},
 limitations:'This is not a formal theorem or a solution to P versus NP and promises no points.'};

async function fixture({record=structuredClone(baseRecord),claimChanges={},bytes}={}){
 bytes??=Buffer.from(JSON.stringify(record,null,2)+'\n');
 const problem={descriptor:{id:'p-vs-np',protocol:{commit:'a'.repeat(40)}},policyHash:'b'.repeat(64),
  deployment:{origin:'https://example.test',chainId:61999,problem:'p-vs-np',repository:'owner/problem',branch:'research',contract:'0x'+'1'.repeat(40)}};
 const claim={version:4,domain:problem.deployment.origin,chainId:61999,problem:'p-vs-np',repository:'owner/problem',pr:22,
  head:'c'.repeat(40),base:'d'.repeat(40),branch:'research',contract:problem.deployment.contract,policy:problem.policyHash,
  submission_path:'research/submissions/example.json',submission_hash:sha256(bytes),wallet:account.address,
  nonce:'e'.repeat(32),expires:Date.parse(createdAt)+540000,protocol_commit:problem.descriptor.protocol.commit,...claimChanges};
 const candidate={claim,createdAt,envelope:{claim,signature:await account.signMessage({message:message(claim)})}};
 const blob={type:'file',path:claim.submission_path,sha:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
  size:bytes.length,encoding:'base64',content:bytes.toString('base64')};
 const calls=[],github={repository:problem.deployment.repository,request:async(route,options)=>{calls.push({route,options});return blob;}};
 return {problem,candidate,github,blob,calls};
}

test('only an exact signed valid note skips Lean, using one bounded immutable-head read',async()=>{
 const f=await fixture();assert.deepEqual(await openBuildPlan(f),{needs_lean:false});
 assert.deepEqual(f.calls,[{route:`/contents/research/submissions/example.json?ref=${'c'.repeat(40)}`,options:{maxResponseBytes:32768}}]);
 const record={...structuredClone(baseRecord),kind:'lemma',evidence:{kind:'formal',artifact_path:'research/artifacts/example.json',reproduce:'Run the trusted full Lean proof verifier with the pinned environment.'}};
 assert.deepEqual(await openBuildPlan(await fixture({record})),{needs_lean:true});
});

test('changed content, signed hash, path, metadata or noncanonical base64 always keeps Lean',async()=>{
 for(const mutate of [
  f=>f.blob.content=Buffer.from('changed immutable bytes').toString('base64'),
  f=>f.blob.sha='f'.repeat(40),f=>f.blob.size++,f=>f.blob.size=16001,
  f=>f.blob.path='research/submissions/other.json',f=>f.blob.type='symlink',
  f=>f.blob.target='another-file',f=>f.blob.submodule_git_url='https://example.test/repo',
  f=>f.blob.encoding='none',f=>f.blob.content+='!',
 ]){const f=await fixture();mutate(f);assert.deepEqual(await openBuildPlan(f),{needs_lean:true});}
 const differentHash=await fixture({claimChanges:{submission_hash:'f'.repeat(64)}});
 assert.deepEqual(await openBuildPlan(differentHash),{needs_lean:true});
});

test('unchecked kind, wrong wallet, mismatched artifact slug and malformed record cannot skip the build',async()=>{
 for(const record of [
  {...structuredClone(baseRecord),schema_version:99},
  {...structuredClone(baseRecord),attribution:{wallet:'0x'+'2'.repeat(40),contributions:baseRecord.attribution.contributions}},
  {...structuredClone(baseRecord),evidence:{...baseRecord.evidence,artifact_path:'research/notes/other.md'}},
  {...structuredClone(baseRecord),extra:'unchecked'},
 ])assert.deepEqual(await openBuildPlan(await fixture({record})),{needs_lean:true});
 for(const bytes of [Buffer.from('{"evidence":{"kind":"research-note"}}'),Buffer.from([0xff,0xfe]),Buffer.alloc(16001,32)])
  assert.deepEqual(await openBuildPlan(await fixture({bytes})),{needs_lean:true});
});

test('unbound claims and path injection cannot even request contribution data',async()=>{
 for(const changes of [{submission_path:'research/submissions/../example.json'}, {head:'main'},
  {repository:'attacker/repository'}, {protocol_commit:'f'.repeat(40)}]){
  const f=await fixture({claimChanges:changes});assert.deepEqual(await openBuildPlan(f),{needs_lean:true});assert.equal(f.calls.length,0);
 }
 const f=await fixture();f.candidate.envelope.signature='0x'+'0'.repeat(130);
 assert.deepEqual(await openBuildPlan(f),{needs_lean:true});assert.equal(f.calls.length,0);
 const g=await fixture();g.candidate.envelope={...g.candidate.envelope,claim:{...g.candidate.claim,submission_hash:'f'.repeat(64)}};
 assert.deepEqual(await openBuildPlan(g),{needs_lean:true});assert.equal(g.calls.length,0);
 assert.deepEqual(await openBuildPlan(),{needs_lean:true});
});

test('API uncertainty, rate limits and missing content preserve existing verification and never retry',async()=>{
 for(const failure of ['GitHub 404','GitHub 429','GitHub response exceeds the byte limit']){
  const f=await fixture();let calls=0;f.github.request=async()=>{calls++;throw Error(failure);};
  assert.deepEqual(await openBuildPlan(f),{needs_lean:true});assert.equal(calls,1);
 }
 const f=await fixture();f.github.request=async()=>null;assert.deepEqual(await openBuildPlan(f),{needs_lean:true});
});
