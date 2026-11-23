import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {waitPagesArtifact,run} from '../github/wait-pages-artifact.mjs';

const head='a'.repeat(40),now=Date.parse('2026-11-23T22:00:00Z');
const artifact={id:123,name:'github-pages',expired:false,size_in_bytes:512,expires_at:'2026-11-24T22:00:00Z',
 workflow_run:{id:456,repository_id:789,head_repository_id:789,head_branch:'main',head_sha:head}};
const page=items=>({total_count:items.length,artifacts:items});
function fixture(pages){
 const calls=[],waits=[];let index=0;
 return {calls,waits,options:{artifactId:'123',runId:'456',repositoryId:'789',headSha:head,now:()=>now,
  sleep:async milliseconds=>{waits.push(milliseconds);},github:{request:async(route,options)=>{
   calls.push({route,options});return structuredClone(pages[Math.min(index++,pages.length-1)]);
  }}}};
}

test('Pages waits for exact uploaded artifact visibility and a second consistent observation',async()=>{
 const f=fixture([page([]),page([artifact]),page([artifact])]);
 assert.deepEqual(await waitPagesArtifact(f.options),{artifactId:123,name:'github-pages',runId:456,headSha:head,observations:2,readOnly:true});
 assert.equal(f.calls.length,3);assert.deepEqual(f.waits,[5000,5000]);
 assert(f.calls.every(call=>call.route==='/actions/runs/456/artifacts?name=github-pages&per_page=100'&&call.options.maxResponseBytes===262144));
 const g=fixture([page([artifact]),page([]),page([artifact]),page([artifact])]);
 await waitPagesArtifact(g.options);assert.equal(g.calls.length,4);
});

test('Pages refuses substituted, expired, foreign or ambiguous artifacts without retrying deployment',async()=>{
 for(const change of [{id:124},{name:'other'},{expired:true},{expires_at:'2026-11-22T22:00:00Z'},
  {size_in_bytes:0},{workflow_run:{...artifact.workflow_run,id:457}},
  {workflow_run:{...artifact.workflow_run,repository_id:790}},
  {workflow_run:{...artifact.workflow_run,head_repository_id:790}},
  {workflow_run:{...artifact.workflow_run,head_branch:'research'}},
  {workflow_run:{...artifact.workflow_run,head_sha:'b'.repeat(40)}}]){
  const f=fixture([page([{...artifact,...change}])]);
  await assert.rejects(waitPagesArtifact(f.options),/identity, scope or expiry/);assert.equal(f.calls.length,1);assert.equal(f.waits.length,0);
 }
 const f=fixture([page([artifact,{...artifact,id:124}])]);await assert.rejects(waitPagesArtifact(f.options),/ambiguous/);
});

test('Pages visibility wait is bounded and does not retry API or permission failures',async()=>{
 const f=fixture([page([])]);await assert.rejects(waitPagesArtifact(f.options),/did not become stably visible/);
 assert.equal(f.calls.length,12);assert.equal(f.waits.length,11);
 for(const status of [403,404,429,500]){
  const g=fixture([]);g.options.github.request=async()=>{g.calls.push('failed');throw Error('GitHub '+status);};
  await assert.rejects(waitPagesArtifact(g.options),new RegExp('GitHub '+status));assert.equal(g.calls.length,1);assert.equal(g.waits.length,0);
 }
 const malformed=fixture([{total_count:101,artifacts:[]}]);await assert.rejects(waitPagesArtifact(malformed.options),/bounded artifact listing/);
 const invalid=fixture([]);invalid.options.artifactId='123\nother=value';await assert.rejects(waitPagesArtifact(invalid.options),/identifiers/);assert.equal(invalid.calls.length,0);
 await assert.rejects(run({GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/research'}),/reviewed main/);
});

test('generated Pages workflow gates the existing pinned deployment on its exact upload output',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'open-pages-artifact-'));
 try{
  fs.mkdirSync(path.join(dir,'.open-math'));
  fs.writeFileSync(path.join(dir,'.open-math/open.json'),JSON.stringify({schemaVersion:5,policy:{path:'.open-math/open-policy.json'},protocol:{repository:'MuncleUscles/open-mathematics',commit:head}}));
  fs.writeFileSync(path.join(dir,'.open-math/open-policy.json'),JSON.stringify({version:6}));
  execFileSync(process.execPath,['scripts/render-open-workflows.mjs',dir,head]);
  const yaml=fs.readFileSync(path.join(dir,'.github/workflows/pages.yml'),'utf8');
  assert.match(yaml,/permissions:\n  contents: read\n  actions: read\n  pages: write/);
  assert.match(yaml,/id: upload\n        with:\n          path: site/);
  assert.match(yaml,/PAGES_ARTIFACT_ID: \$\{\{ steps.upload.outputs.artifact_id \}\}/);
  assert.match(yaml,/run: node github\/wait-pages-artifact.mjs/);
  assert(yaml.indexOf('wait-pages-artifact.mjs')<yaml.indexOf('actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e'));
  assert.doesNotMatch(yaml,/continue-on-error|actions: write|download-artifact/);
  const research=fs.readFileSync(path.join(dir,'.github/workflows/research.yml'),'utf8');
  assert.match(research,/name: Build pinned isolated Lean\n        if: steps.claim.outputs.comment_id != '' && steps.claim.outputs.needs_lean != 'false'/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
