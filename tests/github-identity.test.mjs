import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchGitHubIdentity, validateGitHubIdentity, validateGitHubIdentityEvidence} from '../src/github-identity.mjs';

const at = '2024-02-01T12:00:00Z';
const profile = {id:123, type:'User', created_at:'2024-01-02T12:00:00Z'};
const expected = {github_account_created_at:Date.parse(profile.created_at)/1000, github_account_type:'User'};
const options = {authorId:123, at};
const response = (value, init={}) => new Response(JSON.stringify(value), {status:200, headers:{'content-type':'application/json'}, ...init});
const lookup = (fetcher, more={}) => fetchGitHubIdentity({github:{fetcher}, login:'A-real-user', ...options, ...more});

 test('age is measured at the original claim: exactly 30 days qualifies, one millisecond short does not', () => {
  assert.deepEqual(validateGitHubIdentity(profile, options), expected);
  assert.deepEqual(validateGitHubIdentity(profile, {...options, at:Date.parse(at)}), expected);
  assert.deepEqual(validateGitHubIdentity(profile, {...options, at:'2024-02-01T12:00:00.000Z'}), expected);
  assert.throws(() => validateGitHubIdentity(profile, {...options, at:Date.parse(at)-1}), error =>
    error.code === 'IDENTITY_TOO_YOUNG' && error.message.includes('2024-02-01T12:00:00.000Z'));
  assert.throws(() => validateGitHubIdentity({...profile, created_at:'2024-01-03T12:00:00Z'}, options), /at least 30 days/);
  assert.deepEqual(validateGitHubIdentity({...profile, created_at:'2024-01-31T12:00:00Z'}, {...options, minimumAgeDays:1}).github_account_type, 'User');
 });

 test('immutable ID and User account type are mandatory; social metrics are irrelevant and never returned', () => {
  for (const change of [{id:124},{id:'123'},{id:123.5},{type:'Organization'},{type:'Bot'},{type:'user'},{type:null}])
    assert.throws(() => validateGitHubIdentity({...profile,...change}, options));
  for (const authorId of [0,-1,NaN,Infinity,'123',Number.MAX_SAFE_INTEGER+1])
    assert.throws(() => validateGitHubIdentity(profile, {...options,authorId}));
  assert.deepEqual(validateGitHubIdentity({...profile, followers:0, public_repos:0, email:'not-retained', bio:'untrusted'}, options), expected);
 });

 test('strict creation timestamps and finite explicit claim time fail closed', () => {
  for (const created_at of ['2024-02-02T00:00:00Z','2024-01-02T12:00:00.000Z','2024-01-02T12:00:00+00:00',
    '2024-02-30T00:00:00Z','2024-01-02','2024-01-02T12:00:60Z','2024-01-02T12:00:00z',null,0])
    assert.throws(() => validateGitHubIdentity({...profile,created_at}, options));
  for (const invalid of [undefined,NaN,Infinity,Date.now()+60_000,-1,Date.parse(at)+0.5,'2024-02-01','2024-02-30T00:00:00Z'])
    assert.throws(() => validateGitHubIdentity(profile, {...options,at:invalid}));
  for (const minimumAgeDays of [0,3651,30.5,'30',null,NaN])
    assert.throws(() => validateGitHubIdentity(profile, {...options,minimumAgeDays}));
 });

 test('cached evidence uses the same age and safe integer bounds', () => {
  assert.deepEqual(validateGitHubIdentityEvidence(expected, {at}), expected);
  assert.throws(() => validateGitHubIdentityEvidence(expected, {at:Date.parse(at)-1}), /at least 30 days/);
  for (const change of [{github_account_created_at:'1704196800'},{github_account_created_at:-1},
    {github_account_created_at:Date.parse(at)/1000+1},{github_account_type:'Bot'}])
    assert.throws(() => validateGitHubIdentityEvidence({...expected,...change}, {at}));
 });

 test('fetch uses exactly the public profile endpoint with bounded credentials and returns only evidence', async () => {
  let calls=0;
  const fetcher=async (url,init) => {
    calls++; assert.equal(url,'https://api.github.com/users/A-real-user'); assert.equal(init.method,'GET');
    assert.equal(init.redirect,'error'); assert.equal(init.credentials,'omit'); assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers.Authorization,'Bearer fixture-token'); assert.equal(init.body,undefined);
    return response({...profile, followers:0, email:'not-retained', unexpected:{value:'not-retained'}});
  };
  assert.deepEqual(await lookup(fetcher,{github:{fetcher,token:'fixture-token'}}),expected); assert.equal(calls,1);
  await lookup(async (_,init)=>{assert.equal(init.headers.Authorization,undefined);return response(profile);});
 });

 test('invalid login and author options do not make a request', async () => {
  let calls=0; const fetcher=async()=>{calls++;return response(profile);};
  for(const login of ['../user','user?x=1','https://example.org','-user','user-','a--b','a_b','app[bot]','a'.repeat(40),''])
    await assert.rejects(lookup(fetcher,{login}), {code:'IDENTITY_LOGIN'});
  await assert.rejects(lookup(fetcher,{authorId:0}), {code:'IDENTITY_AUTHOR'});
  assert.equal(calls,0);
 });

 test('network errors, HTTP failures, redirects and ID swaps fail without leaking responses or tokens', async () => {
  await assert.rejects(lookup(async()=>{throw Object.assign(new Error('fixture-secret private-response'),{code:'IDENTITY_FAKE'});}),
    error=>error.code==='IDENTITY_NETWORK'&&!error.message.includes('fixture-secret'));
  for(const status of [301,401,403,404,429,500])
    await assert.rejects(lookup(async()=>response({message:'fixture-secret'},{status})), {code:'IDENTITY_RESPONSE'});
  await assert.rejects(lookup(async()=>({...response(profile),status:200,redirected:true})), {code:'IDENTITY_RESPONSE'});
  await assert.rejects(lookup(async()=>response({...profile,id:124})), {code:'IDENTITY_AUTHOR'});
 });

 test('stream size, content type, malformed JSON and invalid UTF-8 are bounded and rejected', async () => {
  await assert.rejects(lookup(async()=>response(profile,{headers:{'content-type':'application/json','content-length':'65537'}})), {code:'IDENTITY_RESPONSE_SIZE'});
  await assert.rejects(lookup(async()=>response({padding:'x'.repeat(65537)})), {code:'IDENTITY_RESPONSE_SIZE'});
  await assert.rejects(lookup(async()=>response(profile,{headers:{'content-type':'text/html'}})), {code:'IDENTITY_RESPONSE'});
  for(const body of ['{bad',new Uint8Array([0xc3,0x28])])
    await assert.rejects(lookup(async()=>new Response(body,{headers:{'content-type':'application/json'}})), {code:'IDENTITY_RESPONSE'});
 });

 test('deadline stops a stalled fetch without retries', async t => {
  t.mock.timers.enable({apis:['setTimeout']}); let calls=0;
  const pending=lookup(async()=>{calls++;return new Promise(()=>{});});
  const rejected=assert.rejects(pending,{code:'IDENTITY_TIMEOUT'});
  t.mock.timers.tick(8000); await rejected; assert.equal(calls,1);
 });

 test('deadline also covers a stalled response body', async t => {
  t.mock.timers.enable({apis:['setTimeout']}); let cancelled=false;
  const pending=lookup(async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}));
  const rejected=assert.rejects(pending,{code:'IDENTITY_TIMEOUT'});
  await Promise.resolve(); await Promise.resolve(); t.mock.timers.tick(8000); await rejected; assert.equal(cancelled,true);
 });
