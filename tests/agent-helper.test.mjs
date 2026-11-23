import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {abi} from 'genlayer-js';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {contributorPath,toolRoot,run} from '../scripts/agent.mjs';
import {digest} from '../src/security.mjs';
const helper=path.join(toolRoot,'scripts/agent.mjs'),wallet='0x'+'1'.repeat(40);
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'open-math-agent-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function invoke(cwd,args){return spawnSync(process.execPath,[helper,...args],{cwd,encoding:'utf8',timeout:15000});}
function record(){const s=JSON.parse(fs.readFileSync(path.join(toolRoot,'research/SUBMISSION_TEMPLATE.json'),'utf8'));s.title='Explicit CNF variable renaming';s.claim='For every assignment and CNF formula, renaming preserves the specified composed evaluation.';s.novelty='This is established mathematics integrated into the exact trusted CNF representation for independent verification.';s.attribution.wallet=wallet;s.provenance={mode:'extension',sources:[],discovery_basis:'Established CNF semantics used as a local test fixture; no discovery or publication priority is claimed.'};return s;}
test('trusted helper help and init work outside any repository and ignore worktree metadata',t=>{
 const root=temporary(t);fs.mkdirSync(path.join(root,'public'));fs.writeFileSync(path.join(root,'public/deployment.json'),'malformed untrusted data');
 let r=invoke(root,['help']);assert.equal(r.status,0,r.stderr);const info=JSON.parse(r.stdout);assert.equal(info.toolRoot,toolRoot);assert.equal(info.worktree,fs.realpathSync(root));
 r=invoke(os.tmpdir(),['--worktree',root,'init','renaming','example',wallet]);assert.equal(r.status,0,r.stderr);
 const s=JSON.parse(fs.readFileSync(path.join(root,'research/submissions/example.json')));assert.equal(s.attribution.wallet,wallet);assert.equal(s.evidence.goal,'renaming');
});
test('worktree confinement rejects traversal and both live and dangling outward symlinks',t=>{
 const root=temporary(t),outside=temporary(t);fs.symlinkSync(outside,path.join(root,'escape'));fs.symlinkSync(path.join(outside,'not-created'),path.join(root,'dangling'));
 for(const file of ['../outside',outside,'escape/file.json','dangling'])assert.throws(()=>contributorPath(root,file));
 assert.equal(contributorPath(root,'research/submissions/new.json'),path.join(fs.realpathSync(root),'research/submissions/new.json'));
});
test('check executes trusted Python assembly while reading only contributor proof and record',t=>{
 const root=temporary(t);for(const dir of ['research/submissions','research/proofs','lean'])fs.mkdirSync(path.join(root,dir),{recursive:true});
 fs.writeFileSync(path.join(root,'research/submissions/example.json'),JSON.stringify(record(),null,2)+'\n');
 fs.copyFileSync(path.join(toolRoot,'fixtures/renaming.proof'),path.join(root,'research/proofs/renaming.proof'));
 fs.writeFileSync(path.join(root,'lean/check.py'),'raise RuntimeError("untrusted fork Python executed")');
 fs.writeFileSync(path.join(root,'lean/policy.json'),'untrusted policy');
 const r=invoke(root,['check','research/submissions/example.json']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).proofGrammar,'valid');assert.match(JSON.parse(r.stdout).lean,/NOT RUN/);
});
test('prepare uses immutable remote blobs without a local PR commit or Git repository',async t=>{
 const root=temporary(t),d=JSON.parse(fs.readFileSync(path.join(toolRoot,'public/deployment.json'))),head='b'.repeat(40),base='c'.repeat(40),blob='d'.repeat(40),proof='e'.repeat(40),bytes=Buffer.from(JSON.stringify(record(),null,2)+'\n');
 const previousFetch=globalThis.fetch,previousLog=console.log,previousExit=process.exitCode,output=[];
 t.after(()=>{globalThis.fetch=previousFetch;console.log=previousLog;process.exitCode=previousExit;});
 console.log=x=>output.push(JSON.parse(x));
 globalThis.fetch=async url=>{
  const p=new URL(url).pathname;let data;
  if(p.endsWith('/pulls/7'))data={state:'open',head:{sha:head},base:{sha:base,ref:d.branch}};
  else if(p.includes('/git/ref/heads/'))data={object:{type:'commit',sha:base}};
  else if(p.endsWith('/git/trees/'+head))data={tree:[{path:'research/proofs/renaming.proof',sha:proof,type:'blob',mode:'100644'},{path:'research/submissions/example.json',sha:blob,type:'blob',mode:'100644'}]};
  else if(p.endsWith('/git/trees/'+base))data={tree:[]};
  else if(p.endsWith('/git/commits/'+head))data={parents:[{sha:base}]};
  else if(p.endsWith('/git/blobs/'+blob))data={sha:blob,encoding:'base64',size:bytes.length,content:bytes.toString('base64')};
  else throw Error('Unexpected API read');
  return {ok:true,status:200,json:async()=>data};
 };
 await run(['--worktree',root,'prepare','7','research/submissions/example.json',wallet]);
 assert.equal(output.length,1);assert.equal(output[0].claim.submission_hash,digest(bytes));assert.equal(output[0].claim.head,head);assert.ok(output[0].expiresAt);assert.equal(fs.existsSync(path.join(root,'.git')),false);
});

