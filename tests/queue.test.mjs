import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {digest,message} from '../src/security.mjs';
import {selectClaim,validateQueuedClaim} from '../github/select-claim.mjs';

const account=privateKeyToAccount(generatePrivateKey());
const deployment={protocolVersion:2,repository:'owner/research',origin:'https://example.org',chainId:61999,
  contract:'0x'+'1'.repeat(40),policy:'a'.repeat(64),branch:'research'};
const head='b'.repeat(40),base='c'.repeat(40),created='2026-11-22T12:00:00Z';
async function fixture({prNumber=1,commentId=11,time=created,change={}}={}){
  const claim={version:2,domain:deployment.origin,chainId:deployment.chainId,problem:'p-vs-np',repository:deployment.repository,
    pr:prNumber,head,base,branch:deployment.branch,contract:deployment.contract,policy:deployment.policy,
    submission_path:'research/submissions/lemma.json',submission_hash:'d'.repeat(64),wallet:account.address,
    nonce:'e'.repeat(32),expires:Date.parse(time)+300000,...change};
  const envelope={claim,signature:await account.signMessage({message:message(claim)})};
  const comment={id:commentId,created_at:time,updated_at:time,user:{id:5},
    issue_url:`https://api.github.com/repos/${deployment.repository}/issues/${prNumber}`,
    body:`Open-Mathematics-Claim: ${digest(claim)}\n\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\``};
  const pr={id:prNumber,number:prNumber,state:'open',merged:false,user:{id:5},created_at:time,
    base:{sha:base,ref:deployment.branch,repo:{full_name:deployment.repository}},head:{sha:head}};
  const id=`pr-${prNumber}-${head.slice(0,12)}-${digest(claim).slice(0,12)}`;
  const report={id,commentId,contract:deployment.contract,repository:deployment.repository,pr:prNumber,head,base,
    claim:envelope,status:'provisional',transactions:{adjudicate:{hash:'0x'+'f'.repeat(64)}}};
  return {claim,envelope,comment,pr,id,report};
}
const validate=f=>validateQueuedClaim({deployment,canonicalHead:base,comment:f.comment,pr:f.pr});
function harness(fixtures,{entries=[],reports={},canonicalHead=base,list=fixtures.map(f=>f.pr)}={}){
  const calls=[];
  const github={repository:deployment.repository,branchHead:async()=>canonicalHead,
    pr:async n=>structuredClone(fixtures.find(f=>f.pr.number===n)?.pr),
    request:async p=>{calls.push(p);if(p.startsWith('/pulls?'))return structuredClone(list);
      const direct=p.match(/^\/issues\/comments\/(\d+)$/);if(direct){const c=fixtures.find(f=>f.comment.id===Number(direct[1]))?.comment;if(!c)throw Error('GitHub 404');return structuredClone(c);}
      const comments=p.match(/^\/issues\/(\d+)\/comments\?/);if(comments)return fixtures.filter(f=>f.pr.number===Number(comments[1])).map(f=>structuredClone(f.comment));
      throw Error('Unexpected request');}};
  const readEvidence=async p=>p==='index.json'?{entries}:reports[p]||null;
  return {github,readEvidence,calls};
}

