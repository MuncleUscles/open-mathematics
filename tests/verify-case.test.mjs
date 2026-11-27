import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../src/security.mjs';
import { verifyCaseDocumentary } from '../github/verify-case.mjs';

const deployment = { contract: '0x' + 'ab'.repeat(20), chainId: 61999 };
const author = 'Ada Example';
const subject = 'https://identity.example/ada';
const refs = ['https://publisher.example/article', 'https://archive.example/article'];
const nativeAuthor=(reference=refs[0],name=author)=>({id:'author-'+digest(reference+'\n'+name).slice(0,32),name,sources:[reference],verified_subject:subject,claimed_wallet:null,binding_version:'0'});

function fixture(kind = 'attribution') {
  const c = {
    id: 'case-' + '1'.repeat(32), kind, target: kind === 'external-solution' ? 'p-vs-np' : kind === 'authorship' ? nativeAuthor().id : 'pr-7-example',
    reporter: '0x' + '3'.repeat(40), round: '1', revision:'0',
    payload: {
      claim: 'This report requests review of the documented original mathematical source and the actual integration work.',
      component: 'The enrolled CNF renaming lemma',
      sources: refs.map((reference, i) => ({ reference, title: i ? 'Independent archive' : 'Original publication', authors: [author], relationship: 'This source contains the earlier component used in the submitted formalization.', priority_evidence: 'The operator must review independent documentary evidence rather than infer priority from a URL.' })),
    },
  };
  c.identity_expiry = String(Math.floor(Date.now() / 1000) + 3600);
  c.identity_challenge = `Open Mathematics authorship:${deployment.contract}:${deployment.chainId}:${c.target}:${c.reporter}:${c.id}:${c.identity_expiry}`;
  const quotes = [
    kind === 'authorship' ? `Author-controlled publication of the exact challenge: ${c.identity_challenge}` : 'The publisher record identifies this specific mathematical component and its original publication.',
    'The independent archive records the same mathematical publication and its named author.',
  ];
  const bodies = quotes.map((quote, i) => `Document ${i}\n${quote}\nEnd of immutable snapshot.`);
  const config = {
    case_id: c.id, contract: deployment.contract, chain_id: deployment.chainId, payload_hash: digest(c.payload), round: 1,
    review_basis: 'A trusted operator compared the exact source component and documentary identities before admitting this case.',
    sources: refs.map((reference, i) => ({ reference, content_hash: digest(bodies[i]), quote: quotes[i], verified_authors: [{ name: author, subject }] })),
    priority_verified: kind !== 'authorship',
    priority_basis: kind === 'authorship' ? [] : [{ kind: 'publisher-record', reference: refs[0], excerpt: quotes[0] }],
    authorship_verified: kind === 'authorship',
    ...(kind === 'authorship' ? { identity_subject: subject, identity_source: refs[0], identity_author_id: c.target, identity_challenge: c.identity_challenge } : {}),
  };
  const calls = [];
  const retrieve = async ({ reference, quote }) => {
    calls.push({ reference, quote });
    const i = refs.indexOf(reference);
    assert.ok(i >= 0, 'Only declared source references may be retrieved');
    assert.ok(bodies[i].includes(quote), 'The mock also requires an exact documentary quote');
    return { reference, content_hash: digest(bodies[i]), retrieved_at: Math.floor(Date.now() / 1000), excerpt: quote };
  };
  return { c, config, bodies, quotes, calls, retrieve, authors:kind==='authorship'?[nativeAuthor()]:[] };
}

const verify = f => verifyCaseDocumentary(f.c, f.config, deployment, { retrieve: f.retrieve, authors:f.authors });

