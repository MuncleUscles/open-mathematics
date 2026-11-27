import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeReader,readWithRetry,readCurrentContribution} from '../public/native-read.mjs';

test('a transient read failure retries once and returns only the successful response',async()=>{
 let calls=0;
 const result=await readWithRetry(async()=>{if(++calls===1)throw Error('temporary transport error');return {points:'800'};},{retryDelayMs:0});
 assert.deepEqual(result,{points:'800'});assert.equal(calls,2);
});
test('persistent read failures stop after two attempts without a cached result',async()=>{
 let calls=0;
 await assert.rejects(readWithRetry(async()=>{calls++;throw Error('unavailable');},{retryDelayMs:0}),/unavailable/);
 assert.equal(calls,2);
});
test('an explicit provider rate limit stops without the read retry',async()=>{
 let calls=0;
 const error=Object.assign(Error('Rate limit'),{cause:{code:-32029,data:{retry_after_seconds:1020,limit:500,current:500}}});
 await assert.rejects(readWithRetry(async()=>{calls++;throw error;},{retryDelayMs:0}),e=>e===error);
 assert.equal(calls,1);
});
test('later UI refreshes respect the shared provider cooldown before making more requests',async()=>{
 let calls=0,time=1000;
 const error=Object.assign(Error('limited'),{code:-32029,data:{retry_after_seconds:5}});
 const read=createNativeReader(async()=>{if(++calls===1)throw error;return 'available';},{now:()=>time,retryDelayMs:0});
 await assert.rejects(read(),e=>e===error);time=5999;
 await assert.rejects(read(),e=>e===error);assert.equal(calls,1);
 time=6000;assert.equal(await read(),'available');assert.equal(calls,2);
});
test('timed-out reads are bounded and cannot replace a later successful read',async()=>{
 let calls=0,release;
 const result=await readWithRetry(()=>++calls===1?new Promise(resolve=>{release=resolve;}):Promise.resolve('fresh'),{timeoutMs:5,retryDelayMs:0});
 release('old');assert.equal(result,'fresh');assert.equal(calls,2);
});
test('a fresh contribution cannot label missing balances or impact as current archived values',async()=>{
 const record={status:'credited',evidence:{wallet:'wallet'}};
 const result=await readCurrentContribution(async(_address,method)=>{
  if(method==='get')return record;
  if(method==='get_provenance')return {current_initial_points:'400'};
  throw Error('unavailable');
 },'active-contract','contribution',{withProvenance:true});
 assert.deepEqual(result,{record,points:null,impact:null,provenance:{current_initial_points:'400'}});
});
test('an unavailable primary record is not presented as a fresh native contribution',async()=>{
 let calls=0;
 await assert.rejects(readCurrentContribution(async()=>{calls++;throw Error('record unavailable');},'contract','id'),/record unavailable/);
 assert.equal(calls,1);
});
