import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {privateKeyToAccount} from 'viem/accounts';
import {resolveContributorGitHubToken,createLocalWallet,localWalletAddress} from '../scripts/contributor-local.mjs';

function temporary(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'open-math-local-test-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;
}

test('GitHub credentials prefer explicit environment values without reading the CLI',()=>{
 const run=()=>assert.fail('Explicit credentials must not invoke gh');
 assert.equal(resolveContributorGitHubToken({env:{GITHUB_TOKEN:' first ',GH_TOKEN:'second'},run}),'first');
 assert.equal(resolveContributorGitHubToken({env:{GH_TOKEN:'second'},run}),'second');
 assert.equal(resolveContributorGitHubToken({env:{GITHUB_TOKEN:' ',GH_TOKEN:'second'},run}),'second');
});

test('CLI read credentials are captured with bounded pipe-only output and no auth-status probe',()=>{
 const env={PATH:'/trusted/bin'};
 const value=resolveContributorGitHubToken({env,run:(command,args,options)=>{
  assert.equal(command,'gh');assert.deepEqual(args,['auth','token','--hostname','github.com']);
  assert.deepEqual(options.stdio,['ignore','pipe','pipe']);assert.equal(options.timeout,4000);
  assert.equal(options.maxBuffer,16384);assert.equal(options.encoding,'utf8');assert.equal(options.env,env);
  return {status:0,stdout:'fake-test-token\n',stderr:'discarded diagnostics'};
 }});
 assert.equal(value,'fake-test-token');
});

test('CLI failures stay anonymous and never expose subprocess errors or malformed credential material',()=>{
 for(const result of [{status:1,stdout:'fake-secret',stderr:'fake-secret'},
  {status:0,error:Error('fake-secret'),stdout:'fake-secret'},
  {status:0,signal:'SIGTERM',stdout:'fake-secret'},
  {status:0,stdout:'fake-secret\ninjected-header'},
  {status:0,stdout:'x'.repeat(8193)},undefined]){
  assert.equal(resolveContributorGitHubToken({env:{},run:()=>result}),undefined);
 }
 assert.equal(resolveContributorGitHubToken({env:{},run:()=>{throw Error('fake-secret');}}),undefined);
 assert.throws(()=>resolveContributorGitHubToken({env:{GITHUB_TOKEN:'fake-secret\ninjected-header'}}),error=>
  error.message==='Invalid GitHub read credential configuration'&&!error.message.includes('fake-secret'));
});

test('wallet creation is exclusive owner-only and exposes only the matching public address',t=>{
 const root=temporary(t),file=path.join(root,'contributor.key');
 const result=createLocalWallet(file),key=fs.readFileSync(file,'utf8').trim();
 assert.match(key,/^0x[0-9a-f]{64}$/);assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.deepEqual(result,{address:privateKeyToAccount(key).address});
 assert.deepEqual(localWalletAddress(file),result);assert.equal(JSON.stringify(result).includes(key),false);
 assert.throws(()=>createLocalWallet(file),/overwrite/);assert.equal(fs.readFileSync(file,'utf8').trim(),key);
});

test('wallet destinations reject relative, missing-parent, symlink and repository paths',t=>{
 const root=temporary(t),repo=path.join(root,'repository'),guarded=path.join(root,'guarded');
 fs.mkdirSync(repo);fs.mkdirSync(guarded);fs.writeFileSync(path.join(repo,'.git'),'gitdir: /outside/git');
 const nested=path.join(repo,'nested');fs.mkdirSync(nested);
 fs.symlinkSync(guarded,path.join(root,'linked-parent'));
 fs.symlinkSync(path.join(root,'missing-target'),path.join(root,'dangling.key'));
 for(const file of ['relative.key',path.join(root,'missing-parent','key'),path.join(root,'linked-parent','key'),
  path.join(root,'dangling.key'),path.join(nested,'key')]){
  assert.throws(()=>createLocalWallet(file));assert.throws(()=>localWalletAddress(file));
 }
 assert.throws(()=>createLocalWallet(path.join(guarded,'key'),{roots:[guarded]}),/outside all repositories/);
 assert.equal(fs.existsSync(path.join(guarded,'key')),false);
 assert.throws(()=>createLocalWallet(guarded),/overwrite/);
});

test('wallet address rejects unsafe permissions and key errors without disclosing the file contents',t=>{
 const root=temporary(t),file=path.join(root,'key');
 fs.writeFileSync(file,'private-test-content-that-is-not-a-key',{mode:0o600});
 assert.throws(()=>localWalletAddress(file),error=>/valid local wallet/.test(error.message)&&!error.message.includes('private-test-content'));
 fs.chmodSync(file,0o644);assert.throws(()=>localWalletAddress(file),/chmod 600/);
 fs.chmodSync(file,0o600);fs.writeFileSync(file,'x'.repeat(257));assert.throws(()=>localWalletAddress(file),/bounded regular/);
 const link=path.join(root,'linked.key');fs.symlinkSync(file,link);assert.throws(()=>localWalletAddress(link),/symlink/);
});