test('documentary admission binds the exact case, contract, chain, payload and integer round before retrieval', async () => {
  for (const mutate of [
    f => { f.config.case_id = 'case-' + '9'.repeat(32); },
    f => { f.config.contract = '0x' + 'cd'.repeat(20); },
    f => { f.config.chain_id++; },
    f => { f.config.payload_hash = '0'.repeat(64); },
    f => { f.c.payload.component = 'A different component'; },
    f => { f.config.round = 0; },
    f => { f.config.round = '1'; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(verify(f), /bind exact case, deployment, payload and round/);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  f.config.contract = f.config.contract.toUpperCase();
  assert.equal((await verify(f)).sources.length, 2, 'Native numeric-string round normalization and address case are supported');
});

test('requires a substantive operator basis and explicit documentary booleans', async () => {
  for (const mutate of [
    f => { f.config.review_basis = 'A URL is enough'; },
    f => { f.config.review_basis = 'x'.repeat(3001); },
    f => { delete f.config.priority_verified; },
    f => { f.config.priority_verified = 'true'; },
    f => { f.config.authorship_verified = 0; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(verify(f), /review basis|required|explicit booleans/);
  }
});

test('each declared source has one exact hash; changed bytes or swapped source hashes fail', async () => {
  for (const mutate of [
    f => { f.config.sources.pop(); },
    f => { f.config.sources[1] = structuredClone(f.config.sources[0]); },
    f => { f.config.sources[0].reference = 'https://other.example/article'; },
    f => { f.config.sources[0].content_hash = 'not-a-hash'; },
    f => { f.bodies[0] += '\nChanged after operator review.'; },
    f => { [f.config.sources[0].content_hash, f.config.sources[1].content_hash] = [f.config.sources[1].content_hash, f.config.sources[0].content_hash]; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(verify(f), /Every declared source|Exact unique|changed from reviewed snapshot/);
  }
});

test('verified source author names must exactly match the declared authors', async () => {
  for (const authors of [[], [{ name: 'Someone Else', subject }], [{ name: author, subject: '' }], [{ name: author, subject }, { name: author, subject }]]) {
    const f = fixture(); f.config.sources[0].verified_authors = authors;
    await assert.rejects(verify(f), /actual named source authors/);
  }
});

test('URL-only assertions, unsupported Git-date categories and missing priority quotations do not establish priority', async () => {
  for (const mutate of [
    f => { f.config.priority_basis = []; },
    f => { f.config.priority_basis[0].kind = 'self-reported-git-date'; },
    f => { f.config.priority_basis[0].kind = 'url'; },
    f => { f.config.priority_basis[0].reference = 'https://another.example/record'; },
    f => { f.config.priority_basis[0].excerpt = 'The submitter says this was first published on a particular date.'; },
    f => { f.config.priority_basis = Array(5).fill(f.config.priority_basis[0]); },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(verify(f), /Priority|priority corroboration/);
  }
  const f = fixture();
  f.config.priority_verified = false;
  f.config.priority_basis = [];
  assert.equal((await verify(f)).priority_verified, false, 'Retrieving a source does not itself claim priority');
});

test('corroboration preserves each exact reference/hash pair rather than a cross-source match', async () => {
  const f = fixture();
  f.config.priority_basis.push({ kind: 'independent-archive', reference: refs[1], excerpt: f.quotes[1] });
  const e = await verify(f);
  assert.deepEqual(e.priority_basis.map(({ reference, content_hash }) => ({ reference, content_hash })), f.config.sources.map(({ reference, content_hash }) => ({ reference, content_hash })));
  assert.equal(e.formal_verified, false);
  assert.equal(e.statement_hash, '');
  assert.equal(e.artifact_hash, '');
  assert.equal(e.policy, '');
  f.config.priority_basis[0].reference = refs[1];
  await assert.rejects(verify(f), /present in one retrieved source/);
});

test('authorship requires the exact unexpired native challenge, target author, identity subject and source', async () => {
  const good = fixture('authorship');
  const evidence = await verify(good);
  assert.equal(evidence.identity_challenge, good.c.identity_challenge);
  assert.equal(evidence.identity_source, refs[0]);
  assert.equal(evidence.identity_author_id, good.c.target);
  assert.equal(evidence.identity_subject, subject);
  assert.equal('wallet' in evidence, false, 'The reporter wallet comes only from native state');
  for (const mutate of [
    f => { f.config.identity_challenge += '-different-wallet'; },
    f => { f.config.identity_author_id = 'author-' + '9'.repeat(32); },
    f => { f.config.identity_subject = 'https://identity.example/impostor'; },
    f => { f.config.identity_source = 'https://elsewhere.example/identity'; },
    f => { f.c.identity_expiry = '1'; },
    f => { f.config.sources[0].verified_authors[0].subject = 'https://identity.example/someone-else'; },
  ]) {
    const f = fixture('authorship'); mutate(f);
    await assert.rejects(verify(f), /Identity admission|native pinned subject/);
  }
});

test('wallet-bound challenge must occur on the same source that establishes the claimed author identity', async () => {
  const f = fixture('authorship');
  const without = 'The registered author publication establishes only the identity, with no new wallet challenge.';
  const unrelated = `A different publication merely copies the publicly visible challenge: ${f.c.identity_challenge}`;
  f.bodies[0] = without; f.bodies[1] = unrelated;
  f.config.sources[0].quote = without; f.config.sources[1].quote = unrelated;
  f.config.sources.forEach((s, i) => { s.content_hash = digest(f.bodies[i]); });
  await assert.rejects(verify(f), /challenge.*source|source.*challenge|author-controlled publication/i);
});

test('non-identity cases cannot carry author identity or payout instructions', async () => {
  for (const field of ['authorship_verified', 'identity_subject', 'identity_challenge', 'identity_author_id', 'identity_source']) {
    const f = fixture(); f.config[field] = field === 'authorship_verified' ? true : 'unrelated author identity';
    await assert.rejects(verify(f), /cannot nominate a different payout wallet/);
  }
});

test('documentary evidence rejects every full-target formal claim because none is enrolled', async () => {
  for (const [field, value] of [['formal_verified', true], ['statement_hash', 'a'.repeat(64)], ['artifact_hash', 'b'.repeat(64)], ['policy', 'c'.repeat(64)]]) {
    const f = fixture('external-solution'); f.config[field] = value;
    await assert.rejects(verify(f), /no enrolled full-target verifier/);
  }
  const f = fixture('external-solution');
  const e = await verify(f);
  assert.equal(e.formal_verified, false);
  assert.equal('resolved' in e, false);
});

test('requires the native registry and rejects pinned subject conflicts before retrieving sources',async()=>{
  const f=fixture();
  await assert.rejects(verifyCaseDocumentary(f.c,f.config,deployment,{retrieve:f.retrieve}),/native external-author registry/);
  f.authors=[nativeAuthor()];
  f.config.sources[0].verified_authors[0].subject='https://identity.example/different';
  await assert.rejects(verify(f),/native pinned subject/);
  assert.equal(f.calls.length,0);
  f.config.sources[0].verified_authors[0].subject=subject;
  assert.equal((await verify(f)).sources.length,2);
  f.authors.push({...nativeAuthor()});
  await assert.rejects(verify(f),/Malformed native external-author registry/);
});

test('counts unique URL-and-name identities against registry capacity before retrieval',async()=>{
  const f=fixture();
  const fillers=Array.from({length:1023},(_,i)=>({id:'author-'+(i+100).toString(16).padStart(32,'0'),name:'Another author',sources:[`https://archive.example/other/${i}`]}));
  f.authors=[nativeAuthor(),...fillers];
  await assert.rejects(verify(f),/capacity exceeded before attestation/);
  assert.equal(f.calls.length,0);
  f.authors.pop();
  assert.equal((await verify(f)).sources.length,2,'One existing source identity and one new identity fit exactly at capacity');
  f.authors.push(nativeAuthor(refs[1]));
  assert.equal((await verify(f)).sources.length,2,'A full registry can still attest its already registered authors');
});

test('author IDs mirror native Python name stripping rather than JavaScript whitespace rules',async()=>{
  const f=fixture();
  f.authors=[nativeAuthor()];
  f.c.payload.sources[0].authors=['\u0085'+author+'\u0085'];
  f.config.payload_hash=digest(f.c.payload);
  f.config.sources[0].verified_authors[0].name=f.c.payload.sources[0].authors[0];
  f.config.sources[0].verified_authors[0].subject='https://identity.example/different';
  await assert.rejects(verify(f),/native pinned subject/);
});

test('authorship preflight checks registered source, claimed state and native binding revision',async()=>{
  for(const mutate of [
    f=>{f.authors=[];},
    f=>{f.authors[0].claimed_wallet='0x'+'4'.repeat(40);},
    f=>{f.authors[0].binding_version='1';},
    f=>{f.config.identity_source=refs[1];},
  ]){
    const f=fixture('authorship');mutate(f);
    await assert.rejects(verify(f),/Identity admission/);
  }
});

test('uses Unicode code-point bounds for author subjects, source quotes and priority excerpts',async()=>{
  const f=fixture();
  f.config.sources[0].verified_authors[0].subject='😀'.repeat(3);
  await assert.rejects(verify(f),/actual named source authors/);
  f.config.sources[0].verified_authors[0].subject='😀'.repeat(300);
  assert.equal((await verify(f)).sources[0].verified_authors[0].subject.length,600);
  f.config.sources[0].quote='😀'.repeat(29);
  await assert.rejects(verify(f),/30 to 1200 Unicode/);
  f.config.sources[0].quote='😀'.repeat(30);f.bodies[0]=f.config.sources[0].quote;f.config.sources[0].content_hash=digest(f.bodies[0]);
  f.config.priority_basis[0].excerpt='😀'.repeat(29);
  await assert.rejects(verify(f),/30 to 1200 Unicode/);
  f.config.priority_basis[0].excerpt=f.config.sources[0].quote;
  assert.equal((await verify(f)).priority_basis[0].excerpt,f.config.sources[0].quote);
  f.config.priority_basis[0].excerpt='x'.repeat(1201);
  await assert.rejects(verify(f),/30 to 1200 Unicode/);
});

test('rejects an oversized total native attestation even when every source field fits',async()=>{
  const f=fixture();
  f.c.payload.sources=Array.from({length:4},(_,i)=>({...f.c.payload.sources[0],reference:`https://publisher.example/source/${i}`,authors:Array.from({length:8},(_,j)=>`Author ${i}-${j} `+'a'.repeat(140))}));
  f.config.payload_hash=digest(f.c.payload);
  f.config.sources=f.c.payload.sources.map(s=>({reference:s.reference,quote:'q'.repeat(1200),content_hash:digest('q'.repeat(1200)),verified_authors:s.authors.map(name=>({name,subject:'s'.repeat(300)}))}));
  f.config.priority_verified=false;f.config.priority_basis=[];
  f.retrieve=async({reference,quote})=>({reference,excerpt:quote,content_hash:digest(quote),retrieved_at:Math.floor(Date.now()/1000)});
  await assert.rejects(verify(f),/16000-character attestation limit/);
});

test('retrieval preflight preserves real timestamps and rejects future time or mismatched identity',async()=>{
  for(const alteration of [
    {retrieved_at:Math.floor(Date.now()/1000)+60}, {retrieved_at:0}, {retrieved_at:'1700000000'},
    {reference:refs[1]}, {excerpt:'A different quote than the operator selected.'},
  ]){
    const f=fixture(),original=f.retrieve;
    f.retrieve=async args=>({...await original(args),...alteration});
    await assert.rejects(verify(f),/nonfuture Unix time|reference or exact excerpt mismatch/);
  }
  const f=fixture(),original=f.retrieve,actualTime=Math.floor(Date.now()/1000)-60;
  f.retrieve=async args=>({...await original(args),retrieved_at:actualTime});
  assert.equal((await verify(f)).sources[0].retrieved_at,actualTime,'Never clamp or fabricate a retrieval timestamp');
});
