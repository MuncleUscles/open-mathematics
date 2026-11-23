import test from 'node:test';
import assert from 'node:assert/strict';
import {withStudioBatchPacing} from '../github/batch-studio-client.mjs';
import {finalized} from '../github/runtime.mjs';

const address='0x'+'1'.repeat(40),hash='0x'+'2'.repeat(64);
const limit=(seconds=46,extra={})=>Object.assign(Error('Studio quota'),{code:-32029,data:{retry_after_seconds:seconds,...extra}});
function fixture(overrides={}){
 let time=0;const calls=[],waits=[];
 const client={account:{address},chain:{id:61999},
  readContract(){assert.equal(this,client);calls.push(['read',time]);return {ok:true};},
  getTransaction(){assert.equal(this,client);calls.push(['transaction',time]);return {statusName:'UNDETERMINED'};},
  getChainId(){assert.equal(this,client);calls.push(['chain',time]);return 61999;},
  request(){assert.equal(this,client);calls.push(['history',time]);return [];},
  writeContract(){assert.equal(this,client);calls.push(['write',time]);return hash;},
  ...overrides,
 };
 const paced=withStudioBatchPacing(client,{now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;}});
 return {client,paced,calls,waits,now:()=>time,advance:ms=>{time+=ms;}};
}

test('batch requests share a three-second start queue and retain original method receivers',async()=>{
 const f=fixture();
 const results=await Promise.all([
  f.paced.readContract({}),f.paced.getTransaction({hash}),
  f.paced.request({method:'sim_getTransactionsForAddress',params:[address]}),
  f.paced.getChainId(),f.paced.writeContract({}),
 ]);
 assert.deepEqual(f.calls,[['read',0],['transaction',3000],['history',6000],['chain',9000],['write',12000]]);
 assert.equal(results[3],61999);assert.equal(results[4],hash);
 assert.equal(f.paced.account,f.client.account);assert.equal(f.client.readContract.name,'readContract');
});

test('short explicit Studio cooldowns retry idempotent reads and delay the next call',async()=>{
 const f=fixture();let count=0;
 f.client.readContract=function(){assert.equal(this,f.client);f.calls.push(['read',f.now()]);if(++count===1)throw Object.assign(Error('wrapped'),{cause:limit(46,{window:'minute'})});return 7;};
 const paced=withStudioBatchPacing(f.client,{now:f.now,wait:async ms=>{f.waits.push(ms);f.advance(ms);}});
 assert.equal(await paced.readContract({}),7);await paced.getTransaction({hash});
 assert.deepEqual(f.calls,[['read',0],['read',46000],['transaction',49000]]);
 assert.deepEqual(f.waits,[46000,3000]);
});

test('read cooldown recovery is bounded by both attempts and elapsed time',async()=>{
 const f=fixture();let attempts=0;const error=limit(60);
 f.client.readContract=()=>{attempts++;throw error;};
 const paced=withStudioBatchPacing(f.client,{now:f.now,wait:async ms=>f.advance(ms)});
 await assert.rejects(paced.readContract({}),e=>e===error);
 assert.equal(attempts,3);assert.equal(f.now(),120000);
 const slow=fixture();attempts=0;
 slow.client.readContract=()=>{attempts++;slow.advance(100000);throw error;};
 const bounded=withStudioBatchPacing(slow.client,{now:slow.now,wait:async ms=>slow.advance(ms)});
 await assert.rejects(bounded.readContract({}),e=>e===error);
 assert.equal(attempts,1);assert.equal(slow.now(),100000);
});

test('missing, long or hourly cooldowns and generic or terminal errors are never retried',async()=>{
 const absent=Object.assign(Error('quota without cooldown'),{code:-32029});
 for(const error of [absent,limit(0),limit(61),limit(3600),limit(5,{window:'hour'}),
  Object.assign(Error('rate limit exceeded'),{code:429}),Error('unknown contribution'),Error('finalized execution failed')]){
  let attempts=0;const f=fixture({readContract:()=>{attempts++;throw error;}});
  await assert.rejects(f.paced.readContract({}),e=>e===error);
  assert.equal(attempts,1);assert.deepEqual(f.waits,[]);
 }
});

test('writes are paced once and never repeated after a rate limit or uncertain broadcast',async()=>{
 for(const error of [limit(3),Error('uncertain broadcast'),Error('Transaction UNDETERMINED')]){
  let attempts=0;const f=fixture({writeContract:()=>{attempts++;throw error;}});
  await f.paced.getChainId();await assert.rejects(f.paced.writeContract({}),e=>e===error);
  assert.equal(attempts,1);assert.equal(f.now(),3000);
 }
});

test('generic RPC requests cannot bypass the history-only retry allowlist',()=>{
 const f=fixture();
 for(const request of [undefined,[],{method:'eth_sendRawTransaction',params:['0x12']},
  {method:'gen_call',params:[]},{method:'sim_getTransactionsForAddress',params:['invalid']},
  {method:'sim_getTransactionsForAddress',params:[address],other:'unsafe'}])
  assert.throws(()=>f.paced.request(request),/only the bounded transaction-history RPC/);
 assert.deepEqual(f.calls,[]);
});

test('original internal requests stay outside the wrapper queue without deadlocks or unsafe retries',async()=>{
 let client,internal=0;
 const f=fixture({readContract(){assert.equal(this,client);return this.request({method:'gen_call',params:[]});},
  request(request){assert.equal(this,client);assert.equal(request.method,'gen_call');internal++;return 9;}});
 client=f.client;
 assert.equal(await f.paced.readContract({}),9);assert.equal(internal,1);assert.deepEqual(f.waits,[]);
});

test('terminal transaction state reaches the existing finality guard without a write or fresh poll',async()=>{
 const f=fixture();
 await assert.rejects(finalized(f.paced,hash),/Transaction UNDETERMINED/);
 assert.deepEqual(f.calls,[['transaction',0]]);assert.deepEqual(f.waits,[]);
});
