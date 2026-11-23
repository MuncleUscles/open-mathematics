import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { isPublicIPv4, retrieveProvenanceSource } from '../github/provenance-source.mjs';

const reference = 'https://document.example/paper?revision=1';
const quote = 'This exact passage is reviewed documentary evidence.';
const input = { reference, quote };
const resolver = async () => ['93.184.215.14'];

function fixture({ body = Buffer.from(`Before. ${quote} After.`), status = 200, headers = ['Content-Type', 'text/plain; charset=utf-8'], chunks, hang = false, complete = true, inspect } = {}) {
  const calls = [];
  const request = (options, callback) => {
    calls.push(options);
    inspect?.(options);
    const req = new EventEmitter();
    const response = new PassThrough();
    response.statusCode = status;
    response.rawHeaders = headers;
    response.complete = false;
    req.destroyed = false;
    req.destroy = () => { req.destroyed = true; response.destroy(); };
    req.end = () => queueMicrotask(() => {
      callback(response);
      if (response.destroyed || hang) return;
      for (const chunk of chunks || [body]) {
        response.write(chunk);
        if (response.destroyed) return;
      }
      response.complete = complete;
      response.end();
    });
    calls[calls.length - 1].testRequest = req;
    return req;
  };
  return { request, calls };
}

test('IPv4 gate rejects private, special-purpose, multicast, malformed and IPv6 addresses', () => {
  for (const address of [
    '0.0.0.0', '0.255.255.255', '10.0.0.1', '10.255.255.255',
    '100.64.0.0', '100.127.255.255', '127.0.0.1', '127.255.255.255',
    '169.254.169.254', '172.16.0.0', '172.31.255.255', '192.0.0.9',
    '192.0.2.1', '192.31.196.1', '192.52.193.1', '192.88.99.1',
    '192.168.0.1', '192.175.48.1', '198.18.0.0', '198.19.255.255',
    '198.51.100.1', '203.0.113.1', '224.0.0.0', '239.255.255.255',
    '240.0.0.0', '255.255.255.255', '::1', '::ffff:8.8.8.8', '127.1',
    '2130706433', '0x7f000001', '01.2.3.4', '256.1.1.1', null, 123,
  ]) assert.equal(isPublicIPv4(address), false, String(address));
  for (const address of ['1.1.1.1', '8.8.8.8', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '198.17.255.255', '198.20.0.0', '223.255.255.255']) {
    assert.equal(isPublicIPv4(address), true, address);
  }
});

test('URL rejection happens before DNS or HTTP, including alternate loopback spellings', async () => {
  let calls = 0;
  const forbidden = () => { calls++; throw Error('Must not run'); };
  for (const url of [
    'http://document.example/', 'https://user:pass@document.example/',
    'https://@document.example/', 'https://document.example:8443/',
    'https://document.example/#section', 'https://document.example/#',
    'https://document.example/white space', 'https://document.example/\n',
    'https://document.example\\@127.0.0.1/', 'https://127.0.0.1/',
    'https://127.1/', 'https://2130706433/', 'https://0x7f000001/',
    'https://169.254.169.254/latest/meta-data/', 'https://[::1]/',
  ]) await assert.rejects(retrieveProvenanceSource({ ...input, reference: url }, { resolver: forbidden, request: forbidden }));
  assert.equal(calls, 0);
});

test('all DNS answers must be public IPv4; mixed or invalid answers never reach HTTP', async () => {
  let calls = 0;
  for (const addresses of [[], ['10.0.0.1'], ['93.184.215.14', '127.0.0.1'], ['::1'], ['198.51.100.1'], [{ address: '8.8.8.8' }], Array(65).fill('8.8.8.8')]) {
    await assert.rejects(retrieveProvenanceSource(input, { resolver: async () => addresses, request: () => { calls++; } }), /public IPv4/);
  }
  assert.equal(calls, 0);
});

