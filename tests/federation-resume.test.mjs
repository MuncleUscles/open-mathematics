import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {abi} from 'genlayer-js';
import {processAttribution} from '../github/federation-worker.mjs';
import {journaledFederationTransaction} from '../github/federation-transaction.mjs';

const address='0x'+'1'.repeat(40),sender='0x'+'2'.repeat(40),attestation='a'.repeat(64);
const initial=()=>({id:'attribution-a',target:'proof-a',status:'verified',round:'0',started_round:'-1',finished_round:'-1',attestation_hash:attestation});
const encode=(method,args)=>Buffer.from(abi.calldata.encode({method,args}));
const transactionHash=(method,args)=>'0x'+createHash('sha256').update(encode(method,args)).digest('hex');

// Exercise the production journal and receipt verifier, including durable intent
// saves and actual write counts. No Studio client or network access is involved.
function harness(c=initial(),transactions={}){
 const state={c:structuredClone(c),transactions,history:[],receipts:new Map(),writes:[],calls:[],saved:[],beginStatus:'FINALIZED',reviewStatus:'FINALIZED',crashBeforeReview:false};
 const client={
  account:{address:sender},
  request:async request=>{
   assert.deepEqual(request,{method:'sim_getTransactionsForAddress',params:[address]});
   return structuredClone(state.history);
  },
  getTransaction:async({hash})=>{
   const receipt=state.receipts.get(hash);assert.ok(receipt,'known native transaction required');
   const call=abi.calldata.decode(Buffer.from(receipt.data.calldata.raw));
   if(receipt.statusName==='FINALIZED'&&call.get('method')==='begin_attribution_review')state.c.started_round=String(call.get('args')[1]);
   if(receipt.statusName==='FINALIZED'&&call.get('method')==='review_attribution'){
    state.c.status='provisional';state.c.finished_round=state.c.round;state.c.deadline=100;
   }
   return structuredClone(receipt);
  },
  writeContract:async({address:target,functionName:method,args,leaderOnly})=>{
   assert.equal(target,address);assert.equal(leaderOnly,false);
   const stage=(method==='begin_attribution_review'?'begin':'review')+'-r'+args[1];
   assert.ok(state.saved.at(-1)?.[stage]?.intent,'persist exact intent before broadcasting');
   state.writes.push({method,args});
   const hash=transactionHash(method,args),calldata=encode(method,args);
   state.receipts.set(hash,{hash,from_address:sender,to_address:address,
    statusName:method==='review_attribution'?state.reviewStatus:state.beginStatus,
    result:6,result_name:'MAJORITY_AGREE',leader_only:false,data:{calldata:{raw:[...calldata]}},
    consensus_data:{leader_receipt:[{execution_result:'SUCCESS'}],validators:[{mode:'validator',vote:'agree',execution_result:'SUCCESS'}]}});
   state.history.push({type:2,hash,from_address:sender,to_address:address,data:{calldata:calldata.toString('base64')}});
   if(method==='begin_attribution_review')state.c.started_round=state.c.round;
   return hash;
  },
 };
 const tx=async(role,stage,method,args,recoverOnly=false,onBroadcast)=>{
  assert.equal(role,'executor');state.calls.push({stage,method,args,recoverOnly});
  if(state.crashBeforeReview&&method==='review_attribution')throw Error('crash before review intent');
  return journaledFederationTransaction({client,address,sender,method,args,independent:method==='review_attribution',transactions:state.transactions,stage,recoverOnly,onBroadcast,
   save:async()=>state.saved.push(structuredClone(state.transactions))});
 };
 const run=()=>processAttribution({id:state.c.id,read:async(method,args)=>{
  assert.equal(method,'get_attribution_case');assert.deepEqual(args,[state.c.id]);return structuredClone(state.c);
 },tx,now:()=>0});
 return {state,run,tx};
}

test('the production adapter notifies only after a new begin has a saved verified receipt',async()=>{
 const h=harness(),notified=[],args=[h.state.c.id,0,attestation];
 const onBroadcast=hash=>{
  const saved=h.state.saved.at(-1)['begin-r0'];
  assert.equal(saved.hash,hash);assert.equal(saved.receipt.statusName,'FINALIZED');
  notified.push(hash);
 };
 await h.tx('executor','begin-r0','begin_attribution_review',args,false,onBroadcast);
 assert.equal(notified.length,1);
 await h.tx('executor','begin-r0','begin_attribution_review',args,true,()=>assert.fail('journal recovery cannot notify'));
 h.state.transactions={};
 await h.tx('executor','begin-r0','begin_attribution_review',args,true,()=>assert.fail('history recovery cannot notify'));
 assert.equal(h.state.writes.length,1);
});

test('an unverified begin receipt cannot authorize a fresh review through the production adapter',async()=>{
 const h=harness();h.state.beginStatus='UNDETERMINED';
 await assert.rejects(h.tx('executor','begin-r0','begin_attribution_review',[h.state.c.id,0,attestation],false,
  ()=>assert.fail('an unresolved begin must not notify')),/Transaction UNDETERMINED/);
 assert.equal(h.state.transactions['begin-r0'].receipt,undefined);
 assert.equal(h.state.transactions['review-r0'],undefined);
});

test('an unstarted round broadcasts begin and review once, then only verifies the review receipt',async()=>{
 const h=harness();
 assert.equal((await h.run()).status,'challenge-window');
 assert.deepEqual(h.state.writes.map(x=>x.method),['begin_attribution_review','review_attribution']);
 assert.deepEqual(h.state.calls.map(x=>[x.stage,x.recoverOnly]),[['begin-r0',false],['review-r0',false],['review-r0',true]]);
 assert.equal(h.state.c.started_round,'0');assert.equal(h.state.c.finished_round,'0');
});

