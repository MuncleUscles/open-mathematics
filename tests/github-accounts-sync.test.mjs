import test from 'node:test';
import assert from 'node:assert/strict';
import {accountSyncOffsets,accountNameOrder,accountSyncHash} from '../github/sync-accounts.mjs';

test('bounded rotating scans eventually revisit old impact changes while always including recent records',()=>{
 const seen=new Set();let cursor=0;
 for(let run=0;run<10;run++){
  const batch=accountSyncOffsets(107,cursor);cursor=batch.next;
  assert(batch.offsets.length<=24);assert.equal(new Set(batch.offsets).size,batch.offsets.length);
  for(let i=95;i<107;i++)assert(batch.offsets.includes(i));
  for(const offset of batch.offsets){assert(offset>=0&&offset<107);seen.add(offset);}
 }
 assert.equal(seen.size,107);
 assert.deepEqual(accountSyncOffsets(0,7),{offsets:[],next:0});
 assert.throws(()=>accountSyncOffsets(-1),/bounds/);
});

test('four persistently failed name refreshes cannot starve later accounts',()=>{
 const ids=['1','2','3','4','5','6','7','8','9'],seen=new Set();let cursor=0;
 for(let run=0;run<3;run++){
  const order=accountNameOrder(ids,cursor),attempted=order.ids.slice(0,4);
  attempted.forEach(id=>seen.add(id));cursor=(order.start+attempted.length)%order.ids.length;
 }
 assert.equal(seen.size,9);assert.deepEqual(accountNameOrder([],7),{ids:[],start:0});
 assert.throws(()=>accountNameOrder(['../../path']),/bounds/);
});

test('each source settlement has a distinct exact-call intent but native integer transport is stable',()=>{
 const record={evidence:{github_author_id:17},credited_points:'320'},impact={status:'provisional'};
 assert.equal(accountSyncHash(record,impact),accountSyncHash({evidence:{github_author_id:'17'},credited_points:'320'},impact));
 assert.notEqual(accountSyncHash(record,impact),accountSyncHash({...record,credited_points:'400'},{status:'settled'}));
});