test('pins one resolution into TLS lookup, authenticates the original hostname and sends no credentials', async () => {
  let resolutions = 0;
  const body = Buffer.from(`\ufeff${quote}\nNo date or authorship claim is inferred.`);
  const transport = fixture({ body });
  const result = await retrieveProvenanceSource(input, {
    resolver: async hostname => { assert.equal(hostname, 'document.example'); resolutions++; return ['93.184.215.14', '8.8.8.8']; },
    request: transport.request, now: () => 1700000000123,
  });
  assert.equal(resolutions, 1);
  assert.deepEqual(result, { reference, content_hash: createHash('sha256').update(body).digest('hex'), retrieved_at: 1700000000, excerpt: quote });
  const options = transport.calls[0];
  assert.equal(options.hostname, 'document.example');
  assert.equal(options.servername, 'document.example');
  assert.equal(options.port, 443);
  assert.equal(options.path, '/paper?revision=1');
  assert.equal(options.family, 4);
  assert.equal(options.autoSelectFamily, false);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.auth, undefined);
  assert.equal(options.createConnection, undefined);
  assert.deepEqual(options.agent.options.proxyEnv, {});
  assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Accept-Encoding', 'User-Agent']);
  assert.equal(options.headers['Accept-Encoding'], 'identity');
  const lookup = (name, settings) => new Promise((resolve, reject) => options.lookup(name, settings, (error, ...values) => error ? reject(error) : resolve(values)));
  assert.deepEqual(await lookup('document.example', {}), ['93.184.215.14', 4]);
  assert.deepEqual(await lookup('document.example', { all: true }), [[{ address: '93.184.215.14', family: 4 }]]);
  await assert.rejects(lookup('elsewhere.example', {}), /hostname mismatch/);
  assert.equal(options.checkServerIdentity('attacker.example', { subjectaltname: 'DNS:document.example' }), undefined);
  assert.equal(options.checkServerIdentity('document.example', { subjectaltname: 'DNS:attacker.example' }).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
});

test('public literal IPv4 skips DNS and still requires a matching certificate', async () => {
  const transport = fixture();
  await retrieveProvenanceSource({ ...input, reference: 'https://8.8.8.8:443/document' }, { resolver: () => { throw Error('DNS must not run'); }, request: transport.request });
  assert.equal(transport.calls[0].servername, '');
  assert.equal(transport.calls[0].checkServerIdentity('anything', { subjectaltname: 'IP Address:8.8.8.8' }), undefined);
});

test('rejects redirects without issuing a second request or forwarding headers', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const transport = fixture({ status, headers: ['Location', 'https://127.0.0.1/private', 'Set-Cookie', 'session=example'] });
    await assert.rejects(retrieveProvenanceSource(input, { resolver, request: transport.request }), /redirects are forbidden/);
    assert.equal(transport.calls.length, 1);
    assert.equal(transport.calls[0].testRequest.destroyed, true);
  }
});

test('accepts textual media and rejects PDF, binary, compression and ambiguous headers', async () => {
  for (const type of ['text/plain', 'text/html; charset=UTF-8', 'application/json', 'application/ld+json', 'application/xml', 'application/xhtml+xml', 'text/xml']) {
    const transport = fixture({ headers: ['Content-Type', type] });
    assert.equal((await retrieveProvenanceSource(input, { resolver, request: transport.request })).excerpt, quote);
  }
  for (const headers of [
    [], ['Content-Type', 'application/pdf'], ['Content-Type', 'application/octet-stream'],
    ['Content-Type', 'text/pdf'], ['Content-Type', 'text/plain; charset=iso-8859-1'],
    ['Content-Type', 'text/plain; charset=utf-8; charset=utf-16'],
    ['Content-Type', 'text/plain', 'Content-Type', 'text/html'],
    ['Content-Type', 'text/plain', 'Content-Encoding', 'gzip'],
    ['Content-Type', 'text/plain', 'Content-Length', '10', 'Content-Length', '10'],
    ['Content-Type', 'text/plain', 'Content-Length', '10', 'Transfer-Encoding', 'chunked'],
  ]) await assert.rejects(retrieveProvenanceSource(input, { resolver, request: fixture({ headers }).request }));
  await assert.rejects(retrieveProvenanceSource(input, { resolver, request: fixture({ body: Buffer.from(`%PDF-1.7\n${quote}`) }).request }), /PDF/);
});

