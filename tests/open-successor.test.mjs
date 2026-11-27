import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePredecessor,prepareSuccessor,predecessorHash} from '../scripts/prepare-open-successor.mjs';
import {openNativeConfiguration} from '../src/open-research.mjs';

const address=d=>'0x'+d.repeat(40),hash=d=>d.repeat(64);
const problem={deployment:{contract:address('1'),chainId:61999,codeHash:hash('2'),problem:'p-vs-np',repository:'Owner/problem',branch:'research',verifier:address('3'),executor:address('4'),windowSeconds:300,minimumGitHubAccountAgeDays:30,legacyLedgers:[]},policyHash:hash('5'),descriptor:{protocol:{commit:'6'.repeat(40)}},policy:{objective:'Useful open research toward P versus NP.'}};
const config=openNativeConfiguration(problem);
function source(override=()=>undefined){
 let captures=0;
 return async(method,args)=>{
  if(method==='get_config')captures++;
  const custom=override(method,args,captures);if(custom!==undefined)return custom;
  if(method==='get_config')return structuredClone(config);
  if(method==='count_contributions')return '1';
  if(method==='list_contributions')return {items:['pr-7'],total:'1',next_offset:null};
  if(method==='get')return {evidence:{id:'pr-7',contract:address('1'),wallet:address('d')},credited_points:'400'};
  if(method==='get_impact')return {downstream:'pr-7',status:'settled'};
  if(method==='get_points')return {total_awarded:'400',points:'400'};
  assert.fail('Only native view calls are allowed: '+method);
 };
}

test('successor preparation binds two complete reads and carries accounting without new rewards',async()=>{
 const result=await prepareSuccessor({problem,view:source()});
 assert.equal(result.config.predecessor.address,problem.deployment.contract);
 assert.equal(result.config.predecessor.snapshot_hash,predecessorHash(result.snapshot));
 assert.equal(result.manifest.carriedPoints,'400');assert.equal(result.manifest.newRewards,'0');
 assert.deepEqual(result.snapshot.balances.map(x=>x.wallet),[address('d')]);
 assert.equal(result.snapshot.records[0].evidence.contract,problem.deployment.contract);
});

test('hashes match native decimal integer serialization without altering booleans or content',()=>{
 assert.equal(predecessorHash({round:0,nested:[5n,true,'400']}),predecessorHash({round:'0',nested:['5',true,'400']}));
 assert.notEqual(predecessorHash({x:true}),predecessorHash({x:'True'}));
 assert.notEqual(predecessorHash({proof:'a'}),predecessorHash({proof:'b'}));
});

test('incomplete, duplicate, foreign or changing predecessor reads produce no cutover config',async()=>{
 for(const override of [
  method=>method==='count_contributions'?'17':undefined,
  method=>method==='list_contributions'?{items:['pr-7'],total:'2',next_offset:1}:undefined,
  method=>method==='get'?{evidence:{id:'pr-8',contract:address('1'),wallet:address('d')}}:undefined,
  method=>method==='get'?{evidence:{id:'pr-7',contract:address('f'),wallet:address('d')}}:undefined,
  method=>method==='get_impact'?{downstream:'pr-8',status:'settled'}:undefined,
  (method,args,capture)=>method==='get_points'&&capture===2?{total_awarded:'800',points:'800'}:undefined,
 ])await assert.rejects(prepareSuccessor({problem,view:source(override)}),/Successor preparation/);
});

test('capture stops on native read failure and never fabricates a missing record',async()=>{
 await assert.rejects(capturePredecessor({problem,view:source(method=>{if(method==='get')throw Error('native unavailable');})}),/native unavailable/);
});

