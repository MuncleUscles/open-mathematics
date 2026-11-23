// Reviewed problem data is separate from executable protocol code and PR input.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isAddress} from 'viem';
import {validateClaim} from './security.mjs';

export const stableJSON=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const sha256=value=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:stableJSON(value)).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error('Problem configuration: '+message);};
export const isHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const isCommit=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x)&&x!=='0'.repeat(40);
const repo=x=>typeof x==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(x);
const slug=x=>typeof x==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(x);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export function readProblemFile(directory,relative,maximum=65536){
 need(typeof relative==='string'&&/^[A-Za-z0-9_.\/-]+$/.test(relative)&&!path.isAbsolute(relative)&&relative.split('/').every(p=>p&&p!=='.'&&p!=='..'),'relative contained file required');
 const root=fs.realpathSync(directory);let file=root;
 for(const part of relative.split('/')){file=path.join(file,part);need(!fs.lstatSync(file).isSymbolicLink(),'symlink in trusted file path');}
 const stat=fs.statSync(file);need(stat.isFile()&&stat.size<=maximum,'bounded regular file required');
 const bytes=fs.readFileSync(file);need(bytes.length<=maximum,'file grew beyond bound');return bytes;
}
export function parseProblemJSON(bytes){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);
 need(text.trimEnd()===JSON.stringify(value,null,2),'normalized JSON required; duplicate keys forbidden');return value;
}
export function goalCommitment(id,goal,files){
 const {goal_hash,...fields}=goal;
 return sha256({id,...fields,files:Object.fromEntries(goal.definition_files.map(file=>[file,files[file]]))});
}
// Content equality guard, not a solver for semantic equivalence. Curator review
// must still reject aliases of previously rewarded mathematics.
export function statementFingerprint(goal,files){
 return sha256({definitions:goal.definition_files.slice(0,-1).map(file=>({sha256:files[file]})),proposition:goal.statement.replace(/^def [A-Za-z][A-Za-z0-9_]* : Prop :=/,'').trim()});
}
export const propositionHash=goal=>sha256(goal.statement.replace(/^def [A-Za-z][A-Za-z0-9_]* : Prop :=/,'').trim());
export function validateProblemPolicy(policy){
 need(exact(policy,['version','name','problem','repository','branch','toolchain','allowed_axioms','files','goals'])&&policy.version===4,'exact v4 policy fields required');
 need(slug(policy.name)&&slug(policy.problem)&&repo(policy.repository)&&policy.branch==='research','policy identity required');
 need(policy.toolchain==='lean4:4.19.0'&&Array.isArray(policy.allowed_axioms)&&new Set(policy.allowed_axioms).size===policy.allowed_axioms.length&&policy.allowed_axioms.every(a=>['propext','Quot.sound'].includes(a)),'pinned Lean and restricted axioms required');
 need(policy.files&&Object.getPrototypeOf(policy.files)===Object.prototype&&Object.keys(policy.files).length>0&&Object.keys(policy.files).length<=32,'bounded trusted file closure required');
 for(const [file,hash]of Object.entries(policy.files))need(/^[A-Za-z][A-Za-z0-9_\/-]*\.lean$/.test(file)&&!file.includes('//')&&!file.split('/').includes('..')&&isHash(hash),'invalid trusted file');
 need(policy.goals&&Object.getPrototypeOf(policy.goals)===Object.prototype&&Object.keys(policy.goals).length>0&&Object.keys(policy.goals).length<=16,'bounded goal batch required');
 const fingerprints=new Set(),paths=new Set();
 for(const [id,g]of Object.entries(policy.goals)){
  need(slug(id)&&exact(g,['path','theorem','statement','statement_hash','goal_hash','definition_files','dependency','rewardable']),'exact goal fields required');
  need(g.path===`research/proofs/${id}.proof`&&!paths.has(g.path)&&/^candidate : [A-Za-z][A-Za-z0-9_]*$/.test(g.theorem),'exact proof path and theorem required');paths.add(g.path);
  need(typeof g.statement==='string'&&g.statement.length>=10&&g.statement.length<=2000&&isHash(g.statement_hash)&&!fingerprints.has(g.statement_hash),'unique bounded statement required');fingerprints.add(g.statement_hash);
  need(g.statement.startsWith(`def ${g.theorem.slice('candidate : '.length)} : Prop :=`),'theorem name differs from statement declaration');
  need(g.dependency===null&&typeof g.rewardable==='boolean','this release has no imported credited proof dependency');
  need(Array.isArray(g.definition_files)&&g.definition_files.length>0&&g.definition_files.length<=16&&new Set(g.definition_files).size===g.definition_files.length&&g.definition_files.every(f=>Object.hasOwn(policy.files,f)),'explicit ordered trusted closure required');
  need(g.statement_hash===statementFingerprint(g,policy.files),'statement fingerprint mismatch');
  need(isHash(g.goal_hash)&&g.goal_hash===goalCommitment(id,g,policy.files),'goal content commitment mismatch');
 }
 return policy;
}
export function loadProblem(directory,{requireDeployment=true}={}){
 const root=fs.realpathSync(directory),descriptor=parseProblemJSON(readProblemFile(root,'.open-math/problem.json'));
 need(exact(descriptor,['schemaVersion','id','repository','branch','configBranch','protocol','directions','policies'])&&descriptor.schemaVersion===1&&slug(descriptor.id)&&repo(descriptor.repository)&&descriptor.branch==='research'&&descriptor.configBranch==='main','problem descriptor identity');
 need(descriptor.protocol&&repo(descriptor.protocol.repository)&&isCommit(descriptor.protocol.commit),'immutable protocol commit required');
 need(Array.isArray(descriptor.directions)&&descriptor.directions.length>0&&descriptor.directions.every(slug)&&new Set(descriptor.directions).size===descriptor.directions.length,'research directions required');
 need(Array.isArray(descriptor.policies)&&descriptor.policies.length<=32,'policy index required');
 const policies=new Map(),goals=new Map(),fingerprints=new Set();
 for(const entry of descriptor.policies){
  need(exact(entry,['path','sha256','sourceCommit','protocolCommit'])&&/^\.open-math\/policies\/[a-z0-9_-]+\.json$/.test(entry.path)&&isHash(entry.sha256)&&isCommit(entry.sourceCommit)&&isCommit(entry.protocolCommit),'immutable policy reference required');
  const bytes=readProblemFile(root,entry.path);need(sha256(bytes)===entry.sha256&&!policies.has(entry.sha256),'policy bytes changed or repeated');
  const policy=validateProblemPolicy(parseProblemJSON(bytes));need(policy.problem===descriptor.id&&policy.repository===descriptor.repository&&policy.branch===descriptor.branch,'cross-problem policy');
  for(const [file,hash]of Object.entries(policy.files))need(sha256(readProblemFile(root,'lean/'+file))===hash,'trusted Lean file changed: '+file);
  policies.set(entry.sha256,{entry,policy,bytes});
  for(const [id,goal]of Object.entries(policy.goals)){
   need(readProblemFile(root,'lean/'+goal.definition_files.at(-1)).toString('utf8').trim()===goal.statement,'displayed statement differs from trusted definition');
   need(!goals.has(id)&&!fingerprints.has(goal.statement_hash),'goal/fingerprint reused across batches');fingerprints.add(goal.statement_hash);goals.set(id,{...goal,id,policyHash:entry.sha256,policyName:policy.name,problemCommit:entry.sourceCommit,protocolCommit:entry.protocolCommit});
  }
 }
 let deployment=null;
 if(requireDeployment){
  deployment=parseProblemJSON(readProblemFile(root,'.open-math/deployment.json'));
  need(deployment.protocolVersion===4&&deployment.problem===descriptor.id&&deployment.repository===descriptor.repository&&deployment.branch===descriptor.branch&&deployment.chainId===61999,'deployment identity mismatch');
  need(isAddress(deployment.contract)&&!/^0x0{40}$/i.test(deployment.contract)&&isHash(deployment.codeHash),'live contract/source commitment required');
  need(typeof deployment.origin==='string'&&new URL(deployment.origin).protocol==='https:','HTTPS signing origin required');
  need(['curator','verifier','executor'].every(k=>isAddress(deployment[k])&&!/^0x0{40}$/i.test(deployment[k])),'enrolled roles required');
  need(new Set(['curator','verifier','executor'].map(k=>deployment[k].toLowerCase())).size===3,'separate enrollment/verifier/executor roles required');
  need(Number.isSafeInteger(deployment.windowSeconds)&&deployment.windowSeconds>=10&&deployment.windowSeconds<=604800,'bounded challenge window required');
  need(['appId','verifierAppId'].every(k=>Number.isSafeInteger(deployment[k])&&deployment[k]>0),'trusted check publishers required');
 }
 return {root,descriptor,deployment,policies,goals};
}
export function verifyProtocolCheckout(problem,protocolRoot,{goal}={}){
 const head=execFileSync('git',['rev-parse','HEAD'],{cwd:protocolRoot,encoding:'utf8'}).trim();
 // Goal.protocolCommit is its permanent enrollment-review snapshot. The
 // protected descriptor pins the currently executing worker independently.
 need(head===problem.descriptor.protocol.commit,'refresh tools to the problem\'s current pinned worker commit');
 execFileSync('git',['diff','--quiet','HEAD','--'],{cwd:protocolRoot,stdio:'pipe'});
 need(execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:protocolRoot,encoding:'utf8'}).trim()==='','untracked files in trusted protocol checkout');
 if(problem.deployment)need(sha256(fs.readFileSync(path.join(protocolRoot,'contracts/research_v4.py')))===problem.deployment.codeHash,'contract source differs from deployed pin');
}
export function validateProblemClaim(claim,problem,{now=Date.now(),requireRewardable=true}={}){
 const extra=['goal','goal_hash','problem_commit','protocol_commit'];
 const baseFields=['version','domain','chainId','problem','repository','pr','head','base','branch','contract','policy','submission_path','submission_hash','wallet','nonce','expires'];
 need(exact(claim,[...baseFields,...extra])&&claim.version===3,'exact v3 signed claim required');
 const goal=problem.goals.get(claim.goal),d=problem.deployment;
 need(goal&&(!requireRewardable||goal.rewardable),'open reward-eligible goal required');
 need(claim.repository===d.repository&&claim.problem===d.problem&&claim.policy===goal.policyHash&&claim.goal_hash===goal.goal_hash&&claim.problem_commit===goal.problemCommit&&claim.protocol_commit===goal.protocolCommit,'cross-repository or changed goal binding');
 const legacy=Object.fromEntries(baseFields.map(k=>[k,claim[k]]));legacy.version=2;
 validateClaim(legacy,{domain:d.origin,chainId:d.chainId,contract:d.contract,policy:goal.policyHash,branch:d.branch,problem:d.problem,now});
 return goal;
}
export async function requireNativeEnrollment(problem,goal,read){
 const enrolled=await read('get_goal',[goal.id]);
 for(const [key,value]of Object.entries({id:goal.id,goal_hash:goal.goal_hash,statement_hash:goal.statement_hash,proposition_hash:propositionHash(goal),policy_hash:goal.policyHash,problem_commit:goal.problemCommit,protocol_commit:goal.protocolCommit}))need(enrolled[key]===value,'native enrollment mismatch: '+key);
 need(enrolled.rewardable===goal.rewardable,'native reward eligibility mismatch');return enrolled;
}
export async function requireNativeConfiguration(problem,read){
 const d=problem.deployment,c=await read('get_config',[]);
 const expected={version:4,problem:d.problem,repository:d.repository,branch:d.branch,curator:d.curator,verifier:d.verifier,executor:d.executor,window:d.windowSeconds,directions:problem.descriptor.directions,legacy_ledger:d.legacyLedger};
 for(const [key,value]of Object.entries(expected)){
  if(['curator','verifier','executor'].includes(key))need(c[key]?.toLowerCase()===value.toLowerCase(),'native role mismatch: '+key);
  else if(['version','window'].includes(key))need(c[key]===value||c[key]===String(value),'native integer mismatch: '+key);
  else if(key==='legacy_ledger'){
   need(exact(c[key],['chain_id','address','reserved_statement_hashes','reserved_proposition_hashes'])&&(c[key].chain_id===61999||c[key].chain_id==='61999')&&c[key].address.toLowerCase()===value.address.toLowerCase()&&stableJSON(c[key].reserved_statement_hashes)===stableJSON(value.reserved_statement_hashes)&&stableJSON(c[key].reserved_proposition_hashes)===stableJSON(value.reserved_proposition_hashes),'native historical ledger mismatch');
  }else need(stableJSON(c[key])===stableJSON(value),'native configuration mismatch: '+key);
 }
 return c;
}
export async function verifyProblemSource(problem,goal,github){
 need(github.repository===problem.descriptor.repository,'source repository mismatch');
 need(await github.canonicalMerge(problem.descriptor.configBranch,goal.problemCommit),'policy source is not canonical problem configuration history');
 const selected=problem.policies.get(goal.policyHash),tree=await github.request(`/git/trees/${goal.problemCommit}?recursive=1`);
 need(!tree.truncated&&Array.isArray(tree.tree),'complete immutable policy source tree required');
 const expected=new Map([[selected.entry.path,goal.policyHash],...Object.entries(selected.policy.files).map(([file,hash])=>['lean/'+file,hash])]);
 for(const [file,hash]of expected){
  const entry=tree.tree.find(e=>e.path===file);need(entry?.mode==='100644'&&entry.type==='blob'&&isCommit(entry.sha),'regular committed policy source required: '+file);
  const b=await github.request(`/git/blobs/${entry.sha}`);need(b.sha===entry.sha&&b.encoding==='base64'&&b.size<=65536,'bounded policy source blob required');
  const bytes=Buffer.from(b.content,'base64');need(bytes.length===b.size&&sha256(bytes)===hash,'source commit does not contain reviewed policy bytes: '+file);
 }
 return true;
}