test('limits actual raw bytes even with missing or dishonest content length', async () => {
  const exact = Buffer.alloc(256 * 1024, 'a');
  Buffer.from(quote).copy(exact);
  assert.equal((await retrieveProvenanceSource(input, { resolver, request: fixture({ body: exact }).request })).excerpt, quote);
  for (const options of [
    { headers: ['Content-Type', 'text/plain', 'Content-Length', String(256 * 1024 + 1)] },
    { chunks: [exact, Buffer.from('x')] },
    { chunks: [exact, Buffer.from('x')], headers: ['Content-Type', 'text/plain', 'Content-Length', '1'] },
  ]) {
    const transport = fixture(options);
    await assert.rejects(retrieveProvenanceSource(input, { resolver, request: transport.request }), /256 KiB/);
    assert.equal(transport.calls[0].testRequest.destroyed, true);
  }
});

test('requires complete HTTP 200 bytes and fatal UTF-8 decoding', async () => {
  for (const status of [204, 206, 401, 404, 500]) await assert.rejects(retrieveProvenanceSource(input, { resolver, request: fixture({ status }).request }), /complete HTTP 200/);
  await assert.rejects(retrieveProvenanceSource(input, { resolver, request: fixture({ complete: false }).request }), /incomplete/);
  await assert.rejects(retrieveProvenanceSource(input, { resolver, request: fixture({ headers: ['Content-Type', 'text/plain', 'Content-Length', '1'] }).request }), /incomplete/);
  await assert.rejects(retrieveProvenanceSource(input, { resolver, request: fixture({ body: Buffer.concat([Buffer.from(quote), Buffer.from([0xff])]) }).request }), { code: 'ERR_ENCODING_INVALID_ENCODED_DATA' });
});

test('returns only the exact quote; no HTML extraction, normalization or instruction execution', async () => {
  for (const body of [`${quote.toLowerCase()}`, quote.replace('exact passage', 'exact\npassage'), quote.replace('exact passage', 'exact <b>passage</b>')]) {
    await assert.rejects(retrieveProvenanceSource(input, { resolver, request: fixture({ body: Buffer.from(body) }).request }), /does not literally occur/);
  }
  const hostile = '<script>throw new Error("never execute this source")</script>';
  const result = await retrieveProvenanceSource({ reference, quote: hostile }, { resolver, request: fixture({ body: Buffer.from(hostile), headers: ['Content-Type', 'text/html'] }).request });
  assert.equal(result.excerpt, hostile);
  assert.deepEqual(Object.keys(result).sort(), ['content_hash', 'excerpt', 'reference', 'retrieved_at']);
  for (const badQuote of ['', 'x'.repeat(29), 'x'.repeat(1201), ' '.repeat(30), null]) {
    await assert.rejects(retrieveProvenanceSource({ reference, quote: badQuote }, { resolver: () => { throw Error('Not reached'); } }), /operator-reviewed exact quote/);
  }
});

test('one deadline bounds DNS and response stalls; callers cannot raise it', async () => {
  await assert.rejects(retrieveProvenanceSource(input, { resolver: () => new Promise(() => {}), timeoutMs: 15 }), /deadline exceeded/);
  const transport = fixture({ hang: true });
  await assert.rejects(retrieveProvenanceSource(input, { resolver, request: transport.request, timeoutMs: 15 }), /deadline exceeded/);
  assert.equal(transport.calls[0].testRequest.destroyed, true);
  for (const timeoutMs of [0, -1, 8001, Infinity]) await assert.rejects(retrieveProvenanceSource(input, { timeoutMs }), /at most eight seconds/);
});
