import assert from 'node:assert/strict';
import test from 'node:test';
import {clientFor, finalized, retry} from '../github/runtime.mjs';
import {rpcRateLimit} from '../src/rpc-errors.mjs';

const details = {bucket: 'standard', window: 'hour', limit: 500, current: 500, retry_after_seconds: 1020};
const rateLimit = {code: -32029, message: 'Private fixture diagnostic', data: {...details, extra: 'Private fixture metadata'}};
const unexpectedWait = async () => assert.fail('Rate limiting must stop application-level retries immediately');

test('explicit rate limit aborts retries and reports only safe quota details', async () => {
  let reads = 0;
  await assert.rejects(retry(async () => {
    reads++;
    throw rateLimit;
  }, {wait: unexpectedWait}), error => {
    assert.equal(error.code, -32029);
    assert.deepEqual(error.data, details);
    assert.match(error.message, /Retry after 1020 seconds/);
    assert(!JSON.stringify(error).includes('Private fixture'));
    assert(!error.message.includes(rateLimit.message));
    return true;
  });
  assert.equal(reads, 1);
});

test('a wrapper with the same explicit code but no metadata retains quota details from its cause', () => {
  const inner = Object.assign(Error('Transport'), {code: -32029, data: rateLimit.data});
  const wrapper = Object.assign(Error('RPC wrapped', {cause: inner}), {code: -32029});
  const outer = Error('Native read failed', {cause: wrapper});
  assert.deepEqual(rpcRateLimit(outer), {bucket: 'standard', window: 'hour', limit: 500, current: 500, retryAfterSeconds: 1020});
  assert.deepEqual(rpcRateLimit({code: -32029, data: {...details, retry_after_seconds: 'invalid', limit: -1, current: Infinity, bucket: 'untrusted', window: 'untrusted'}}), {});
});

test('a transient error with rate-limit wording still uses the ordinary retry path', async () => {
  const misleading = Object.assign(Error('Rate limit reached (-32029). Retry later.'), {code: -32001, data: rateLimit.data});
  let reads = 0;
  const waits = [];
  const result = await retry(async () => {
    if (++reads === 1) throw misleading;
    return 'recovered';
  }, {wait: async ms => { waits.push(ms); }});
  assert.equal(result, 'recovered');
  assert.equal(reads, 2);
  assert.deepEqual(waits, [1500]);
});

test('ordinary errors still get at most five attempts', async () => {
  let reads = 0;
  const waits = [];
  const error = Error('Temporary transport failure');
  await assert.rejects(retry(async () => {
    reads++;
    throw error;
  }, {wait: async ms => { waits.push(ms); }}), e => e === error);
  assert.equal(reads, 5);
  assert.deepEqual(waits, [1500, 3000, 4500, 6000]);
});

test('a rate-limited receipt read stops finality polling for the known hash', async () => {
  const hash = '0x' + 'a'.repeat(64);
  const calls = [];
  await assert.rejects(finalized({
    async getTransaction(request) {
      calls.push(request.hash);
      throw Error('Native SDK receipt lookup', {cause: rateLimit});
    },
  }, hash), {code: -32029, data: details});
  assert.deepEqual(calls, [hash]);
});

test('the pinned SDK retains explicit Studio quota information from a mocked JSON-RPC response', async t => {
  let nativeReads = 0;
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (_url, {body}) => {
    const {method, id} = JSON.parse(body);
    if (method === 'sim_getConsensusContract') {
      return new Response(JSON.stringify({id, jsonrpc: '2.0', result: {address: '0x' + '1'.repeat(40), abi: []}}));
    }
    assert.equal(method, 'gen_call');
    nativeReads++;
    return new Response(JSON.stringify({id, jsonrpc: '2.0', error: rateLimit}));
  });
  const client = clientFor();
  await assert.rejects(retry(() => client.readContract({
    address: '0x' + '2'.repeat(40),
    functionName: 'get_points',
    args: ['0x' + '3'.repeat(40)],
    transactionHashVariant: 'latest-final',
  }), {wait: unexpectedWait}), {code: -32029, data: details});
  assert.equal(nativeReads, 1);
});
