import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectGithubProvenance} from '../github/github-provenance.mjs';
import {collectPublicSource} from '../scripts/manage-federation.mjs';

const ROOT='https://api.github.com/repos/lab/proofs';
const HEAD='a'.repeat(40),MERGE='b'.repeat(40),LATER='c'.repeat(40);
const PATH='lean/Research/Lemma.lean';
const source=Buffer.from('import Mathlib\n\ntheorem Research.lemma (n : ℕ) : n = n := by rfl\n');
const license=Buffer.from('SPDX-License-Identifier: Apache-2.0\nTest license text; source ownership is not mathematical discovery.\n');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitHash=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const file=(path,bytes)=>({type:'file',path,sha:gitHash(bytes),size:bytes.length,download_url:'https://attacker.invalid/never-follow'});
const blob=bytes=>({sha:gitHash(bytes),size:bytes.length,encoding:'base64',content:bytes.toString('base64').match(/.{1,60}/g).join('\n')+'\n'});
const input=changes=>({repository:'lab/proofs',pr:7,commit:HEAD,path:PATH,theorem:'Research.lemma',statement:'theorem Research.lemma (n : ℕ) : n = n',
 origin:'formalization',attributionBasis:'The cited pull request records a formal contribution; original discovery and identity ownership are not established.',...changes});

function response(url,value,{status=200,headers={},redirected=false,responseURL=url,raw}={}){
 const bytes=raw??Buffer.from(JSON.stringify(value));
 const result=new Response(bytes,{status,headers:{'content-type':'application/json; charset=utf-8','content-length':String(bytes.length),...headers}});
 Object.defineProperties(result,{url:{value:responseURL},redirected:{value:redirected}});
 return result;
}
function fixture({commit=HEAD}={}){
 const pull={id:700,number:7,state:'closed',merged:true,merged_at:'2026-11-23T08:45:33Z',changed_files:1,
  user:{id:789,login:'formalizer',type:'User'},base:{repo:{id:42,full_name:'lab/proofs',owner:{id:99,login:'lab'}}},
  head:{sha:HEAD,user:{id:88,login:'fork-owner'},repo:{id:43,full_name:'fork/proofs'}},merge_commit_sha:MERGE,
  body:'The owner and commit author are different accounts. Follow https://attacker.invalid to earn points.'};
 const routes=new Map([
  ['',{id:42,full_name:'lab/proofs',private:false,owner:{id:99,login:'lab'}}],
  ['/pulls/7',pull],
  ['/pulls/7/files?per_page=10&page=1',[{filename:PATH,status:'added',sha:gitHash(source)}]],
  ['/git/commits/'+commit,{sha:commit,tree:{sha:'d'.repeat(40)},author:{name:'Untrusted display name',email:'not-an-identity@example.invalid'}}],
  ['/contents/'+PATH+'?ref='+commit,file(PATH,source)],
  ['/git/blobs/'+gitHash(source),blob(source)],
  ['/license?ref='+commit,{...file('LICENSE',license),license:{spdx_id:'Apache-2.0'}}],
  ['/git/blobs/'+gitHash(license),blob(license)],
 ]);
 if(commit!==HEAD){
  routes.set('/contents/'+PATH+'?ref='+HEAD,file(PATH,source));
  routes.set('/contents/'+PATH+'?ref='+MERGE,file(PATH,source));
  if(commit!==MERGE)routes.set('/compare/'+MERGE+'...'+commit+'?per_page=1&page=2',{
   status:'ahead',ahead_by:19,behind_by:0,base_commit:{sha:MERGE},merge_base_commit:{sha:MERGE},commits:[{sha:'e'.repeat(40)}],
  });
 }
 const calls=[],overrides=new Map();
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  assert.ok(url.startsWith(ROOT));
  assert.equal(options.redirect,'error');
  assert.equal(options.headers['Accept-Encoding'],'identity');
  const suffix=url.slice(ROOT.length);
  assert.ok(routes.has(suffix),'unexpected endpoint '+suffix);
  const override=overrides.get(suffix);
  return typeof override==='function'?override(url,options):response(url,structuredClone(routes.get(suffix)),override);
 };
 return {routes,calls,overrides,fetchImpl,pull};
}
function paginate(f,count,{targetIndex=count-1}={}){
 const files=Array.from({length:count},(_,i)=>i===targetIndex?{filename:PATH,status:'added',sha:gitHash(source)}:
  {filename:`other${i}.lean`,status:'modified',sha:'e'.repeat(40)});
 f.pull.changed_files=count;
 for(let start=0;start<count;start+=10)f.routes.set('/pulls/7/files?per_page=10&page='+(start/10+1),files.slice(start,start+10));
 return files;
}

