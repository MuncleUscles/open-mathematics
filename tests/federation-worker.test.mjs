import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../src/security.mjs';
import {federationCaseAttestation,processAttribution,routedImpactCall,nativeExternalEvidence,federationJournalFile,authorClaimPreflight} from '../github/federation-worker.mjs';
import {readEvidenceFile} from '../github/evidence-file.mjs';
const evidence={repository_id:123,pr:4,github_author_id:56,statement:'untrusted source text'};
const source={id:'external-a',evidence,source_hash:digest(evidence)};
const base=()=>({id:'attribution-a',target:'proof-a',status:'submitted',revision:'0',round:'0',started_round:'-1',request_hash:'a'.repeat(64),request:{sources:[{id:source.id,source_hash:source.source_hash}]}});
test('identity preflight avoids poisoning exact settlement intent during its challenge window',()=>{
 const claim={status:'provisional',expiry:900,deadline:300};
 assert.equal(authorClaimPreflight(claim,{operation:'settle',windowSeconds:300,now:0}).wait,true);
 assert.deepEqual(authorClaimPreflight(claim,{operation:'settle',windowSeconds:300,now:303000}),{recoverOnly:false});
 assert.throws(()=>authorClaimPreflight(claim,{operation:'settle',windowSeconds:300,now:900000}),/Unexpired/);
 assert.throws(()=>authorClaimPreflight({...claim,status:'submitted',expiry:300},{operation:'verify',windowSeconds:300,now:0}),/full challenge/);
 assert.deepEqual(authorClaimPreflight({...claim,status:'settled'},{operation:'settle',windowSeconds:300,now:999000}),{recoverOnly:true});
 assert.deepEqual(authorClaimPreflight(claim,{operation:'settle',windowSeconds:300,hasIntent:true,now:999000}),{recoverOnly:false});
});
test('workflow journal namespace is accepted by the actual durable evidence reader',async()=>{
 const file=federationJournalFile('0x'+'A'.repeat(40),'b'.repeat(64)+'.json');
 let requested;
 assert.equal(await readEvidenceFile({request:async path=>{requested=path;throw Error('GitHub 404');}},file),null);
 assert.equal(requested,'/contents/'+file+'?ref=evidence');
 assert.throws(()=>federationJournalFile('0x'+'a'.repeat(40),'../index.json'),/identity/);
});
test('admission binds exact source bytes and excludes an allocation opinion',()=>{
 const a=federationCaseAttestation(base(),[source]);
 assert.equal(a.revision,0);assert.deepEqual(Object.keys(a).sort(),['basis','case_id','request_hash','revision','sources']);
 assert.throws(()=>federationCaseAttestation(base(),[{...source,evidence:{...evidence,github_author_id:57}}]),/commitment/);
 assert.throws(()=>federationCaseAttestation(base(),[]),/Exact/);
 assert.deepEqual(nativeExternalEvidence({...evidence,pr:'4'}),evidence);
 assert.throws(()=>nativeExternalEvidence({...evidence,pr:'9007199254740992'}),/Safe/);
});
test('undetermined review stops after persisted begin and is not settled or retried',async()=>{
 const c={...base(),status:'verified',attestation_hash:'b'.repeat(64)},calls=[];
 await assert.rejects(processAttribution({id:c.id,read:async()=>c,tx:async(_role,_stage,method)=>{calls.push(method);if(method==='review_attribution')throw Error('UNDETERMINED');}}),/UNDETERMINED/);
 assert.deepEqual(calls,['begin_attribution_review','review_attribution']);
});
test('challenge window only verifies original receipt and returns a resume time',async()=>{
 const c={...base(),status:'provisional',deadline:100,attestation_hash:'b'.repeat(64)},calls=[];
 const result=await processAttribution({id:c.id,read:async()=>c,now:()=>0,tx:async(...args)=>calls.push(args)});
 assert.equal(result.status,'challenge-window');assert.equal(calls.length,1);assert.equal(calls[0][2],'review_attribution');assert.equal(calls[0][4],true);
});
test('settlement exact call names bind the reconciled routing revision',()=>{
 assert.deepEqual(routedImpactCall('c',{round:'1'}),{stage:'settle-impact-r1',method:'settle_impact',args:['c',1]});
 const call=routedImpactCall('c',{round:'1',routing_revision:'2',route_commitments_hash:'d'.repeat(64)});
 assert.equal(call.method,'settle_impact_routed');assert.deepEqual(call.args,['c',1,2,'d'.repeat(64)]);
 assert.throws(()=>routedImpactCall('c',{round:1,routing_revision:2}),/commitment/);
 assert.throws(()=>routedImpactCall('c',{round:1,routing_revision:-1}),/revision/);
});

test('expired review releases routing without recovering or replacing a failed judgment',async()=>{
 for(const status of ['verified','challenged']){
  const c={...base(),status,round:status==='challenged'?1:0,started_round:status==='challenged'?1:0,attestation_hash:'b'.repeat(64),review_deadline:100};
  const calls=[],attribution={revision:0,initial_pool:'300'};
  const result=await processAttribution({id:c.id,now:()=>102000,read:async(method)=>method==='get_attribution'?attribution:{...c},tx:async(...args)=>{calls.push(args);assert.equal(args[2],'expire_attribution');c.status='expired';}});
  assert.equal(result.status,'expired');assert.deepEqual(result.attribution,attribution);
  assert.deepEqual(calls.map(x=>x.slice(0,4)),[['executor',`expire-r${c.round}`,'expire_attribution',[c.id,c.round,c.attestation_hash]]]);
  calls.length=0;
  assert.equal((await processAttribution({id:c.id,read:async(method)=>method==='get_attribution'?attribution:{...c},tx:async()=>assert.fail('no writes for terminal expiry')})).status,'expired');
 }
});
test('expiry cannot race a provisional success into settlement or a new judgment',async()=>{
 const c={...base(),status:'verified',round:0,started_round:0,attestation_hash:'b'.repeat(64),review_deadline:100};
 const calls=[];
 await assert.rejects(processAttribution({id:c.id,now:()=>102000,read:async()=>({...c}),tx:async(...args)=>{calls.push(args);c.status='provisional';throw Error('unfinished attribution review deadline must elapse');}}),/unfinished attribution/);
 assert.equal(calls.length,1);assert.equal(calls[0][2],'expire_attribution');
});
test('before expiry, a started review remains recovery-only and its terminal failure is retained',async()=>{
 const c={...base(),status:'verified',round:0,started_round:0,attestation_hash:'b'.repeat(64),review_deadline:100};
 const calls=[];
 await assert.rejects(processAttribution({id:c.id,now:()=>101999,read:async()=>({...c}),tx:async(...args)=>{calls.push(args);if(args[2]==='review_attribution')throw Error('original UNDETERMINED');}}),/original UNDETERMINED/);
 assert.deepEqual(calls.map(x=>[x[2],x[4]]),[['begin_attribution_review',true],['review_attribution',true]]);
});
