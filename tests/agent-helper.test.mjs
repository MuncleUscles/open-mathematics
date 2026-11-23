import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {contributorPath,toolRoot,run} from '../scripts/agent.mjs';
import {digest} from '../src/security.mjs';
const helper=path.join(toolRoot,'scripts/agent.mjs'),wallet='0x'+'1'.repeat(40);
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'open-math-agent-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function invoke(cwd,args){return spawnSync(process.execPath,[helper,...args],{cwd,encoding:'utf8',timeout:15000});}
function record(){const s=JSON.parse(fs.readFileSync(path.join(toolRoot,'research/SUBMISSION_TEMPLATE.json'),'utf8'));s.title='Explicit CNF variable renaming';s.claim='For every assignment and CNF formula, renaming preserves the specified composed evaluation.';s.novelty='This is established mathematics integrated into the exact trusted CNF representation for independent verification.';s.attribution.wallet=wallet;return s;}
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
