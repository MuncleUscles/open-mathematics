import assert from 'node:assert/strict';
import test from 'node:test';
import {abi} from 'genlayer-js';
import {claimFailureOutcome} from '../github/claim-recovery.mjs';
import {journaledTransaction} from '../github/journaled-transaction.mjs';
import {digest} from '../src/security.mjs';

const address='0x'+'1'.repeat(40),sender='0x'+'2'.repeat(40),hash='0x'+'3'.repeat(64);
const hidden='Unpublished diagnostic omitted from the public receipt';
const duplicate='statement already reserved or credited';
const args=[JSON.stringify({id:'pr-test',proof: hidden})];
const calldata=(method='register',values=args)=>[...abi.calldata.encode({method,args:values})];

function failedReceipt(changes={}){
  return {
    hash, from_address:sender, to_address:address, statusName:'FINALIZED', leader_only:false,
    data:{calldata:{raw:calldata()}},
    consensus_data:{leader_receipt:[{execution_result:'ERROR',result:{status:'contract_error',payload:duplicate},genvm_result:hidden}]},
    ...changes,
  };
}

function fixture(receipt, report={status:'registration-pending',transactions:{register:{hash}}}, history, {sendOnce=false}={}){
  const calls=[],saved=[];
  const client={
    account:{address:sender},
    async request(){calls.push('history');return history;},
    async getTransaction(request){assert.deepEqual(request,{hash});calls.push('receipt');return receipt;},
    async writeContract(call){
      calls.push('write');
      assert(sendOnce&&calls.filter(c=>c==='write').length===1,'Recovery must never send another registration transaction');
      assert.deepEqual(call,{address,functionName:'register',args,leaderOnly:false});
      assert.ok(saved.at(-1)?.register.intent);
      return hash;
    },
  };
  const recover=async()=>{
    let outcome;
    await assert.rejects(journaledTransaction({
      client,address,sender,method:'register',args,transactions:report.transactions,stage:'register',
      save:async()=>{calls.push('save');saved.push(structuredClone(report.transactions));},
    }),error=>{
      outcome=claimFailureOutcome(report,error);
      return true;
    });
    return outcome;
  };
  return {calls,saved,recover};
}

test('resume classifies an old hash-only duplicate as rejected and persists a compact native failure witness',async()=>{
  const first=fixture(failedReceipt());
  const expected={status:'rejected',registrationRejection:{hash,reason:duplicate}};
  assert.deepEqual(await first.recover(),expected);
  assert.deepEqual(first.calls,['receipt','save']);
  const transactions=first.saved[0],entry=transactions.register;
  assert.equal(entry.hash,hash);
  assert.equal(entry.receipt,undefined);
  assert.equal(entry.intent.argsSha256,entry.failedReceipt.argsSha256);
  assert.deepEqual(entry.failedReceipt.consensus_data.leader_receipt,[{execution_result:'ERROR',result:{status:'contract_error',payload:duplicate}}]);
  assert(!JSON.stringify(entry).includes(hidden));

  const resumed=fixture(failedReceipt(),{status:'registration-pending',transactions});
  assert.deepEqual(await resumed.recover(),expected);
  assert.deepEqual(resumed.calls,['receipt']);
});

test('a newly broadcast duplicate is journaled as terminal and a replay only reads its receipt',async()=>{
  const report={transactions:{}};
  const fixtureReceipt=failedReceipt({
    consensus_data:{leader_receipt:[{execution_result:'ERROR',result:{status:'rollback',payload:duplicate}}]},
  });
  const run=fixture(fixtureReceipt,report,[],{sendOnce:true});
  assert.deepEqual(await run.recover(),{status:'rejected',registrationRejection:{hash,reason:duplicate}});
  assert.deepEqual(run.calls,['history','save','write','save','receipt','save']);
  assert.deepEqual(await run.recover(),{status:'rejected',registrationRejection:{hash,reason:duplicate}});
  assert.deepEqual(run.calls.slice(6),['receipt']);
});

test('v5 identity, quota and duplicate rejections retain their safe reason without rebroadcasting',async()=>{
  for(const reason of [
    'statement or artifact already reserved credited or historical',
    'signed claim already registered',
    'verified normal GitHub account and valid creation time required',
    'GitHub account below minimum age at original signed claim',
    'one active contribution per GitHub account; finish or expire the existing claim',
    'three registrations per GitHub account in rolling 24 hours',
    'content has unresolved adjudication; same-content resubmission is fenced',
    'previously rejected content cannot receive a fresh adjudication',
    'same content already has an active or settled claim',
  ]){
    const report={transactions:{}};
    const run=fixture(failedReceipt({
      consensus_data:{leader_receipt:[{execution_result:'ERROR',result:{status:'rollback',payload:'UserError: '+reason},genvm_result:hidden}]},
    }),report,[],{sendOnce:true});
    const expected={status:'rejected',registrationRejection:{hash,reason}};
    assert.deepEqual(await run.recover(),expected);
    assert.deepEqual(run.calls,['history','save','write','save','receipt','save']);
    assert.deepEqual(await run.recover(),expected);
    assert.deepEqual(run.calls.slice(6),['receipt']);
    assert(!JSON.stringify(run.saved).includes(hidden));
  }
});

test('indeterminate consensus and a receipt that does not bind the saved registration remain pending',async()=>{
  for(const changes of [
    {statusName:'UNDETERMINED'}, {statusName:'CANCELED'}, {statusName:'LEADER_TIMEOUT'},
    {from_address:address}, {to_address:sender}, {hash:'0x'+'9'.repeat(64)}, {leader_only:true},
    {data:{calldata:{raw:calldata('register',[args[0]+' '])}}},
    {data:{calldata:{raw:calldata('adjudicate')}}},
  ]){
    const run=fixture(failedReceipt(changes));
    assert.deepEqual(await run.recover(),{status:'registration-pending'});
    assert.deepEqual(run.calls,['receipt']);
  }
});

test('an unresolved intent stays pending when the exact history match is still accepted',async()=>{
  const report={transactions:{register:{intent:{address,sender,method:'register',argsSha256:digest(abi.calldata.encode(args)),independent:false}}}};
  const history=[{type:2,hash,from_address:sender,to_address:address,data:{calldata:Buffer.from(calldata()).toString('base64')}}];
  const pending=fixture(failedReceipt({statusName:'ACCEPTED'}),report,history);
  assert.deepEqual(await pending.recover(),{status:'registration-pending'});
  assert.deepEqual(pending.calls,['history','receipt','save']);
  assert.equal(pending.saved[0].register.hash,hash);
  assert.equal(pending.saved[0].register.failedReceipt,undefined);
});

test('an unrecognized native error payload is kept private and yields a generic terminal registration error',async()=>{
  for(const payload of [hidden,'GitHub account below minimum age at original signed claim: '+hidden]){
    const run=fixture(failedReceipt({
      consensus_data:{leader_receipt:[{execution_result:'ERROR',result:{status:'contract_error',payload}}]},
    }));
    assert.deepEqual(await run.recover(),{status:'rejected',registrationRejection:{hash,reason:'The finalized registration transaction failed execution.'}});
    assert(!JSON.stringify(run.saved).includes(hidden));
  }
});