function nativeSendFixture(t){
 const root=temporary(t),keyFile=path.join(root,'test-signer.key'),key=generatePrivateKey();
 fs.writeFileSync(keyFile,key+'\n',{mode:0o600});
 const previousKeyFile=process.env.CONTRIBUTOR_KEY_FILE,previousLog=console.log,previousError=console.error,previousExit=process.exitCode;
 const stdout=[],stderr=[];
 t.after(()=>{
  if(previousKeyFile===undefined)delete process.env.CONTRIBUTOR_KEY_FILE;else process.env.CONTRIBUTOR_KEY_FILE=previousKeyFile;
  console.log=previousLog;console.error=previousError;process.exitCode=previousExit;
 });
 process.env.CONTRIBUTOR_KEY_FILE=keyFile;
 console.log=x=>stdout.push(JSON.parse(x));console.error=x=>stderr.push(JSON.parse(x));
 const deployment=JSON.parse(fs.readFileSync(path.join(toolRoot,'public/deployment.json')));
 const hash='0x'+'a'.repeat(64),account=privateKeyToAccount(key);
 const details={contract:deployment.contract,chainId:deployment.chainId,method:'set_affiliation',wallet:account.address};
 const sender={account};
 const invokeNative=(args,reader=sender)=>run(['--worktree',root,...args],{clientFor:suppliedKey=>suppliedKey?sender:reader});
 const receipt=(method,args)=>({
  hash,to_address:details.contract,statusName:'FINALIZED',leader_only:false,
  data:{calldata:{raw:[...abi.calldata.encode({method,args})]}},
  consensus_data:{leader_receipt:[{execution_result:'SUCCESS'}]},
 });
 return {root,key,hash,details,sender,stdout,stderr,invokeNative,receipt};
}

test('a submitted native transaction is reported before polling, with its hash retained on finality failure',async t=>{
 const f=nativeSendFixture(t);
 let broadcasts=0;
 f.sender.writeContract=async call=>{
  broadcasts++;
  assert.deepEqual(call,{address:f.details.contract,functionName:'set_affiliation',args:['shared'],leaderOnly:false});
  return f.hash;
 };
 f.sender.getTransaction=async args=>{
  assert.deepEqual(args,{hash:f.hash});
  assert.deepEqual(f.stderr,[{event:'native-transaction',status:'broadcast',...f.details,hash:f.hash}]);
  assert.deepEqual(f.stdout,[]);
  return {statusName:'LEADER_TIMEOUT'};
 };
 await f.invokeNative(['affiliation','shared','--send']);
 assert.equal(broadcasts,1);assert.equal(process.exitCode,1);assert.deepEqual(f.stdout,[]);
 assert.equal(f.stderr.length,2);
 const {error,next,...transaction}=f.stderr[1];
 assert.deepEqual(transaction,{status:'finality-unverified',...f.details,hash:f.hash});
 assert.match(error,/finality could not be verified/);assert.match(next,/Inspect the receipt.*before retrying/);
});