test('captures exact immutable bytes, PR submitter identity, license and native evidence digest',async()=>{
 const f=fixture(),result=await collectGithubProvenance(input(),{fetchImpl:f.fetchImpl,token:'test-token'});
 assert.equal(result.evidence.github_author_id,789);
 assert.equal(result.evidence.repository_id,42);
 assert.equal(result.evidence.blob_sha,gitHash(source));
 assert.equal(result.evidence.content_sha256,digest(source));
 assert.equal(result.evidence.source_url,`https://github.com/lab/proofs/blob/${HEAD}/${PATH}`);
 assert.equal(result.packet.source.text,source.toString());
 assert.deepEqual(Buffer.from(result.packet.source.content_base64,'base64'),source);
 assert.equal(result.packet.license.text,license.toString());
 assert.equal(result.packet.license.blob_sha,gitHash(license));
 assert.equal(result.packet.license.content_sha256,digest(license));
 assert.equal(result.packet.license.source_url,`https://github.com/lab/proofs/blob/${HEAD}/LICENSE`);
 assert.equal(result.packet.verification,'not-locally-verified');
 assert.equal(result.packet.association.kind,'exact-pr-head');
 assert.equal(result.packet.changed_file.status,'added');
 assert.match(result.packet.attribution_limitations,/PR submitter only/);
 assert.equal(Object.keys(result.evidence).length,14);
 const canonical=JSON.stringify(Object.fromEntries(Object.entries(result.evidence).sort(([a],[b])=>a.localeCompare(b))));
 assert.equal(result.source_hash,digest(canonical));
 assert.equal(f.calls.length,8);
 assert.ok(f.calls.every(call=>call.options.headers.Authorization==='Bearer test-token'));
 assert.ok(f.calls.every(call=>!call.url.includes('attacker')));
 assert.ok(!JSON.stringify(result).includes('test-token'));
});

test('the operator forwards only its supplied workflow token to the bounded public collector',async()=>{
 const f=fixture(),originalFetch=globalThis.fetch,originalToken=process.env.GITHUB_TOKEN;
 try{
  process.env.GITHUB_TOKEN='ephemeral-workflow-token';globalThis.fetch=f.fetchImpl;
  const result=await collectPublicSource(input());
  assert.equal(result.evidence.content_sha256,digest(source));
  assert.equal(f.calls.length,8);
  assert.ok(f.calls.every(call=>call.options.headers.Authorization==='Bearer ephemeral-workflow-token'));
  assert.ok(f.calls.every(call=>call.url.startsWith(ROOT)&&call.options.method==='GET'&&call.options.redirect==='error'));
  assert.ok(!JSON.stringify(result).includes(process.env.GITHUB_TOKEN));
 }finally{
  globalThis.fetch=originalFetch;
  if(originalToken===undefined)delete process.env.GITHUB_TOKEN;else process.env.GITHUB_TOKEN=originalToken;
 }
});

