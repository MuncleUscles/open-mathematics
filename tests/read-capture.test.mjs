import test from 'node:test';import assert from 'node:assert/strict';
import {createReadCapture} from '../github/read-capture.mjs';
const identity={contract:'one',policy:'pinned'};
test('a failed public read can resume without repeating successful calls',async()=>{
 let saved,time=1000;const calls=[];
 const capture=createReadCapture({identity,now:()=>time,save:async value=>{saved=structuredClone(value);},read:async method=>{calls.push(method);if(method==='second')throw Error('rate limit');return ['first value'];}});
 assert.deepEqual(await capture.view('first'),['first value']);
 await assert.rejects(capture.view('second'),/rate limit/);assert.equal(saved.completedAt,undefined);
 time=2000;const resumed=createReadCapture({identity,prior:saved,now:()=>time,save:async value=>{saved=structuredClone(value);},read:async method=>{calls.push(method);return ['second value'];}});
 assert.deepEqual(await resumed.view('first'),['first value']);
 assert.deepEqual(await resumed.view('second'),['second value']);await resumed.complete();
 assert.deepEqual(calls,['first','second','second']);assert.equal(saved.entries['["first",[]]'].readAt,new Date(1000).toISOString());assert.equal(saved.completedAt,new Date(2000).toISOString());
 await assert.rejects(resumed.view('third'),/completed capture/);
});
test('a different deployment or stale incomplete capture cannot reuse prior views',()=>{
 const prior={version:1,identity,startedAt:new Date(0).toISOString(),entries:{}};
 const deps={read:()=>assert.fail('must not read'),save:()=>assert.fail('must not save')};
 assert.throws(()=>createReadCapture({...deps,identity:{...identity,contract:'other'},prior,now:()=>1000}),/identity/);
 assert.throws(()=>createReadCapture({...deps,identity,prior,now:()=>900001}),/expired/);
});
