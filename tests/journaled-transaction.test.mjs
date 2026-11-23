import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { abi } from 'genlayer-js';
import { journaledTransaction } from '../github/journaled-transaction.mjs';

const address = '0x' + '1'.repeat(40);
const sender = '0x' + 'a'.repeat(40);
const other = '0x' + 'b'.repeat(40);
const hash = '0x' + 'c'.repeat(64);
const secondHash = '0x' + 'd'.repeat(64);
const method = 'adjudicate';
const args = ['contribution-id', 1];
const stage = 'adjudicate-r1';

const encode = (functionName = method, values = args) => Buffer.from(abi.calldata.encode({ method: functionName, args: values }));

function historyRow(transaction = hash) {
  return { type: 2, hash: transaction, from_address: sender, to_address: address,
    data: { calldata: encode().toString('base64') } };
}

function finalized(changes = {}) {
  return {
    hash, from_address: sender, to_address: address, statusName: 'FINALIZED', leader_only: false,
    data: { calldata: { raw: [...encode()] } },
    consensus_data: {
      leader_receipt: [{ execution_result: 'SUCCESS' }],
      validators: [{ mode: 'validator', vote: 'agree', execution_result: 'SUCCESS' }],
    },
    ...changes,
  };
}

function harness(transactions = {}) {
  const state = { history: [], receipt: finalized(), calls: [], saved: [], onSave: null, onWrite: null };
  const client = {
    account: { address: sender },
    request: async request => {
      assert.deepEqual(request, { method: 'sim_getTransactionsForAddress', params: [address] });
      state.calls.push('history');
      return state.history;
    },
    getTransaction: async ({ hash: requested }) => {
      assert.equal(requested, hash);
      state.calls.push('receipt');
      return typeof state.receipt === 'function' ? state.receipt() : state.receipt;
    },
    writeContract: async call => {
      state.calls.push('write');
      assert.equal(call.address, address);
      assert.equal(call.functionName, method);
      assert.equal(call.leaderOnly, false);
      assert.deepEqual(encode(call.functionName, call.args), encode());
      assert.ok(state.saved.at(-1)?.[stage]?.intent, 'durable intent is required before any write');
      assert.equal(state.saved.at(-1)?.[stage]?.hash, undefined);
      if (state.onWrite) return state.onWrite();
      return hash;
    },
  };
  const input = { client, address, sender, method, args, independent: true, transactions, stage,
    save: async () => {
      state.calls.push('save');
      if (state.onSave) state.onSave();
      state.saved.push(structuredClone(transactions));
    },
  };
  return { state, transactions, input, run: overrides => journaledTransaction({ ...input, ...overrides }) };
}

test('a fresh call saves intent, then broadcasts once, then saves hash and finalized receipt', async () => {
  const h = harness();
  const result = await h.run();
  assert.deepEqual(h.state.calls, ['history', 'save', 'write', 'save', 'receipt', 'save']);
  assert.equal(result, h.transactions[stage]);
  assert.equal(result.hash, hash);
  assert.equal(result.receipt.statusName, 'FINALIZED');
  assert.deepEqual(Object.keys(result.intent).sort(), ['address', 'argsSha256', 'independent', 'method', 'sender']);
  assert.match(result.intent.argsSha256, /^[a-f0-9]{64}$/);
  assert.equal(h.state.saved[1][stage].hash, hash);
  assert.equal(h.state.saved[1][stage].receipt, undefined);
  assert.deepEqual(await h.run({ args: [args[0], 1n] }), result);
  assert.equal(h.state.calls.filter(call => call === 'write').length, 1);
});

test('an intent save failure prevents broadcasting, as does a wrong signing account', async () => {
  const failed = harness();
  failed.state.onSave = () => { throw Error('intent save failed'); };
  await assert.rejects(failed.run(), /intent save failed/);
  assert.deepEqual(failed.state.calls, ['history', 'save']);
  const wrong = harness();
  wrong.input.client.account.address = other;
  await assert.rejects(wrong.run(), /signing client has an unexpected sender/);
  assert.deepEqual(wrong.state.calls, ['history']);
  assert.deepEqual(wrong.transactions, {});
});

test('recovers an existing successful call without a stage and never writes in recovery-only mode', async () => {
  const h = harness();
  h.state.history = [historyRow()];
  delete h.input.client.account;
  const recovered = await h.run({ recoverOnly: true });
  assert.equal(recovered.hash, hash);
  assert.equal(recovered.intent.sender, sender);
  assert.deepEqual(h.state.calls, ['history', 'receipt', 'save']);

  const missing = harness();
  await assert.rejects(missing.run({ recoverOnly: true }), /No existing call found/);
  assert.deepEqual(missing.state.calls, ['history']);
  assert.deepEqual(missing.transactions, {});
});