test('valid author claim uses historical comment creation time rather than queue execution time',async()=>{
  const f=await fixture();const c=await validate(f);assert.equal(c.commentId,11);assert.equal(c.id,f.id);
});
test('queue rejects unrelated, edited, stolen, malformed and stale claims before expensive work',async()=>{
  const original=await fixture();
  const mutations=[f=>f.comment.body='unrelated',f=>f.comment.body=' '+f.comment.body,
    f=>f.comment.updated_at='2026-11-22T12:01:00Z',f=>f.comment.created_at=f.comment.updated_at='not-a-time',
    f=>f.comment.user.id=8,f=>f.comment.issue_url+='2',f=>f.pr.state='closed',f=>f.pr.merged=true,
    f=>f.pr.head.sha='f'.repeat(40),f=>f.pr.base.sha='f'.repeat(40),f=>f.pr.base.ref='main',
    f=>f.pr.base.repo.full_name='attacker/fork',f=>f.comment.body=f.comment.body.replace('"pr":1','"pr":2')];
  for(const mutate of mutations){const f=structuredClone(original);mutate(f);assert.equal(await validate(f),null);}
  assert.equal(await validateQueuedClaim({deployment,canonicalHead:'f'.repeat(40),comment:original.comment,pr:original.pr}),null);
  for(const change of [{contract:'0x'+'2'.repeat(40)},{policy:'f'.repeat(64)},{branch:'main'},
    {domain:'https://evil.test'},{chainId:1},{wallet:privateKeyToAccount(generatePrivateKey()).address},
    {expires:Date.parse(created)-1},{expires:Date.parse(created)+600001}]){
    assert.equal(await validate(await fixture({change})),null);
  }
});
test('schedule and blank manual dispatch choose the oldest eligible PR then claim',async()=>{
  const a=await fixture({prNumber:1,commentId:11}),later=await fixture({prNumber:2,commentId:22,time:'2026-11-22T13:00:00Z'});
  for(const eventName of ['schedule','workflow_dispatch']){
    const h=harness([later,a],{list:[later.pr,a.pr]});
    const selected=await selectClaim({...h,deployment,eventName,event:{inputs:{comment_id:''}}});
    assert.equal(selected.commentId,11);assert.ok(h.calls[0].includes('sort=created&direction=asc&per_page=100&page=1'));
  }
});
test('created comment and explicit dispatch re-fetch the requested comment without scanning',async()=>{
  const f=await fixture();
  for(const [eventName,event] of [['issue_comment',{action:'created',issue:{pull_request:{}},comment:{id:11}}],
    ['workflow_dispatch',{inputs:{comment_id:'11'}}]]){
    const h=harness([f]);assert.equal((await selectClaim({...h,deployment,eventName,event})).commentId,11);
    assert.deepEqual(h.calls,['/issues/comments/11']);
  }
  const h=harness([f]);assert.equal(await selectClaim({...h,deployment,eventName:'workflow_dispatch',event:{inputs:{comment_id:'11; echo key'}}}),null);
  assert.equal(h.calls.length,0);
});
test('terminal stable IDs are skipped but a different claim remains eligible',async()=>{
  const a=await fixture(),b=await fixture({prNumber:2,commentId:22});
  for(const status of ['credited','rejected','invalid','expired']){
    const h=harness([a,b],{entries:[{id:a.id,status}]});
    assert.equal((await selectClaim({...h,deployment,eventName:'schedule'})).commentId,22);
  }
});
test('saved exact claim resumes a merged credited result with unfinished later impact',async()=>{
  const f=await fixture();f.pr.state='closed';f.pr.merged=true;f.pr.base.sha='f'.repeat(40);f.report.status='credited';
  const entry={id:f.id,commentId:11,status:'credited',needsResume:true,updatedAt:created};
  const h=harness([f],{list:[],canonicalHead:'f'.repeat(40),entries:[entry],reports:{[`reports/${f.id}.json`]:f.report}});
  assert.equal((await selectClaim({...h,deployment,eventName:'schedule'})).commentId,11);
  assert.deepEqual(h.calls,['/issues/comments/11']);
  f.report.completedAt=created;
  assert.equal(await selectClaim({...h,deployment,eventName:'schedule'}),null);
});
test('saved stale unmerged claim is recoverable for expiration but fresh stale claim is not',async()=>{
  const f=await fixture();f.pr.head.sha='a'.repeat(40);f.pr.base.sha='f'.repeat(40);
  const h=harness([f],{canonicalHead:'f'.repeat(40),entries:[{id:f.id,commentId:11,status:'provisional',needsResume:true,updatedAt:created}],reports:{[`reports/${f.id}.json`]:f.report}});
  assert.equal((await selectClaim({...h,deployment,eventName:'schedule'})).commentId,11);
  assert.equal(await selectClaim({...harness([f],{canonicalHead:'f'.repeat(40)}),deployment,eventName:'workflow_dispatch',event:{inputs:{comment_id:'11'}}}),null);
});
test('saved retargeted approval is queued for expiration while a fresh one is ignored',async()=>{
  const f=await fixture();
  f.pr.base.ref='other';
  f.report.status='approved';
  const entry={id:f.id,commentId:11,status:'approved',needsResume:true,updatedAt:created};
  const saved=harness([f],{list:[],entries:[entry],reports:{[`reports/${f.id}.json`]:f.report}});
  assert.equal((await selectClaim({...saved,deployment,eventName:'schedule'})).commentId,11);
  const fresh=harness([f]);
  assert.equal(await selectClaim({...fresh,deployment,eventName:'workflow_dispatch',event:{inputs:{comment_id:'11'}}}),null);
});
test('resume requires the original exact saved envelope and comment',async()=>{
  const f=await fixture();
  for(const mutate of [r=>r.commentId=99,r=>r.claim.claim.head='f'.repeat(40),r=>r.contract='0x'+'3'.repeat(40),r=>r.status='invalid',r=>r.status='rejected',r=>r.status='expired']){
    const report=structuredClone(f.report);mutate(report);
    const h=harness([f],{reports:{[`reports/${f.id}.json`]:report}});
    assert.equal(await selectClaim({...h,deployment,eventName:'workflow_dispatch',event:{inputs:{comment_id:'11'}}}),null);
  }
});
test('explicit dispatch can reopen an exact blocked journal while automatic runs skip it',async()=>{
  const f=await fixture();
  f.pr.state='closed';f.pr.merged=true;
  Object.assign(f.report,{status:'credited',blockedConsensus:true,completedAt:created});
  const entry={id:f.id,commentId:11,status:'credited',needsResume:false,updatedAt:created};
  const saved=harness([f],{list:[],entries:[entry],reports:{[`reports/${f.id}.json`]:f.report}});
  assert.equal(await selectClaim({...saved,deployment,eventName:'schedule'}),null);
  assert.equal(await selectClaim({...saved,deployment,eventName:'issue_comment',event:{action:'created',issue:{pull_request:{}},comment:{id:11}}}),null);
  const manual={...saved,deployment,eventName:'workflow_dispatch',event:{inputs:{comment_id:'11'}}};
  assert.equal((await selectClaim(manual)).commentId,11);
  f.report.commentId=19;
  assert.equal(await selectClaim(manual),null);
});
test('a registration journal without a native record stays eligible for recovery',async()=>{
  const f=await fixture();
  f.report.status='registration-pending';
  f.report.transactions={register:{intent:{method:'register'}}};
  const entry={id:f.id,commentId:11,status:f.report.status,needsResume:true,updatedAt:created};
  const h=harness([f],{list:[],entries:[entry],reports:{[`reports/${f.id}.json`]:f.report}});
  assert.equal((await selectClaim({...h,deployment,eventName:'schedule'})).commentId,11);
});
test('deleted recovery comment does not block later eligible work and API failures fail closed',async()=>{
  const f=await fixture(),h=harness([f],{entries:[{id:'missing',commentId:999,status:'provisional',needsResume:true,updatedAt:created}]});
  assert.equal((await selectClaim({...h,deployment,eventName:'schedule'})).commentId,11);
  h.github.request=async()=>{throw Error('GitHub 403');};
  await assert.rejects(selectClaim({...h,deployment,eventName:'schedule'}),/GitHub 403/);
});
test('bounded scan ignores claims beyond the first 100 comments and first 100 PRs',async()=>{
  const f=await fixture(),h=harness([f]);
  const bad=Array.from({length:100},(_,i)=>({...f.comment,id:100+i,body:'unrelated'}));
  h.github.request=async p=>p.startsWith('/pulls?')?[f.pr]:[...bad,f.comment];
  assert.equal(await selectClaim({...h,deployment,eventName:'schedule'}),null);
  let fetched=0;const many=harness([f],{list:Array.from({length:101},(_,i)=>({...f.pr,number:i+1,id:i+1}))});
  many.github.pr=async n=>{fetched++;return {...f.pr,number:n,base:{...f.pr.base,sha:'f'.repeat(40)}};};
  assert.equal(await selectClaim({...many,deployment,eventName:'schedule'}),null);assert.equal(fetched,100);
});
test('unrelated comments never enter job concurrency and expensive steps require selection',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/research.yml',import.meta.url),'utf8');
  assert.ok(!/^concurrency:/m.test(workflow));assert.match(workflow,/    concurrency:\n      group: research-executor\n      cancel-in-progress: false/);
  assert.match(workflow,/    environment: protocol/);assert.match(workflow,/github.ref == 'refs\/heads\/protocol'/);
  assert.equal((workflow.match(/if: steps.claim.outputs.comment_id != ''/g)||[]).length,2);
  assert.match(workflow,/CLAIM_COMMENT_ID: \$\{\{ steps.claim.outputs.comment_id \}\}/);
});