async function policyFixture(){
 const {sha256}=await import('../src/open-research.mjs');
 const sourceCode=Buffer.from('reviewed pinned source'),p=structuredClone(problem);p.deployment.codeHash=sha256(sourceCode);
 const records=['a','b','c','d'].map((id,index)=>({evidence:{id,contract:p.deployment.contract,policy:p.policyHash,problem:p.deployment.problem,repository:p.deployment.repository,branch:p.deployment.branch,wallet:address('d'),evidence_kind:'formal'},
  status:['credited','rejected','expired','credited'][index],round:0,challenges:[],challenge_reviews:[],adjudication_started_round:0,adjudication_finished_round:index===2?-1:0,
  credited_points:[0,3].includes(index)?'400':'0',verdict:index===2?null:{accept:[0,3].includes(index)},...([0,3].includes(index)?{reserve_settled:true,reserve_returned:'80',impact_reserve:'80',award_budget:'400'}:{})}));
 const impacts=records.map(r=>r.status==='credited'?{downstream:r.evidence.id,status:'settled',allocations:[],paid_points:'0'}:{downstream:r.evidence.id,status:'not-requested'});
 const state={config:openNativeConfiguration(p),records,impacts};let captures=0;
 const view=async(method,args)=>{if(method==='get_config'){captures++;return structuredClone(state.config);}if(method==='count_contributions')return records.length;if(method==='list_contributions')return {items:records.map(r=>r.evidence.id),total:records.length,next_offset:null};if(method==='get')return structuredClone(records.find(r=>r.evidence.id===args[0]));if(method==='get_impact')return structuredClone(impacts.find(i=>i.downstream===args[0]));if(method==='get_inheritance')return {inherited:false};if(method==='get_points')return {points:'800',total_awarded:'800'};assert.fail(method);};
 return {problem:p,sourceCode,view,state,newPolicy:hash('f'),creditedOrder:['a','d'],semanticFences:records.map((r,i)=>({id:r.evidence.id,statement_hash:String(i+1).repeat(64)})),captures:()=>captures};
}

test('policy upgrade plan binds all original records, semantic fences and the reviewed source bytes',async()=>{
 const {preparePolicySuccessor}=await import('../scripts/prepare-open-successor.mjs');
 const fixture=await policyFixture(),result=await preparePolicySuccessor(fixture);
 assert.equal(fixture.captures(),2);assert.equal(result.config.policy,fixture.newPolicy);
 assert.equal(result.config.predecessor.source_policy,fixture.problem.policyHash);
 assert.equal(result.manifest.carriedPoints,'800');assert.equal(result.manifest.newRewards,'0');
 assert.deepEqual(result.snapshot.records,fixture.state.records);
 assert.deepEqual(result.config.predecessor.semantic_fences,fixture.semanticFences);
 assert.equal(result.config.predecessor.records[2].record_hash,predecessorHash(fixture.state.records[2]));
});

test('policy upgrade refuses unreviewed source, incomplete identities and unsupported live histories',async()=>{
 const {preparePolicySuccessor}=await import('../scripts/prepare-open-successor.mjs');
 for(const change of [f=>f.sourceCode=Buffer.from('other'),f=>f.semanticFences.pop(),f=>f.semanticFences[1].statement_hash=f.semanticFences[0].statement_hash,f=>f.creditedOrder=['a'],f=>f.state.records[2].status='submitted',f=>f.state.records[0].reserve_settled=false]){
  const f=await policyFixture();change(f);await assert.rejects(preparePolicySuccessor(f),/Successor preparation/);
 }
 const f=await policyFixture(),underlying=f.view;f.view=async(method,args)=>{const result=await underlying(method,args);return method==='get_points'&&f.captures()===2?{points:'801',total_awarded:'801'}:result;};
 await assert.rejects(preparePolicySuccessor(f),/source changed/);
});


test('native decimal-string policy predecessor version normalizes only at the read boundary',async()=>{
 const {preparePolicySuccessor,capturePolicyPredecessor}=await import('../scripts/prepare-open-successor.mjs');
 const {assertOpenConfiguration,validateOpenConstructor}=await import('../src/open-research.mjs');
 const fixture=await policyFixture(),result=await preparePolicySuccessor(fixture);
 const actual=structuredClone(result.config);actual.predecessor.version='2';
 assert.equal(assertOpenConfiguration(actual,result.config),actual);
 assert.throws(()=>validateOpenConstructor(actual),/predecessor/);
 const upgraded={...fixture.problem,policyHash:fixture.newPolicy,deployment:{...fixture.problem.deployment,contract:address('e'),predecessor:result.config.predecessor}};
 await assert.rejects(capturePolicyPredecessor({problem:upgraded,view:async(method)=>{assert.equal(method,'get_config');return actual;}}),/cumulative semantic fence/);
});
