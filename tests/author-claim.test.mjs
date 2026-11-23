import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {GitHub} from '../src/github.mjs';
import {digest,message} from '../src/security.mjs';

const account=privateKeyToAccount(generatePrivateKey());
const otherAccount=privateKeyToAccount(generatePrivateKey());
const repository='fixture/research',prNumber=7,commentId=101,author=20;
const createdAt='2026-11-22T12:00:00Z';
const issue=`https://api.github.com/repos/${repository}/issues/${prNumber}`;
const prPath=`/pulls/${prNumber}`,commentPath=`/issues/comments/${commentId}`;

const sign=async(claim,signer=account)=>({claim,signature:await signer.signMessage({message:message(claim)})});
const marker=claim=>`Open-Mathematics-Claim: ${digest(claim)}`;
const commentBody=(envelope,json=JSON.stringify(envelope,null,2))=>[marker(envelope.claim),'```json',json,'```',''].join('\n');

async function fixture(){
  const claim={
    version:2,domain:'https://example.org',chainId:61999,problem:'p-vs-np',repository,pr:prNumber,
    head:'a'.repeat(40),base:'b'.repeat(40),branch:'research',contract:'0x'+'1'.repeat(40),
    policy:'c'.repeat(64),submission_path:'research/submissions/fixture.json',submission_hash:'d'.repeat(64),
    wallet:account.address,nonce:'e'.repeat(32),expires:Date.parse(createdAt)+300000,
  };
  const envelope=await sign(claim);
  const state={
    pr:{number:prNumber,user:{id:author},head:{sha:claim.head},base:{repo:{full_name:repository}}},
    comment:{id:commentId,user:{id:author},issue_url:issue,created_at:createdAt,updated_at:createdAt,body:commentBody(envelope)},
    calls:[],
  };
  const root=`https://api.github.com/repos/${repository}`;
  const gh=new GitHub({repository,fetcher:async url=>{
    assert(url.startsWith(root));
    const endpoint=url.slice(root.length);
    state.calls.push(endpoint);
    assert([prPath,commentPath].includes(endpoint),'The verifier must never list or search alternate comments');
    const payload=endpoint===prPath?state.pr:state.comment;
    return {ok:!!payload,status:payload?200:404,json:async()=>payload};
  }});
  const verify=(binding={commentId,createdAt},claimEnvelope=envelope)=>gh.bindAuthor(claimEnvelope,binding);
  return {claim,envelope,state,verify};
}

test('rechecks the exact selected comment and PR and accepts a full matching envelope',async()=>{
  const f=await fixture();
  assert.equal(await f.verify(),f.state.pr);
  assert.deepEqual(f.state.calls,[prPath,commentPath]);
});

test('matches the parsed signed envelope while accepting harmless JSON formatting differences',async()=>{
  const f=await fixture();
  const reordered={signature:f.envelope.signature,claim:Object.fromEntries(Object.entries(f.claim).reverse())};
  f.state.comment.body=commentBody(f.envelope,JSON.stringify(reordered,null,4));
  assert.equal(await f.verify(),f.state.pr);
});

test('marker-only, malformed, edited, replaced, missing and shifted comments fail without an alternate lookup',async()=>{
  const cases=[
    [(f)=>{f.state.comment.body=marker(f.claim);},/original signed claim/],
    [(f)=>{f.state.comment.body=commentBody(f.envelope,'{ invalid');},/malformed signed claim JSON/],
    [(f)=>{f.state.comment.updated_at='2026-11-22T12:01:00Z';},/was edited/],
    [(f)=>{f.state.comment.id=commentId+1;},/does not belong/],
    [(f)=>{f.state.comment=null;},/GitHub 404/],
    [(f)=>{f.state.comment.created_at=f.state.comment.updated_at='2026-11-22T12:01:00Z';},/original creation time/],
    [(f)=>{f.state.comment.created_at=f.state.comment.updated_at='invalid date';},/original creation time/],
  ];
  for(const [change,error] of cases){
    const f=await fixture();change(f);
    await assert.rejects(f.verify(),error);
    assert.deepEqual(f.state.calls,[prPath,commentPath]);
  }
});

test('rejects changes in issue, PR number, repository, head and GitHub author',async()=>{
  const cases=[
    f=>{f.state.comment.issue_url=issue+'/other';},
    f=>{f.state.comment.issue_url=issue.replace(repository,'fixture/other');},
    f=>{f.state.comment.user.id=author+1;},
    f=>{f.state.pr.user.id=author+1;},
    f=>{f.state.pr.number=prNumber+1;},
    f=>{f.state.pr.base.repo.full_name='fixture/other';},
    f=>{f.state.pr.head.sha='f'.repeat(40);},
  ];
  for(const change of cases){
    const f=await fixture();change(f);
    await assert.rejects(f.verify(),/Stale claim|does not belong/);
  }
});

test('an alternate wallet, signed head or signature cannot replace the expected signed envelope',async()=>{
  const f=await fixture();
  for(const alternate of [
    await sign({...f.claim,wallet:otherAccount.address},otherAccount),
    await sign({...f.claim,head:'f'.repeat(40)}),
    await sign(f.claim,otherAccount),
  ]){
    f.state.comment.body=commentBody(f.envelope,JSON.stringify(alternate));
    await assert.rejects(f.verify(),/signed claim has changed/);
  }
});

test('missing selected ID or malformed original creation time stops before any GitHub request',async()=>{
  const f=await fixture();
  for(const binding of [{createdAt},{commentId:0,createdAt},{commentId},{commentId,createdAt:'invalid time'}]){
    await assert.rejects(f.verify(binding),/comment ID and original creation time required/);
  }
  assert.deepEqual(f.state.calls,[]);
});

test('the verifier subprocess requires the worker comment ID and original time before loading claim data',()=>{
  const cwd=fileURLToPath(new URL('..',import.meta.url));
  for(const env of [
    {CLAIM_CREATED_AT:createdAt},
    {CLAIM_COMMENT_ID:String(commentId),CLAIM_CREATED_AT:'invalid time'},
  ]){
    const result=spawnSync(process.execPath,['github/verify-pr.mjs','unused-fixture.json'],{cwd,env,encoding:'utf8',timeout:5000});
    assert.equal(result.status,1,result.stderr);
    assert.match(result.stderr,/comment ID and original creation time required/);
  }
});