test('a timed-out write reports an unknown broadcast outcome without repeating the call or exposing raw SDK errors',async t=>{
 const f=nativeSendFixture(t);
 let attempts=0;
 f.sender.writeContract=async()=>{attempts++;throw Error('RPC timeout on fake sensitive input '+f.key);};
 f.sender.getTransaction=async()=>assert.fail('Polling requires a valid transaction hash');
 await f.invokeNative(['affiliation','shared','--send']);
 assert.equal(attempts,1);assert.equal(process.exitCode,1);assert.deepEqual(f.stdout,[]);
 assert.equal(f.stderr.length,1);
 const {error,next,...transaction}=f.stderr[0];
 assert.deepEqual(transaction,{status:'broadcast-unknown',...f.details});
 assert.match(error,/may have been broadcast/);assert.match(next,/Inspect transaction history.*before retrying/);
 assert(!JSON.stringify(f.stderr).includes(f.key));
});

test('a structured Studio rate limit preserves the cooldown for an uncertain broadcast',async t=>{
 const f=nativeSendFixture(t);
 let attempts=0;
 f.sender.writeContract=async()=>{
  attempts++;
  throw Error('Native studio transport', {cause:{code:-32029, data:{retry_after_seconds:1020,limit:500,other:f.key}}});
 };
 await f.invokeNative(['affiliation','shared','--send']);
 assert.equal(attempts,1);assert.equal(f.stderr.length,1);
 const {status,rateLimit,next}=f.stderr[0];
 assert.equal(status,'broadcast-unknown');
 assert.deepEqual(rateLimit,{retryAfterSeconds:1020,limit:500});
 assert.match(next,/^Wait at least 1020 seconds.*Inspect transaction history/);
 assert(!JSON.stringify(f.stderr).includes(f.key));
});

test('an input error is reported before any native broadcast',async t=>{
 const f=nativeSendFixture(t);
 f.sender.writeContract=async()=>assert.fail('Invalid affiliation must not broadcast');
 await f.invokeNative(['affiliation','invalid-side','--send']);
 assert.equal(process.exitCode,1);assert.deepEqual(f.stdout,[]);
 assert.equal(f.stderr.length,1);assert.equal(f.stderr[0].status,'before-broadcast');
 assert.match(f.stderr[0].error,/Choose p-equals-np/);
});

test('successful native sends retain one finalized JSON result on stdout',async t=>{
 const f=nativeSendFixture(t);
 f.sender.writeContract=async()=>f.hash;
 f.sender.getTransaction=async()=>f.receipt('set_affiliation',['shared']);
 await f.invokeNative(['affiliation','shared','--send']);
 assert.equal(f.stderr.length,1);assert.equal(f.stderr[0].status,'broadcast');
 assert.equal(f.stdout.length,1);assert.equal(f.stdout[0].status,'finalized');assert.equal(f.stdout[0].hash,f.hash);
});

test('post-finality report lookup errors retain the finalized transaction identity',async t=>{
 const f=nativeSendFixture(t);
 const payload={
  claim:'This explicitly inconclusive fixture tests the follow-up report lookup.',
  component:'Documentary workflow',
  sources:[{reference:'https://example.org/source',title:'Fixture source',authors:['Example Author'],relationship:'The fixture refers to this example publication for identification.',priority_evidence:'This example records no mathematical discovery.'}],
 };
 const reportFile=path.join(f.root,'case.json');
 fs.writeFileSync(reportFile,JSON.stringify(payload));
 const reader={readContract:async({functionName})=>{
  if(functionName==='get_problem')return {id:'p-vs-np',status:'open'};
  assert.equal(functionName,'get_case_capacity');return {available:4};
 }};
 f.sender.writeContract=async()=>f.hash;
 f.sender.getTransaction=async()=>f.receipt('report_case',['external-solution','p-vs-np',JSON.stringify(payload)]);
 f.sender.readContract=async({functionName})=>{
  assert.equal(functionName,'list_cases');
  throw {code:-32029, data:{retry_after_seconds:1020,limit:500}};
 };
 await f.invokeNative(['case-report','external-solution','p-vs-np',reportFile,'--send'],reader);
 assert.equal(process.exitCode,1);assert.deepEqual(f.stdout,[]);
 assert.equal(f.stderr.length,2);
 const {error,next,rateLimit,...transaction}=f.stderr[1];
 assert.deepEqual(transaction,{status:'result-unavailable',...f.details,method:'report_case',hash:f.hash});
 assert.deepEqual(rateLimit,{retryAfterSeconds:1020,limit:500});
 assert.match(error,/transaction finalized/);assert.match(next,/^Wait at least 1020 seconds.*Inspect the finalized receipt/);
});
