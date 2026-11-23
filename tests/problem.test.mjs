import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {privateKeyToAccount} from 'viem/accounts';import {recoverMessageAddress} from 'viem';
import {sha256,statementFingerprint,propositionHash,goalCommitment,validateProblemPolicy,loadProblem,validateProblemClaim,requireNativeEnrollment,requireNativeConfiguration,readProblemFile,verifyProblemSource} from '../src/problem.mjs';
import {claimFor,loadLocalSigner} from '../scripts/problem-agent.mjs';import {message} from '../src/security.mjs';
const json=x=>JSON.stringify(x,null,2)+'\n',address=n=>'0x'+String(n).repeat(40),commit=n=>String(n).repeat(40);
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'om-problem-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const definition='def Value := Nat\n',statement='def Goal : Prop := ∀ n : Value, n = n';
 const files={'Definitions.lean':sha256(definition),'goals/identity.lean':sha256(statement+'\n')};
 const goal={path:'research/proofs/identity.proof',theorem:'candidate : Goal',statement,statement_hash:'',goal_hash:'',definition_files:['Definitions.lean','goals/identity.lean'],dependency:null,rewardable:true};goal.statement_hash=statementFingerprint(goal,files);goal.goal_hash=goalCommitment('identity',goal,files);
 const policy={version:4,name:'foundation-v1',problem:'example',repository:'Owner/problem',branch:'research',toolchain:'lean4:4.19.0',allowed_axioms:['propext','Quot.sound'],files,goals:{identity:goal}},bytes=json(policy),policyHash=sha256(bytes);
 const descriptor={schemaVersion:1,id:'example',repository:'Owner/problem',branch:'research',configBranch:'main',protocol:{repository:'Owner/protocol',commit:commit(1)},directions:['shared'],policies:[{path:'.open-math/policies/foundation-v1.json',sha256:policyHash,sourceCommit:commit(2),protocolCommit:commit(1)}]};
 const deployment={protocolVersion:4,problem:'example',repository:'Owner/problem',branch:'research',chainId:61999,contract:address(9),codeHash:'a'.repeat(64),origin:'https://example.com',curator:address(1),verifier:address(2),executor:address(3),windowSeconds:300,appId:15368,verifierAppId:15368,legacyLedger:{chain_id:61999,address:'',reserved_statement_hashes:[],reserved_proposition_hashes:[]}};
 for(const [name,content]of Object.entries({'.open-math/problem.json':json(descriptor),'.open-math/deployment.json':json(deployment),'.open-math/policies/foundation-v1.json':bytes,'lean/Definitions.lean':definition,'lean/goals/identity.lean':statement+'\n'})){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),content);}
 return {root,policy,descriptor,deployment,problem:loadProblem(root)};
}
test('content fingerprint excludes names and paths; content commitment binds both',t=>{
 const {policy}=fixture(t),g=policy.goals.identity,alias={...g,path:'research/proofs/alias.proof',theorem:'candidate : Alias',statement:g.statement.replace('def Goal','def Alias')};
 assert.equal(statementFingerprint(alias,policy.files),g.statement_hash);assert.notEqual(goalCommitment('alias',alias,policy.files),g.goal_hash);
 alias.statement+=' ∧ True';assert.notEqual(statementFingerprint(alias,policy.files),g.statement_hash);
});
test('changed trusted bytes, duplicate JSON, symlinks and stale goal hashes fail closed',t=>{
 const {root,policy}=fixture(t);const altered=structuredClone(policy);altered.goals.identity.rewardable=false;assert.throws(()=>validateProblemPolicy(altered),/commitment/);
 fs.writeFileSync(path.join(root,'lean/Definitions.lean'),'def Value := Bool\n');assert.throws(()=>loadProblem(root),/changed/);
 fs.symlinkSync('/etc/hosts',path.join(root,'outside'));assert.throws(()=>readProblemFile(root,'outside'),/symlink/);assert.throws(()=>readProblemFile(root,'../outside'),/relative/);
 const file=path.join(root,'.open-math/problem.json');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1'));assert.throws(()=>loadProblem(root),/duplicate/);
});
test('signed claim binds selected goal, both commits, problem and contract',async t=>{
 const {problem}=fixture(t),g=problem.goals.get('identity'),account=privateKeyToAccount('0x'+'31'.repeat(32)),now=Date.now();
 const claim=claimFor(problem,g,{pr:4,head:commit(3),base:commit(4),recordPath:'research/submissions/example.json',recordBytes:Buffer.from('{}'),wallet:account.address,now});
 const signature=await account.signMessage({message:message(claim)});assert.equal((await recoverMessageAddress({message:message(claim),signature})).toLowerCase(),account.address.toLowerCase());
 for(const [key,value]of Object.entries({goal:'other',goal_hash:'b'.repeat(64),problem_commit:commit(8),protocol_commit:commit(8),repository:'Owner/other',problem:'other',contract:address(8),policy:'c'.repeat(64),version:2,extra:true}))assert.throws(()=>validateProblemClaim({...claim,[key]:value},problem,{now}),undefined,key);
 assert.throws(()=>validateProblemClaim(claim,problem,{now:claim.expires}),/Expired/);
});
test('reference-only task cannot be signed, and native state must match exact enrollment',async t=>{
 const {problem}=fixture(t),g=problem.goals.get('identity'),native={...g,proposition_hash:propositionHash(g),policy_hash:g.policyHash,problem_commit:g.problemCommit,protocol_commit:g.protocolCommit,status:'open'};
 await requireNativeEnrollment(problem,g,async()=>native);await assert.rejects(requireNativeEnrollment(problem,g,async()=>({...native,protocol_commit:commit(8)})),/mismatch/);
 g.rewardable=false;assert.throws(()=>claimFor(problem,g,{pr:1,head:commit(3),base:commit(4),recordPath:'research/submissions/example.json',recordBytes:'{}',wallet:address(5)}),/reward-eligible/);
});
test('native roles and historical reference cannot silently change',async t=>{
 const {problem,deployment:d}=fixture(t),config={version:4,problem:d.problem,repository:d.repository,branch:d.branch,curator:d.curator,verifier:d.verifier,executor:d.executor,window:d.windowSeconds,directions:['shared'],legacy_ledger:d.legacyLedger};
 await requireNativeConfiguration(problem,async()=>config);await requireNativeConfiguration(problem,async()=>({...config,version:'4',window:'300',legacy_ledger:{...config.legacy_ledger,chain_id:'61999'}}));await assert.rejects(requireNativeConfiguration(problem,async()=>({...config,verifier:address(7)})),/role mismatch/);await assert.rejects(requireNativeConfiguration(problem,async()=>({...config,legacy_ledger:{}})),/ledger mismatch/);
});
test('contributor keys remain outside repositories with private file permissions',t=>{
 const {root}=fixture(t),key=path.join(root,'secret');fs.writeFileSync(key,'0x'+'31'.repeat(32),{mode:0o600});assert.throws(()=>loadLocalSigner(key,[root]),/outside/);fs.chmodSync(key,0o644);assert.throws(()=>loadLocalSigner(key,[]),/owner/);fs.chmodSync(key,0o600);assert.ok(loadLocalSigner(key,[]).address);
});
test('shared Unicode and real historical proposition commitments stay stable',()=>{
 const vector=JSON.parse(fs.readFileSync(new URL('./fixtures/problem-commitments.json',import.meta.url),'utf8')),v=vector.unicode;
 assert.equal(statementFingerprint(v.goal,v.files),v.goal.statement_hash);assert.equal(goalCommitment(v.id,v.goal,v.files),v.goal.goal_hash);assert.equal(propositionHash(v.goal),v.propositionHash);
 for(const g of vector.legacy.statements)assert.equal(propositionHash({statement:g.statement}),g.propositionHash);
});
test('source commit must actually contain policy bytes and be canonical',async t=>{
 const {root,problem}=fixture(t),g=problem.goals.get('identity'),files=['.open-math/policies/foundation-v1.json',...Object.keys(problem.policies.get(g.policyHash).policy.files).map(f=>'lean/'+f)],contents=new Map(),tree=files.map((file,i)=>{const sha=String(i+1).repeat(40),bytes=fs.readFileSync(path.join(root,file));contents.set(sha,{sha,encoding:'base64',size:bytes.length,content:bytes.toString('base64')});return {path:file,sha,mode:'100644',type:'blob'};});
 const gh={repository:problem.descriptor.repository,canonicalMerge:async()=>true,request:async url=>url.includes('/trees/')?{tree,truncated:false}:contents.get(url.split('/').at(-1))};
 assert.equal(await verifyProblemSource(problem,g,gh),true);
 const first=contents.values().next().value;first.content=Buffer.from('different bytes').toString('base64');await assert.rejects(verifyProblemSource(problem,g,gh),/does not contain/);
 await assert.rejects(verifyProblemSource(problem,g,{...gh,canonicalMerge:async()=>false}),/not canonical/);
});