test('if broadcast or hash saving fails, the durable intent only permits recovery', async () => {
  for (const gap of ['broadcast acknowledgment', 'hash save']) {
    const h = harness();
    if (gap === 'broadcast acknowledgment') h.state.onWrite = () => { throw Error(gap); };
    else h.state.onSave = () => { if (h.state.saved.length === 1) throw Error(gap); };
    await assert.rejects(h.run(), new RegExp(gap));
    assert.equal(h.state.calls.filter(call => call === 'write').length, 1);
    assert.ok(h.state.saved[0][stage].intent);
    assert.equal(h.state.saved[0][stage].hash, undefined);

    const restarted = harness(h.state.saved[0]);
    await assert.rejects(restarted.run(), /Ambiguous broadcast/);
    assert.deepEqual(restarted.state.calls, ['history']);
    restarted.state.history = [historyRow()];
    assert.equal((await restarted.run()).hash, hash);
    assert.deepEqual(restarted.state.calls, ['history', 'history', 'receipt', 'save']);
  }
});

test('an observed pending match records its hash and can finalize after history stops showing it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  h.state.history = [historyRow()];
  h.state.receipt = finalized({ statusName: 'ACCEPTED' });
  await assert.rejects(h.run(), { code: 'STUDIO_MATCH_UNFINALIZED', hash, status: 'ACCEPTED' });
  assert.equal(h.state.saved[0][stage].hash, hash);
  assert.equal(h.state.saved[0][stage].receipt, undefined);

  const restarted = harness(h.state.saved[0]);
  let reads = 0;
  restarted.state.receipt = () => ++reads === 1 ? finalized({ statusName: 'ACCEPTED' }) : finalized();
  const wait = restarted.run();
  await setImmediate();
  assert.deepEqual(restarted.state.calls, ['receipt']);
  t.mock.timers.tick(2500);
  assert.equal((await wait).receipt.statusName, 'FINALIZED');
  assert.deepEqual(restarted.state.calls, ['receipt', 'receipt', 'save']);
});

test('an observed finalized failure or ambiguous history cannot lead to another broadcast', async () => {
  const h = harness();
  h.state.history = [historyRow()];
  h.state.receipt = finalized({ consensus_data: { leader_receipt: [{ execution_result: 'ERROR' }] } });
  await assert.rejects(h.run(), { code: 'STUDIO_MATCH_INVALID', hash, status: 'FINALIZED' });
  assert.equal(h.state.saved[0][stage].hash, hash);
  const restarted = harness(h.state.saved[0]);
  restarted.state.receipt = h.state.receipt;
  await assert.rejects(restarted.run(), /Finalized execution failed/);
  assert.deepEqual(restarted.state.calls, ['receipt']);

  const ambiguous = harness();
  ambiguous.state.history = [historyRow(), historyRow(secondHash)];
  await assert.rejects(ambiguous.run(), { code: 'AMBIGUOUS_STUDIO_HISTORY' });
  const unclear = harness(ambiguous.state.saved[0]);
  await assert.rejects(unclear.run(), /Ambiguous broadcast/);
  assert.deepEqual(unclear.state.calls, ['history']);
});

test('an existing stage cannot be reused for another sender, target, method, typed argument or authority', async () => {
  const h = harness();
  await h.run();
  for (const changed of [
    { sender: other }, { address: other }, { method: 'finalize' },
    { args: [args[0], '1'] }, { args: [args[0], 2] }, { independent: false },
  ]) {
    const restarted = harness(structuredClone(h.transactions));
    await assert.rejects(restarted.run(changed), /does not match its exact transaction intent/);
    assert.deepEqual(restarted.state.calls, []);
  }
});

test('a successful-looking cached receipt cannot replace the exact native receipt', async () => {
  const h = harness();
  await h.run();
  for (const changes of [
    { from_address: other }, { to_address: other }, { hash: secondHash },
    { data: { calldata: { raw: [...encode(method, [args[0], '1'])] } } },
    { leader_only: true }, { statusName: 'CANCELED' },
    { consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }], validators: [] } },
  ]) {
    const restarted = harness(structuredClone(h.transactions));
    restarted.state.receipt = finalized(changes);
    await assert.rejects(restarted.run());
    assert.deepEqual(restarted.state.calls, ['receipt']);
  }
});

test('resume can replace a stale cached receipt with the independently checked native copy', async () => {
  const h = harness();
  await h.run();
  h.transactions[stage].receipt.from_address = other;
  const restarted = harness(structuredClone(h.transactions));
  assert.equal((await restarted.run()).receipt.from_address, sender);
  assert.deepEqual(restarted.state.calls, ['receipt', 'save']);
});

test('a legacy hash-only stage acquires an intent only after verification', async () => {
  const h = harness({ [stage]: { hash } });
  h.state.receipt = finalized({ from_address: other });
  await assert.rejects(h.run(), /receipt has an unexpected sender/);
  assert.equal(h.transactions[stage].intent, undefined);
  h.state.receipt = finalized();
  const verified = await h.run();
  assert.equal(verified.intent.sender, sender);
  assert.equal(verified.hash, hash);
  assert.deepEqual(h.state.calls, ['receipt', 'receipt', 'save']);
});

test('overlapping attempts on the same in-memory stage cannot broadcast twice', async () => {
  const h = harness();
  const first = h.run();
  await assert.rejects(h.run(), /already in progress/);
  assert.equal((await first).hash, hash);
  assert.equal(h.state.calls.filter(call => call === 'write').length, 1);
});
