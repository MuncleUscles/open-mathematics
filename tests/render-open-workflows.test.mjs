import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const protocolCommit='6'.repeat(40);
const files=['research.yml','federation.yml'];
function fixture(implementationCommit){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'open-workflow-pins-'));
 fs.mkdirSync(path.join(directory,'.open-math'));
 fs.writeFileSync(path.join(directory,'.open-math/open.json'),JSON.stringify({schemaVersion:5,
  policy:{path:'.open-math/open-policy.json'},protocol:{repository:'MuncleUscles/open-mathematics',commit:protocolCommit}}));
 fs.writeFileSync(path.join(directory,'.open-math/open-policy.json'),JSON.stringify({version:6}));
 if(implementationCommit!==undefined)fs.writeFileSync(path.join(directory,'.open-math/github-accounts.json'),JSON.stringify({implementationCommit}));
 return directory;
}
const render=directory=>execFileSync(process.execPath,['scripts/render-open-workflows.mjs',directory,protocolCommit],{encoding:'utf8',stdio:'pipe'});

test('stale account implementation pin rejects before creating or replacing workflows',()=>{
 for(const existing of [false,true]){
  const directory=fixture('7'.repeat(40)),workflows=path.join(directory,'.github/workflows');
  try{
   if(existing){
    fs.mkdirSync(workflows,{recursive:true});
    for(const file of files)fs.writeFileSync(path.join(workflows,file),'preserve '+file+'\n');
   }
   assert.throws(()=>render(directory),error=>{
    assert.match(error.stderr.toString(),/GitHub account implementation pin must equal the workflow protocol commit/);
    return true;
   });
   if(existing){
    assert.deepEqual(fs.readdirSync(workflows).sort(),files.slice().sort());
    for(const file of files)assert.equal(fs.readFileSync(path.join(workflows,file),'utf8'),'preserve '+file+'\n');
   }else assert.equal(fs.existsSync(path.join(directory,'.github')),false);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
});

for(const [name,implementationCommit] of [['matching account pin',protocolCommit],['no account deployment',undefined]]){
 test('workflow generation preserves support for '+name,()=>{
  const directory=fixture(implementationCommit);
  try{
   assert.deepEqual(JSON.parse(render(directory)),{protocolCommit,files});
   for(const file of files){
    const workflow=fs.readFileSync(path.join(directory,'.github/workflows',file),'utf8');
    assert.match(workflow,new RegExp('repository: MuncleUscles/pnp[.]fun\\n          ref: '+protocolCommit));
   }
   for(const file of ['research.yml','federation.yml'])assert.match(fs.readFileSync(path.join(directory,'.github/workflows',file),'utf8'),/run: node github\/sync-accounts\.mjs \.\.\/problem/);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
 });
}
