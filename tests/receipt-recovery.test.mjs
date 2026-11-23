import assert from 'node:assert/strict';
import test from 'node:test';
import { abi } from 'genlayer-js';
import { recoverReceipt } from '../github/receipt-recovery.mjs';

const address = '0x' + '1'.repeat(40);
const sender = '0x' + 'a'.repeat(40);
const other = '0x' + 'b'.repeat(40);
const hash = '0x' + 'c'.repeat(64);
const secondHash = '0x' + 'd'.repeat(64);
const args = ['contribution-id', 1];
const method = 'adjudicate';
const expected = { address, sender, method, args, independent: true };

function encode(callMethod, callArgs) {
  return Buffer.from(abi.calldata.encode({ method: callMethod, args: callArgs }));
}

function historyRow({ from = sender, to = address, transaction = hash, callMethod = method, callArgs = args } = {}) {
  return {
    type: 2,
    hash: transaction,
    from_address: from,
    to_address: to,
    data: { calldata: encode(callMethod, callArgs).toString('base64') },
  };
}

function finalized({ callMethod = method, callArgs = args, ...changes } = {}) {
  return {
    hash,
    from_address: sender,
    to_address: address,
    data: { calldata: { raw: [...encode(callMethod, callArgs)] } },
    statusName: 'FINALIZED', result: 6, result_name: 'MAJORITY_AGREE',
    leader_only: false,
    consensus_data: {
      leader_receipt: [{ execution_result: 'SUCCESS' }],
      validators: [{ mode: 'validator', vote: 'agree', execution_result: 'SUCCESS' }],
    },
    ...changes,
  };
}

function provider(history, receipt = finalized()) {
  const fetched = [];
  const client = {
    request: async request => {
      assert.deepEqual(request, { method: 'sim_getTransactionsForAddress', params: [address] });
      return history;
    },
    getTransaction: async ({ hash }) => {
      fetched.push(hash);
      return receipt;
    },
  };
  return { client, fetched };
}

test('recovers one exact typed call and normalizes only that transaction', async () => {
  const receipt = finalized({ from_address: '0x' + 'A'.repeat(40), callArgs: [args[0], 1n] });
  const exact = historyRow({ callArgs: [args[0], 1n] });
  const { client, fetched } = provider([
    historyRow({ callArgs: [args[0], '1'], transaction: secondHash }),
    historyRow({ callArgs: ['another-id', 1], transaction: secondHash }),
    historyRow({ callMethod: 'finalize', transaction: secondHash }),
    historyRow({ from: other, transaction: secondHash }),
    historyRow({ to: other, transaction: secondHash }),
    exact,
    exact,
  ], receipt);
  assert.deepEqual(await recoverReceipt(client, expected), { hash, receipt });
  assert.deepEqual(fetched, [hash]);
});

test('returns null only for a history snapshot with no exact call', async () => {
  const { client, fetched } = provider([
    { ...historyRow(), type: 1, data: {} },
    { ...historyRow(), type: 0, data: {} },
    { ...historyRow({ from: other }), data: {} },
    historyRow({ callArgs: [args[0], 0] }),
  ]);
  assert.equal(await recoverReceipt(client, expected), null);
  assert.deepEqual(fetched, []);
});

test('flags multiple distinct exact broadcasts without choosing a receipt', async () => {
  const { client, fetched } = provider([historyRow(), historyRow({ transaction: secondHash })]);
  await assert.rejects(recoverReceipt(client, expected), /Ambiguous Studio history/);
  assert.deepEqual(fetched, []);
});

test('a matching in-flight, failed or unavailable transaction is never treated as absent', async () => {
  for (const [receipt, error] of [
    [finalized({ statusName: 'ACCEPTED' }), /has not finalized \(ACCEPTED\)/],
    [finalized({ statusName: 'LEADER_TIMEOUT' }), /has not finalized \(LEADER_TIMEOUT\)/],
    [finalized({ consensus_data: { leader_receipt: [{ execution_result: 'ERROR' }] } }), {code: 'STUDIO_FINALIZED_EXECUTION_ERROR', hash, status: 'FINALIZED'}],
    [null, /unavailable/],
  ]) {
    const { client, fetched } = provider([historyRow()], receipt);
    await assert.rejects(recoverReceipt(client, expected), error);
    assert.deepEqual(fetched, [hash]);
  }
});

test('the normalized receipt must repeat the exact sender, contract, calldata and consensus authority', async () => {
  for (const [changes, error] of [
    [{ from_address: other }, /unexpected sender/],
    [{ to_address: other }, /failed receipt verification/],
    [{ hash: secondHash }, /failed receipt verification/],
    [{ callMethod: 'finalize' }, /Wrong contract method or contribution/],
    [{ callArgs: [args[0], '1'] }, /Wrong contract method or contribution/],
    [{ leader_only: true }, /failed receipt verification/],
    [{ consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }], validators: [] } }, /Independent adjudication required/],
  ]) {
    const { client, fetched } = provider([historyRow()], finalized(changes));
    await assert.rejects(recoverReceipt(client, expected), error);
    assert.deepEqual(fetched, [hash]);
  }
  const receipt = finalized({ consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] } });
  const { client } = provider([historyRow()], receipt);
  assert.deepEqual(await recoverReceipt(client, { ...expected, independent: false }), { hash, receipt });
});

test('oversized, malformed and unavailable history fail closed', async () => {
  await assert.rejects(recoverReceipt(provider(null).client, expected), /at most 1,000 rows/);
  await assert.rejects(recoverReceipt(provider(Array(1001).fill(historyRow())).client, expected), /at most 1,000 rows/);
  for (const [row, error] of [
    [{ ...historyRow(), data: { calldata: '!' } }, /Malformed operator calldata/],
    [{ ...historyRow(), data: { calldata: 'AA==' } }, /Malformed operator calldata/],
    [{ ...historyRow(), from_address: undefined }, /Malformed sender/],
    [{ ...historyRow(), hash: 'invalid' }, /malformed hash/],
  ]) {
    const { client, fetched } = provider([row]);
    await assert.rejects(recoverReceipt(client, expected), error);
    assert.deepEqual(fetched, []);
  }
  await assert.rejects(recoverReceipt({ request: async () => { throw Error('RPC unavailable'); } }, expected), /RPC unavailable/);
});

test('public account traffic does not consume the enrolled sender history limit', async () => {
  const { client, fetched } = provider([
    ...Array(1001).fill({ ...historyRow({ from: other }), data: {} }), historyRow(),
  ]);
  assert.equal((await recoverReceipt(client, expected)).hash, hash);
  assert.deepEqual(fetched, [hash]);
});
