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
