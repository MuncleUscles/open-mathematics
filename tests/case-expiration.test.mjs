import assert from 'node:assert/strict';
import test from 'node:test';
import {isTerminalCase, reconcileV3CaseExpiration, requireV3CaseCanProceed, staleCaseDiagnostic} from '../github/case-expiration.mjs';

const authorId = 'author-' + '1'.repeat(32);
const identityExpiry = 2_000_000_000;
const authorship = {
  kind: 'authorship',
  status: 'submitted',
  target: authorId,
  revision: 0,
  identity_expiry: identityExpiry,
};

function fixture() {
  const viewCalls = [];
  const writes = [];
  const readView = async (method, args) => {
    viewCalls.push([method, args]);
    assert.equal(method, 'get_external_authors');
    return [{id: authorId, binding_version: '0', claimed_wallet: null}];
  };
  const proceed = async (record, now) => {
    await requireV3CaseCanProceed(record, readView, now);
    if (!isTerminalCase(record.status)) writes.push('next case stage');
  };
  return {viewCalls, writes, proceed};
}

test('a stale v3 authorship case stops before the next native write', async () => {
  const {viewCalls, writes, proceed} = fixture();
  await assert.rejects(proceed(authorship, identityExpiry * 1000), {message: staleCaseDiagnostic});
  assert.deepEqual(viewCalls, [['get_external_authors', []]]);
  assert.deepEqual(writes, []);
});

test('a current v3 authorship case continues to the next stage', async () => {
  const {writes, proceed} = fixture();
  await proceed(authorship, identityExpiry * 1000 - 1);
  assert.deepEqual(writes, ['next case stage']);
});

test('terminal cases remain available for receipt reconciliation without a stale check', async () => {
  const {viewCalls, writes, proceed} = fixture();
  for (const status of ['settled', 'expired', 'withdrawn']) {
    await proceed({...authorship, status}, identityExpiry * 1000 + 1);
  }
  assert.deepEqual(viewCalls, []);
  assert.deepEqual(writes, []);
});

test('only a finalized expired case reconciles an expiration receipt using its recorded reason', async () => {
  const executor = {};
  const history = [{event: 'expired', reason: 'This is the exact reason recorded at expiration.'}];
  const record = {id: 'case-' + '2'.repeat(32), history};
  const calls = [];
  const transaction = async (...args) => { calls.push(args); };
  for (const status of ['submitted', 'withdrawn', 'settled', 'expired']) {
    await reconcileV3CaseExpiration({...record, status}, executor, transaction);
  }
  assert.deepEqual(calls, [['expire', executor, 'expire_case', [record.id, history[0].reason], false, true]]);
});

test('attribution and external resolution staleness also stop case processing', async () => {
  const calls = [];
  const readView = async (method, args) => {
    calls.push([method, args]);
    return method === 'get_provenance' ? {version: 1} : {status: 'resolved'};
  };
  await assert.rejects(requireV3CaseCanProceed(
    {kind: 'attribution', status: 'verified', target: 'prior-proof', revision: 0}, readView,
  ), {message: staleCaseDiagnostic});
  await assert.rejects(requireV3CaseCanProceed(
    {kind: 'external-solution', status: 'provisional', target: 'p-vs-np'}, readView,
  ), {message: staleCaseDiagnostic});
  assert.deepEqual(calls, [['get_provenance', ['prior-proof']], ['get_problem', []]]);
});