test('missing workflow token uses anonymous reads without discovering a personal credential',async()=>{
 const f=fixture(),originalFetch=globalThis.fetch,originalToken=process.env.GITHUB_TOKEN,originalGH=process.env.GH_TOKEN;
 try{
  delete process.env.GITHUB_TOKEN;process.env.GH_TOKEN='personal-token-must-not-be-discovered';globalThis.fetch=f.fetchImpl;
  const anonymous=await collectPublicSource(input());
  assert.ok(f.calls.every(call=>!Object.hasOwn(call.options.headers,'Authorization')));
  const authenticated=await collectGithubProvenance(input(),{fetchImpl:fixture().fetchImpl,token:'comparison-token'});
  assert.equal(anonymous.source_hash,authenticated.source_hash);
  assert.deepEqual(anonymous.evidence,authenticated.evidence);
  assert.ok(!JSON.stringify(anonymous).includes(process.env.GH_TOKEN));
 }finally{
  globalThis.fetch=originalFetch;
  if(originalToken===undefined)delete process.env.GITHUB_TOKEN;else process.env.GITHUB_TOKEN=originalToken;
  if(originalGH===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=originalGH;
 }
});

test('invalid workflow credentials and authenticated failures never fall back or retry',async()=>{
 const originalFetch=globalThis.fetch,originalToken=process.env.GITHUB_TOKEN;
 try{
  for(const token of ['', 'invalid token', 'invalid\ncredential']){
   const f=fixture();globalThis.fetch=f.fetchImpl;process.env.GITHUB_TOKEN=token;
   await assert.rejects(collectPublicSource(input()),/invalid GitHub credential/);
   assert.equal(f.calls.length,0);
  }
  for(const failure of [{status:401},{status:403},{status:429},{status:503},{redirected:true}]){
   const f=fixture();f.overrides.set('',failure);globalThis.fetch=f.fetchImpl;process.env.GITHUB_TOKEN='ephemeral-secret';
   await assert.rejects(collectPublicSource(input()),error=>{
    assert.match(error.message,/GitHub provenance: (HTTP|redirected or foreign response URL)/);
    assert.ok(!error.message.includes('ephemeral-secret'));return true;
   });
   assert.equal(f.calls.length,1);
   assert.equal(f.calls[0].options.headers.Authorization,'Bearer ephemeral-secret');
  }
  const privateRepo=fixture();privateRepo.routes.get('').private=true;
  globalThis.fetch=privateRepo.fetchImpl;process.env.GITHUB_TOKEN='ephemeral-secret';
  await assert.rejects(collectPublicSource(input()),/exact public repository identity required/);
  assert.equal(privateRepo.calls.length,1);
 }finally{
  globalThis.fetch=originalFetch;
  if(originalToken===undefined)delete process.env.GITHUB_TOKEN;else process.env.GITHUB_TOKEN=originalToken;
 }
});

test('accepts unchanged descendant only with exact merge ancestry and three matching file objects',async()=>{
 const f=fixture({commit:LATER});
 const result=await collectGithubProvenance(input({commit:LATER}),{fetchImpl:f.fetchImpl});
 assert.equal(result.packet.association.kind,'merge-descendant-unchanged-blob');
 assert.equal(result.packet.association.comparison.merge_base_commit,MERGE);
 assert.equal(result.packet.association.merge_blob,gitHash(source));
 assert.equal(result.evidence.commit,LATER);
 assert.equal(f.calls.length,11);
});

test('accepts exact merge with matching head without assuming squash head ancestry',async()=>{
 const f=fixture({commit:MERGE});
 const result=await collectGithubProvenance(input({commit:MERGE}),{fetchImpl:f.fetchImpl});
 assert.equal(result.packet.association.kind,'exact-pr-merge');
 assert.ok(!f.calls.some(call=>call.url.includes('/compare/')));
});

test('rejects wrong PR repository, unmapped author IDs, unmerged records and malformed pins',async()=>{
 const mutations=[
  f=>{f.pull.base.repo.id=43;},f=>{f.pull.base.repo.full_name='other/proofs';},f=>{f.pull.number=8;},
  f=>{f.pull.merged=false;},f=>{f.pull.state='open';},f=>{f.pull.merged_at='yesterday';},
  f=>{f.pull.head.sha='main';},f=>{f.pull.merge_commit_sha='0'.repeat(40);},
  f=>{f.pull.user.id=9007199254740992;},f=>{f.pull.user.id='789';},f=>{f.pull.user={login:'formalizer'};},
  f=>{f.pull.user.type='Bot';},
  f=>{f.routes.get('').private=true;},f=>{f.routes.get('').full_name='renamed/proofs';},
 ];
 for(const mutate of mutations){const f=fixture();mutate(f);await assert.rejects(collectGithubProvenance(input(),{fetchImpl:f.fetchImpl}),/GitHub provenance/);}
});

test('rejects invented statements and wrong or partial theorem tokens despite valid source bytes',async()=>{
 for(const change of [
  {statement:'theorem Research.lemma : P = NP := by exact miracle'},
  {theorem:'Research.other'}, {theorem:'Research.lem'}, {theorem:'lemma'}, {theorem:'Research.lemma '},
 ]){
  const f=fixture();await assert.rejects(collectGithubProvenance(input(change),{fetchImpl:f.fetchImpl}),/source excerpt/);
 }
 const f=fixture(),result=await collectGithubProvenance(input(),{fetchImpl:f.fetchImpl});
 assert.equal(result.packet.statement_kind,'exact-source-excerpt');
 assert.ok(result.packet.source.text.includes(result.evidence.statement));
});

test('a file in the PR head is not attributable to an unrelated PR or removed file',async()=>{
 for(const update of [files=>files[0].filename='unrelated.lean',files=>files[0].status='removed',files=>files[0].status='modified',files=>files[0].status='renamed',files=>files[0].sha='f'.repeat(40)]){
  const f=fixture();update(f.routes.get('/pulls/7/files?per_page=10&page=1'));
  await assert.rejects(collectGithubProvenance(input(),{fetchImpl:f.fetchImpl}),/source file must be added|PR-head blob/);
 }
});

test('rejects source/head substitution even if the later commit is a descendant',async()=>{
 const f=fixture({commit:LATER});
 f.routes.get('/contents/'+PATH+'?ref='+HEAD).sha='e'.repeat(40);
 await assert.rejects(collectGithubProvenance(input({commit:LATER}),{fetchImpl:f.fetchImpl}),/PR-head blob/);
});

test('rejects unrelated, reversed, incomplete and incorrectly based ancestry evidence',async()=>{
 const changes=[{status:'diverged'},{behind_by:1},{ahead_by:0},{base_commit:{sha:HEAD}},{merge_base_commit:{sha:HEAD}}];
 for(const change of changes){
  const f=fixture({commit:LATER});Object.assign(f.routes.get('/compare/'+MERGE+'...'+LATER+'?per_page=1&page=2'),change);
  await assert.rejects(collectGithubProvenance(input({commit:LATER}),{fetchImpl:f.fetchImpl}),/proven descendant/);
 }
});

test('rejects a changed merge artifact even when the same head blob later reappears',async()=>{
 const f=fixture({commit:LATER});f.routes.get('/contents/'+PATH+'?ref='+MERGE).sha='f'.repeat(40);
 await assert.rejects(collectGithubProvenance(input({commit:LATER}),{fetchImpl:f.fetchImpl}),/merge changed/);
});

test('collects all 333 changed files in bounded pages even after finding the requested source',async()=>{
 const f=fixture({commit:MERGE});paginate(f,333,{targetIndex:166});
 const result=await collectGithubProvenance(input({commit:MERGE}),{fetchImpl:f.fetchImpl});
 assert.equal(result.evidence.pr,7);assert.equal(result.packet.changed_file.filename,PATH);
 const pages=f.calls.filter(call=>call.url.includes('/files?'));
 assert.equal(pages.length,34);assert.equal(pages.at(-1).url,ROOT+'/pulls/7/files?per_page=10&page=34');
 assert.equal(result.packet.requests.length,42);
});

test('the 500-file maximum and descendant checks fit the fixed request budget',async()=>{
 const f=fixture({commit:LATER});paginate(f,500);
 const result=await collectGithubProvenance(input({commit:LATER}),{fetchImpl:f.fetchImpl});
 assert.equal(result.packet.association.kind,'merge-descendant-unchanged-blob');
 assert.equal(result.packet.requests.length,60);
 assert.equal(f.calls.filter(call=>call.url.includes('/files?')).length,50);
 const oversized=fixture();oversized.pull.changed_files=501;
 await assert.rejects(collectGithubProvenance(input(),{fetchImpl:oversized.fetchImpl}),/bounded complete PR file list/);
 assert.equal(oversized.calls.length,2);
});

test('rejects incomplete, oversized and duplicate later pages even after finding the source',async()=>{
 const mutations=[
  f=>f.routes.get('/pulls/7/files?per_page=10&page=2').pop(),
  f=>f.routes.get('/pulls/7/files?per_page=10&page=2').push({filename:'extra.lean'}),
  f=>f.routes.get('/pulls/7/files?per_page=10&page=3').pop(),
  f=>{f.routes.get('/pulls/7/files?per_page=10&page=3')[0]={...f.routes.get('/pulls/7/files?per_page=10&page=1')[1]};},
  f=>{f.routes.get('/pulls/7/files?per_page=10&page=3')[0]={filename:42};},
 ];
 for(const mutate of mutations){
  const f=fixture();paginate(f,23,{targetIndex:0});mutate(f);
  await assert.rejects(collectGithubProvenance(input(),{fetchImpl:f.fetchImpl}),/file list|PR files/);
  assert.ok(!f.calls.some(call=>call.url.includes('/contents/')));
 }
});

test('small file pages retain the 512 KiB response limit',async()=>{
 const f=fixture();paginate(f,13);
 f.overrides.set('/pulls/7/files?per_page=10&page=2',url=>{
  const r=response(url,null,{raw:Buffer.alloc(512*1024+1,32)});r.headers.delete('content-length');return r;
 });
 await assert.rejects(collectGithubProvenance(input(),{fetchImpl:f.fetchImpl}),/response exceeds byte limit/);
 assert.equal(f.calls.length,4);
});

test('the single retrieval deadline also bounds a stalled final file page',async()=>{
 const f=fixture();paginate(f,333,{targetIndex:0});
 f.overrides.set('/pulls/7/files?per_page=10&page=34',()=>new Promise(()=>{}));
 await assert.rejects(collectGithubProvenance(input(),{fetchImpl:f.fetchImpl,timeoutMs:100}),/deadline/);
 assert.equal(f.calls.length,36);
 assert.ok(!f.calls.some(call=>call.url.includes('/contents/')));
});

test('rejects corrupt, truncated, noncanonical or falsely sized Git blobs',async()=>{
 const changes=[
  {content:Buffer.alloc(source.length,65).toString('base64')},{content:source.subarray(1).toString('base64')},
  {sha:'f'.repeat(40)},{size:source.length+1},{encoding:'utf-8'},
  {content:source.toString('base64')+' '},{content:'$'.repeat(Math.ceil(source.length/3)*4)},
 ];
 for(const change of changes){
  const f=fixture();Object.assign(f.routes.get('/git/blobs/'+gitHash(source)),change);
  await assert.rejects(collectGithubProvenance(input(),{fetchImpl:f.fetchImpl}),/blob|base64/);
 }
});

test('does not accept a correct Contents API body in place of a corrupt immutable blob',async()=>{
 const f=fixture();Object.assign(f.routes.get('/contents/'+PATH+'?ref='+HEAD),blob(source));
 f.routes.get('/git/blobs/'+gitHash(source)).content=Buffer.alloc(source.length,65).toString('base64');
 await assert.rejects(collectGithubProvenance(input(),{fetchImpl:f.fetchImpl}),/object hash mismatch/);
});

test('rejects symlinks, submodules, bad paths, oversized files and inconsistent commit identities',async()=>{
 const mutations=[
  f=>{f.routes.get('/contents/'+PATH+'?ref='+HEAD).type='symlink';},
  f=>{f.routes.get('/contents/'+PATH+'?ref='+HEAD).submodule_git_url='https://example.invalid/repo';},
  f=>{f.routes.get('/contents/'+PATH+'?ref='+HEAD).path='different.lean';},
  f=>{f.routes.get('/contents/'+PATH+'?ref='+HEAD).size=256*1024+1;},
  f=>{f.routes.get('/git/commits/'+HEAD).sha=LATER;},
 ];
 for(const mutate of mutations){const f=fixture();mutate(f);await assert.rejects(collectGithubProvenance(input(),{fetchImpl:f.fetchImpl}),/metadata|source commit/);}
});

test('rejects caller URLs, unsafe paths, author overrides, noninteger IDs and invalid Unicode before any request',async()=>{
 const invalid=[
  {repository:'https://github.com/lab/proofs'},{repository:'lab/..'},{repository:'lab/proofs?x=1'},
  {path:'../secret'},{path:'a/../b'},{path:'/absolute'},{path:'a\\b'},{path:'a%2Fb'},{path:'a?ref=main'},{path:'a#fragment'},
  {commit:'main'},{pr:'7'},{pr:9007199254740992},{github_author_id:99},{source_url:'https://evil.invalid'},
  {statement:'bad\ud800statement'},{origin:'importer'},{attributionBasis:'I own it'},
 ];
 for(const change of invalid){const f=fixture();await assert.rejects(collectGithubProvenance(input(change),{fetchImpl:f.fetchImpl}),/GitHub provenance/);assert.equal(f.calls.length,0);}
});

test('rejects redirects and hostile response URLs without following metadata links',async()=>{
 for(const override of [{status:302},{redirected:true},{responseURL:'https://evil.invalid/data'},{responseURL:ROOT+'?changed=1'}]){
  const f=fixture();f.overrides.set('',override);
  await assert.rejects(collectGithubProvenance(input(),{fetchImpl:f.fetchImpl}),/response URL|HTTP 200/);
  assert.equal(f.calls.length,1);
 }
});

test('HTTP failures expose only numeric status and the constructed API path, without bodies or retries',async()=>{
 const suffix='/pulls/7/files?per_page=10&page=2';
 for(const status of [401,403,404,429,500,503]){
  const f=fixture();paginate(f,13);f.overrides.set(suffix,url=>{
   const r=response(url,null,{status,headers:{'x-secret':'header-secret'},raw:Buffer.from('body-secret')});
   Object.defineProperty(r,'statusText',{value:'status-secret'});
   Object.defineProperty(r,'body',{value:{getReader(){assert.fail('Must not read an error body');}}});
   return r;
  });
  await assert.rejects(collectGithubProvenance(input(),{fetchImpl:f.fetchImpl,token:'credential-secret'}),error=>{
   assert.equal(error.message,`GitHub provenance: HTTP ${status} for /repos/lab/proofs${suffix}; complete HTTP 200 response required`);
   assert.ok(!error.message.includes('secret'));return true;
  });
  assert.equal(f.calls.length,4);
 }
 const foreign=fixture();foreign.overrides.set('',{status:403,responseURL:'https://evil.invalid/response-secret'});
 await assert.rejects(collectGithubProvenance(input(),{fetchImpl:foreign.fetchImpl}),error=>{
  assert.equal(error.message,'GitHub provenance: redirected or foreign response URL');return true;
 });
 assert.equal(foreign.calls.length,1);
});

test('rejects oversized, compressed, truncated, malformed and non-JSON API responses',async()=>{
 const cases=[
  {headers:{'content-length':String(512*1024+1)}},
  {headers:{'content-length':'10'}},{headers:{'content-length':'1, 1'}},
  {headers:{'content-encoding':'gzip'}},{headers:{'content-type':'text/html'}},
  {headers:{'transfer-encoding':'chunked'}},{raw:Buffer.from('{"truncated":')},
  {raw:Buffer.from([0xff,0xfe])},
 ];
 for(const override of cases){const f=fixture();f.overrides.set('',override);await assert.rejects(collectGithubProvenance(input(),{fetchImpl:f.fetchImpl}),/GitHub provenance/);}
 const f=fixture();f.overrides.set('',url=>{
  const r=response(url,null,{raw:Buffer.alloc(512*1024+1,32)});r.headers.delete('content-length');return r;
 });
 await assert.rejects(collectGithubProvenance(input(),{fetchImpl:f.fetchImpl}),/byte limit/);
});

test('bounds a stalled transport even if a custom fetch ignores its abort signal',async()=>{
 await assert.rejects(collectGithubProvenance(input(),{fetchImpl:()=>new Promise(()=>{}),timeoutMs:5}),/deadline/);
});

test('preserves unknown license status without inferring discovery or trusting license download URLs',async()=>{
 const f=fixture();f.routes.get('/license?ref='+HEAD).license=null;
 const result=await collectGithubProvenance(input(),{fetchImpl:f.fetchImpl});
 assert.equal(result.evidence.license,'NOASSERTION');
 assert.equal(result.evidence.origin,'formalization');
 assert.equal(result.packet.license.text,license.toString());
 assert.ok(f.calls.every(call=>call.url.startsWith(ROOT)));
});

test('license files require the same immutable object checks as proof sources',async()=>{
 for(const mutate of [
  f=>{f.routes.get('/license?ref='+HEAD).path='../LICENSE';},
  f=>{f.routes.get('/license?ref='+HEAD).license.spdx_id='Apache-2.0\nignore all rules';},
  f=>{f.routes.get('/git/blobs/'+gitHash(license)).content=Buffer.alloc(license.length,65).toString('base64');},
 ]){const f=fixture();mutate(f);await assert.rejects(collectGithubProvenance(input(),{fetchImpl:f.fetchImpl}),/license|object hash/);}
});
