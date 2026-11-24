import test from 'node:test';
import assert from 'node:assert/strict';
import {abi,createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {createDashboardReaders} from '../src/dashboard-read.mjs';
import {openSnapshotLabel} from '../src/open-snapshot.mjs';
import {githubAccountsSnapshotLabel} from '../src/github-accounts.mjs';
import {federationSnapshotLabel} from '../src/federation-snapshot.mjs';

const contract='0x'+'1'.repeat(40),accountsContract='0x'+'2'.repeat(40);
function fixture(implementation=()=>new Map([['value',7n]])){
 let time=0;const calls=[];
 const noOtherMethods=()=>assert.fail('Dashboard must only read finalized contract views');
 const client={
  readContract:async args=>{calls.push({at:time,...args});return implementation(args,calls.length);},
  getTransaction:noOtherMethods,getChainId:noOtherMethods,request:noOtherMethods,writeContract:noOtherMethods,
 };
 const pacing={now:()=>time,wait:async ms=>{time+=ms;}};
 return {calls,client,pacing,...createDashboardReaders({client,contract,accountsContract},pacing)};
}

test('research, account, federation and earlier-page reads share one three-second queue',async()=>{
 const f=fixture();
 assert.deepEqual(await Promise.all([
  f.read('get_config'),f.accountRead('get_state'),f.read('get_federation_state'),f.read('list_contributions',[0,12]),
 ]),Array.from({length:4},()=>({value:'7'})));
 assert.deepEqual(f.calls.map(({at,address,functionName})=>[at,address,functionName]),[
  [0,contract,'get_config'],[3000,accountsContract,'get_state'],[6000,contract,'get_federation_state'],[9000,contract,'list_contributions'],
 ]);
 assert.ok(f.calls.every(call=>call.transactionHashVariant==='latest-final'));
 assert.deepEqual(f.calls.at(-1).args,[0,12]);
});

test('dashboard exposes only bound read functions and needs no account deployment',async()=>{
 const f=fixture();const readers=createDashboardReaders({client:f.client,contract},f.pacing);
 assert.deepEqual(Object.keys(readers),['read']);
 assert.deepEqual(Object.keys(createDashboardReaders({client:f.client,contract,accountsContract},f.pacing)),['read','accountRead']);
 await readers.read('get_points',['0x'+'3'.repeat(40)]);
 assert.equal(f.calls[0].address,contract);
});

test('an explicit read cooldown also delays later account and federation reads',async()=>{
 const quota=Object.assign(Error('Studio quota'),{code:-32029,data:{retry_after_seconds:46,window:'minute'}});
 const f=fixture((args,count)=>{if(count===1)throw quota;return count;});
 assert.equal(await f.read('get_config'),2);
 await f.accountRead('get_state');await f.read('get_federation_state');
 assert.deepEqual(f.calls.map(call=>call.at),[0,46000,49000,52000]);
});

test('unstructured HTTP rate limits and terminal read failures remain failures without blind retries',async()=>{
 for(const error of [Object.assign(Error('Rate limit exceeded: 30 requests per minute'),{code:429}),Error('unknown contribution')]){
  const f=fixture(()=>{throw error;});
  await assert.rejects(f.read('get',['missing']),observed=>observed===error);
  assert.equal(f.calls.length,1);
 }
});

test('actual SDK gen_call transport leaves retry timing to the shared reader queue',async t=>{
 let time=0;const calls=[];
 t.mock.method(console,'error',()=>{});
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'https://example.invalid/studio');
  const request=JSON.parse(options.body);assert.equal(request.method,'gen_call');
  assert.equal(request.params[0].transaction_hash_variant,'latest-final');
  calls.push({at:time,address:request.params[0].to});
  const response=calls.length===1?{error:{code:-32029,message:'Synthetic short quota',data:{retry_after_seconds:5}}}:
    {result:'0x'+Buffer.from(abi.calldata.encode(7)).toString('hex')};
  return new Response(JSON.stringify(response),{status:calls.length===1?429:200});
 });
 const readers=createDashboardReaders({client:createClient({chain:studionet,endpoint:'https://example.invalid/studio'}),contract,accountsContract},
  {now:()=>time,wait:async ms=>{time+=ms;}});
 assert.equal(await readers.read('count_contributions'),7);
 await readers.accountRead('get_state');
 assert.deepEqual(calls,[{at:0,address:contract},{at:5000,address:contract},{at:8000,address:accountsContract}]);
});

test('initial published labels keep original dates and distinguish pending refresh from unavailable live reads',()=>{
 const snapshot={startedAt:'2026-11-23T00:00:00Z',completedAt:'2026-11-23T00:00:12Z',records:[],accounts:[],count:'0'};
 for(const label of [openSnapshotLabel,githubAccountsSnapshotLabel,federationSnapshotLabel]){
  const pending=label(snapshot,{refreshing:true});
  assert.match(pending,/Published.*snapshot from 2026-11-23T00:00:12Z; live refresh in progress/);
  assert.match(pending,/2026-11-23T00:00:00Z/);assert.match(pending,/cannot authorize/);assert.doesNotMatch(pending,/live unavailable/);
  assert.match(label(snapshot),/live unavailable/);
 }
});