test('a started round recovers the same successful journal without another broadcast',async()=>{
 const h=harness();await h.run();
 const saved=structuredClone(h.state.transactions);
 // The first native read can still show an unfinished round; rechecking the
 // existing review receipt and reading again observes its provisional state.
 Object.assign(h.state.c,{status:'verified',finished_round:'-1'});
 h.state.writes=[];h.state.calls=[];h.state.history=[];
 assert.equal((await h.run()).status,'challenge-window');
 assert.deepEqual(h.state.writes,[]);
 assert.deepEqual(h.state.calls.map(x=>[x.stage,x.recoverOnly]),[['begin-r0',true],['review-r0',true],['review-r0',true]]);
 assert.deepEqual(h.state.transactions,saved);
});

test('a started undetermined round preserves its original journal hash and never rerolls',async()=>{
 const h=harness();h.state.reviewStatus='UNDETERMINED';
 await assert.rejects(h.run(),/Transaction UNDETERMINED/);
 const original=structuredClone(h.state.transactions);
 h.state.writes=[];h.state.calls=[];h.state.history=[];
 await assert.rejects(h.run(),/Transaction UNDETERMINED/);
 assert.deepEqual(h.state.writes,[]);assert.deepEqual(h.state.transactions,original);
 assert.deepEqual(h.state.calls.map(x=>[x.stage,x.recoverOnly]),[['begin-r0',true],['review-r0',true]]);
});

test('a missing journal for a started round cannot broadcast when history has no exact match',async()=>{
 const h=harness({...initial(),started_round:'0'});
 await assert.rejects(h.run(),/No existing call found for recovery-only journal stage begin-r0/);
 assert.deepEqual(h.state.writes,[]);assert.deepEqual(h.state.transactions,{});
});

test('a new runtime journal cannot reroll a started round when only the begin receipt is recoverable',async()=>{
 const h=harness();h.state.reviewStatus='UNDETERMINED';
 await assert.rejects(h.run(),/Transaction UNDETERMINED/);
 const original=structuredClone(h.state.transactions);
 // A runtime change changes the operator's journal filename. The native round
 // remains started even if its new journal is empty and review history lags.
 h.state.transactions={};h.state.writes=[];h.state.calls=[];
 h.state.history=h.state.history.filter(row=>row.hash===original['begin-r0'].hash);
 await assert.rejects(h.run(),/No existing call found for recovery-only journal stage review-r0/);
 assert.deepEqual(h.state.writes,[]);
 assert.equal(h.state.transactions['begin-r0'].hash,original['begin-r0'].hash);
 assert.equal(h.state.transactions['review-r0'],undefined);
 assert.ok(original['review-r0'].hash,'retain the failed original journal');
});

test('a crash after begin but before durable review intent fails closed on resume',async()=>{
 const h=harness();h.state.crashBeforeReview=true;
 await assert.rejects(h.run(),/crash before review intent/);
 assert.equal(h.state.c.started_round,'0');assert.equal(h.state.transactions['review-r0'],undefined);
 assert.deepEqual(h.state.writes.map(x=>x.method),['begin_attribution_review']);
 h.state.crashBeforeReview=false;h.state.writes=[];
 await assert.rejects(h.run(),/No existing call found for recovery-only journal stage review-r0/);
 assert.deepEqual(h.state.writes,[]);assert.equal(h.state.transactions['review-r0'],undefined);
});

test('recovering a prior begin after an unstarted state read cannot authorize a fresh review',async()=>{
 const h=harness();h.state.crashBeforeReview=true;
 await assert.rejects(h.run(),/crash before review intent/);
 // A previous begin may still be in flight at the first finalized-state read,
 // then finalize before the resumed invocation recovers its exact receipt.
 h.state.c.started_round='-1';h.state.crashBeforeReview=false;h.state.writes=[];
 await assert.rejects(h.run(),/No existing call found for recovery-only journal stage review-r0/);
 assert.deepEqual(h.state.writes,[]);assert.equal(h.state.transactions['review-r0'],undefined);
});

test('an unstarted challenge has distinct stages and a started challenge is recovery-only',async()=>{
 const h=harness();await h.run();
 const original=structuredClone(h.state.transactions);
 Object.assign(h.state.c,{status:'challenged',round:'1'});h.state.writes=[];h.state.calls=[];
 assert.equal((await h.run()).status,'challenge-window');
 assert.deepEqual(h.state.calls.map(x=>[x.stage,x.recoverOnly]),[['begin-r1',false],['review-r1',false],['review-r1',true]]);
 assert.deepEqual(h.state.writes.map(x=>[x.method,x.args[1]]),[['begin_attribution_review',1n],['review_attribution',1n]]);
 assert.deepEqual(h.state.transactions['review-r0'],original['review-r0']);
 Object.assign(h.state.c,{status:'challenged',finished_round:'0'});
 h.state.transactions={};h.state.writes=[];h.state.calls=[];h.state.history=[];
 await assert.rejects(h.run(),/No existing call found for recovery-only journal stage begin-r1/);
 assert.deepEqual(h.state.writes,[]);
});

test('missing or invalid started-round metadata fails before any transaction lookup or broadcast',async()=>{
 for(const started_round of [undefined,null,-2,'01',0.5,1]){
  const h=harness({...initial(),started_round});
  await assert.rejects(h.run(),/Exact.*started round/);
  assert.deepEqual(h.state.calls,[]);assert.deepEqual(h.state.writes,[]);
 }
});
