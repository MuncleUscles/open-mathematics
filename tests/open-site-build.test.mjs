import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildOpenSite,parseOpenSiteArgs} from '../scripts/build-open-site.mjs';
import {sha256} from '../src/open-research.mjs';

const json=value=>JSON.stringify(value,null,2)+'\n';
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'open-site-build-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const protocol=path.join(directory,'protocol'),renderer=path.join(directory,'renderer'),problem=path.join(directory,'problem'),output=path.join(directory,'site');
 const write=(base,name,text)=>{const file=path.join(base,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
 const git=(base,...args)=>execFileSync('git',args,{cwd:base,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}).trim();
 const commit=base=>{git(base,'init','-q');git(base,'add','.');git(base,'-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-qm','Isolated build fixture');return git(base,'rev-parse','HEAD');};
 const contract='# Protocol fixture; not a deployed contract.\n';
 write(protocol,'contracts/research_v5.py',contract);
 write(protocol,'scripts/capture-open-ledger.mjs',`import fs from 'node:fs';\nfs.writeFileSync(process.argv[3],JSON.stringify({fixture:true,capturedBy:'active-protocol',cwd:process.cwd(),problem:process.argv[2]}));\n`);
 const protocolCommit=commit(protocol);
 write(renderer,'public/open/index.html','<!doctype html><link rel="stylesheet" href="style.css"><script type="module" src="app.js"></script>');
 write(renderer,'public/open/style.css','body{color:black}');
 write(renderer,'public/open/favicon.svg','<svg xmlns="http://www.w3.org/2000/svg"/>');
 write(renderer,'public/open/assets/fixture.txt','Static presentation asset');
 write(renderer,'public/open/app.mjs','document.title="Read-only renderer";');
 write(renderer,'scripts/capture-open-ledger.mjs','throw Error("Renderer must not capture a protocol snapshot");');
 const rendererCommit=commit(renderer);
 const policy={version:5,problem:'p-vs-np',repository:'Owner/problem',branch:'research',objective:'Explore useful research toward either answer to the P versus NP problem.',
  toolchain:'lean4:4.19.0',allowed_axioms:['propext','Quot.sound'],admission:'open',notes:'Submitted statements and contributions require independent evidence and review.'};
 const policyHash=sha256(json(policy));
 const descriptor={schemaVersion:5,id:'p-vs-np',repository:policy.repository,branch:'research',configBranch:'main',protocol:{repository:'Owner/protocol',commit:protocolCommit},policy:{path:'.open-math/open-policy.json',sha256:policyHash}};
 const address=digit=>'0x'+digit.repeat(40);
 const deployment={protocolVersion:5,problem:'p-vs-np',repository:policy.repository,branch:'research',chainId:61999,contract:address('1'),codeHash:sha256(contract),
  verifier:address('2'),executor:address('3'),origin:'https://example.invalid',windowSeconds:300,minimumGitHubAccountAgeDays:30,appId:1,verifierAppId:2,legacyLedgers:[],policyHash};
 write(problem,'.open-math/open-policy.json',json(policy));write(problem,'.open-math/open.json',json(descriptor));write(problem,'.open-math/open-deployment.json',json(deployment));
 return {protocol,renderer,problem,output,protocolCommit,rendererCommit,descriptor,write,git};
}

test('site arguments support an independent pinned protocol checkout without ambiguous modes',()=>{
 assert.deepEqual(parseOpenSiteArgs(['problem','site','--snapshot','--protocol-checkout','../protocol'],{actions:true}),
  {directory:'problem',destination:'site',snapshot:true,preview:false,protocolCheckout:'../protocol'});
 assert.equal(parseOpenSiteArgs(['problem','site','--protocol-checkout','../protocol','--snapshot']).snapshot,true);
 for(const options of [[],['problem'],['problem','site','--unknown'],['problem','site','--protocol-checkout'],
  ['problem','site','--protocol-checkout','--snapshot'],['problem','site','--snapshot','--snapshot'],['problem','site','--snapshot','--preview'],
  ['problem','site','--protocol-checkout','a','--protocol-checkout','b'],['problem','site','--preview','--protocol-checkout','a']]){
  assert.throws(()=>parseOpenSiteArgs(options,{actions:false}),/Usage:/);
 }
 assert.throws(()=>parseOpenSiteArgs(['problem','site','--preview'],{actions:true}),/Usage:/);
});

test('separate presentation release preserves agent and problem protocol pins and captures only with active tools',async t=>{
 const f=fixture(t);
 const result=await buildOpenSite({directory:f.problem,destination:f.output,snapshot:true,protocolCheckout:f.protocol},{rendererRoot:f.renderer});
 const data=JSON.parse(fs.readFileSync(path.join(f.output,'problem.json'))),agent=JSON.parse(fs.readFileSync(path.join(f.output,'agent.json'))),snapshot=JSON.parse(fs.readFileSync(path.join(f.output,'ledger-snapshot.json')));
 const page=fs.readFileSync(path.join(f.output,'index.html'),'utf8');
 assert.ok(page.includes(`href="style.css?v=${f.rendererCommit}"`));
 assert.ok(page.includes(`src="app.js?v=${f.rendererCommit}"`));
 assert.notEqual(f.rendererCommit,f.protocolCommit);
 assert.deepEqual(data.descriptor,f.descriptor);assert.deepEqual(agent.protocol,f.descriptor.protocol);
 assert.deepEqual(data.presentation,{commit:f.rendererCommit,protocolCommit:f.protocolCommit,readOnly:false,walletActions:["appealTransaction"]});
 assert.equal(data.preview,false);assert.equal(result.mode,'live-native-read');
 assert.deepEqual(snapshot,{fixture:true,capturedBy:'active-protocol',cwd:fs.realpathSync(f.protocol),problem:f.problem});
 assert.match(fs.readFileSync(path.join(f.output,'app.js'),'utf8'),/Read-only renderer/);
 assert.equal(fs.readFileSync(path.join(f.output,'assets/fixture.txt'),'utf8'),'Static presentation asset');
});

test('wrong or modified active tools are rejected before site output or snapshot execution',async t=>{
 const f=fixture(t);
 await assert.rejects(buildOpenSite({directory:f.problem,destination:f.output,protocolCheckout:f.renderer},{rendererRoot:f.renderer}),/pinned protocol commit/);
 assert.equal(fs.existsSync(f.output),false);
 f.write(f.protocol,'contracts/research_v5.py','# Changed source\n');
 await assert.rejects(buildOpenSite({directory:f.problem,destination:f.output,snapshot:true,protocolCheckout:f.protocol},{rendererRoot:f.renderer}));
 assert.equal(fs.existsSync(f.output),false);
});

test('a clean active protocol does not authorize uncommitted renderer code',async t=>{
 const f=fixture(t);
 f.write(f.renderer,'unreviewed.mjs','throw Error("unreviewed");');
 await assert.rejects(buildOpenSite({directory:f.problem,destination:f.output,protocolCheckout:f.protocol},{rendererRoot:f.renderer}),/Untracked files in trusted renderer/);
 assert.equal(fs.existsSync(f.output),false);
 fs.unlinkSync(path.join(f.renderer,'unreviewed.mjs'));f.write(f.renderer,'public/open/app.mjs','document.title="Uncommitted change";');
 await assert.rejects(buildOpenSite({directory:f.problem,destination:f.output,protocolCheckout:f.protocol},{rendererRoot:f.renderer}));
 assert.equal(fs.existsSync(f.output),false);
});

test('a presentation build without capture removes any obsolete published snapshot',async t=>{
 const f=fixture(t);f.write(f.output,'ledger-snapshot.json','{"stale":true}');
 await buildOpenSite({directory:f.problem,destination:f.output,protocolCheckout:f.protocol},{rendererRoot:f.renderer});
 assert.equal(fs.existsSync(path.join(f.output,'ledger-snapshot.json')),false);
});
