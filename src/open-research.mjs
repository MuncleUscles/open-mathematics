// Open admission: statements and directions are contribution data, never a task list.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {isAddress} from 'viem';
import {validateClaim} from './security.mjs';
import {validateProvenance} from './submission.mjs';
import {readProblemFile,parseProblemJSON,sha256,stableJSON,isHash,isCommit} from './problem.mjs';
export {readProblemFile,parseProblemJSON,sha256,stableJSON};
const need=(ok,msg)=>{if(!ok)throw Error('Open research: '+msg);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const str=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max;
const repo=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v);
const wallet=v=>isAddress(v||'')&&!/^0x0{40}$/i.test(v);
const slug='[a-z0-9][a-z0-9-]{0,63}';
const recordPath=new RegExp(`^research/submissions/(${slug})\\.json$`);
const artifactPath=new RegExp(`^research/(artifacts|notes)/(${slug})\\.(json|md)$`);

export function loadOpenProblem(directory,{requireDeployment=true}={}){
 const root=fs.realpathSync(directory),descriptor=parseProblemJSON(readProblemFile(root,'.open-math/open.json'));
 need(exact(descriptor,['schemaVersion','id','repository','branch','configBranch','protocol','policy'])&&descriptor.schemaVersion===5,'exact open descriptor required');
 need(descriptor.id==='p-vs-np'&&repo(descriptor.repository)&&descriptor.branch==='research'&&descriptor.configBranch==='main','problem and canonical branches required');
 need(exact(descriptor.protocol,['repository','commit'])&&repo(descriptor.protocol.repository)&&isCommit(descriptor.protocol.commit),'pinned protocol required');
 need(exact(descriptor.policy,['path','sha256'])&&descriptor.policy.path==='.open-math/open-policy.json'&&isHash(descriptor.policy.sha256),'immutable evaluation policy required');
 const policyBytes=readProblemFile(root,descriptor.policy.path),policyHash=sha256(policyBytes),policy=parseProblemJSON(policyBytes);
 need(policyHash===descriptor.policy.sha256,'evaluation policy bytes changed');
 need(exact(policy,['version','problem','repository','branch','objective','toolchain','allowed_axioms','admission','notes'])&&policy.version===5,'exact open policy required');
 need(policy.problem===descriptor.id&&policy.repository===descriptor.repository&&policy.branch===descriptor.branch&&policy.admission==='open','policy identity or admission mismatch');
 need(str(policy.objective,30,2000)&&str(policy.notes,30,2000)&&policy.toolchain==='lean4:4.19.0'&&stableJSON(policy.allowed_axioms)===stableJSON(['propext','Quot.sound']),'objective, pinned Lean and axiom policy required');
 let deployment=null;
 if(requireDeployment){
  deployment=parseProblemJSON(readProblemFile(root,'.open-math/open-deployment.json'));
  const d=deployment;
  need(d.protocolVersion===5&&d.problem===descriptor.id&&d.repository===descriptor.repository&&d.branch===descriptor.branch&&d.policyHash===policyHash&&d.chainId===61999,'deployment identity mismatch');
  need(wallet(d.contract)&&isHash(d.codeHash)&&wallet(d.verifier)&&wallet(d.executor)&&d.verifier.toLowerCase()!==d.executor.toLowerCase(),'separate live service roles required');
  let origin;try{origin=new URL(d.origin);}catch{}need(origin?.protocol==='https:'&&!origin.username&&!origin.password,'HTTPS signing origin required');
  need(Number.isSafeInteger(d.windowSeconds)&&d.windowSeconds>=300&&d.windowSeconds<=604800,'challenge window of at least five minutes required');
  need(Number.isSafeInteger(d.minimumGitHubAccountAgeDays)&&d.minimumGitHubAccountAgeDays>=1&&d.minimumGitHubAccountAgeDays<=3650,'bounded GitHub account age rule required');
  need(['appId','verifierAppId'].every(k=>Number.isSafeInteger(d[k])&&d[k]>0),'app-bound checks required');
  need(Array.isArray(d.legacyLedgers)&&d.legacyLedgers.length<=8,'separate historical ledger references required');
  for(const l of d.legacyLedgers)need(exact(l,['chain_id','address','reserved_statement_hashes','reserved_proposition_hashes','description'])&&l.chain_id===61999&&wallet(l.address)&&str(l.description,10,1000)&&['reserved_statement_hashes','reserved_proposition_hashes'].every(k=>Array.isArray(l[k])&&l[k].length<=100&&l[k].every(isHash)),'invalid historical ledger reference');
 }
 const problem={root,descriptor,deployment,policy,policyHash};
 if(deployment)validateOpenConstructor(openNativeConfiguration(problem));
 return problem;
}

export function verifyOpenCheckout(problem,protocolRoot){
 need(execFileSync('git',['rev-parse','HEAD'],{cwd:protocolRoot,encoding:'utf8'}).trim()===problem.descriptor.protocol.commit,'refresh tools to the pinned protocol commit');
 execFileSync('git',['diff','--quiet','HEAD','--'],{cwd:protocolRoot,stdio:'pipe'});
 need(execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:protocolRoot,encoding:'utf8'}).trim()==='','untracked files in trusted protocol checkout');
 if(problem.deployment)need(sha256(fs.readFileSync(path.join(protocolRoot,'contracts/research_v5.py')))===problem.deployment.codeHash,'deployed contract source mismatch');
}

export function validateOpenClaim(claim,problem,{now=Date.now()}={}){
 const fields=['version','domain','chainId','problem','repository','pr','head','base','branch','contract','policy','submission_path','submission_hash','wallet','nonce','expires'];
 need(exact(claim,[...fields,'protocol_commit'])&&claim.version===4,'exact v4 open signed claim required');
 const d=problem.deployment;
 need(claim.repository===d.repository&&claim.policy===problem.policyHash&&claim.protocol_commit===problem.descriptor.protocol.commit,'wrong repository, rules or worker pin');
 const legacy=Object.fromEntries(fields.map(k=>[k,claim[k]]));legacy.version=2;
 validateClaim(legacy,{domain:d.origin,chainId:d.chainId,contract:d.contract,policy:problem.policyHash,branch:d.branch,problem:d.problem,now});
 need(recordPath.test(claim.submission_path)&&isCommit(claim.head)&&isCommit(claim.base),'exact immutable contribution binding required');
 return claim;
}

export function openNativeConfiguration(problem){
 const d=problem.deployment;
 return {version:5,problem:d.problem,repository:d.repository,branch:d.branch,verifier:d.verifier,executor:d.executor,window:d.windowSeconds,minimum_account_age_days:d.minimumGitHubAccountAgeDays,policy:problem.policyHash,objective:problem.policy.objective,legacy_ledgers:d.legacyLedgers};
}

export function validateOpenConstructor(c){
 need(exact(c,['version','problem','repository','branch','verifier','executor','window','minimum_account_age_days','policy','objective','legacy_ledgers'])&&c.version===5,'exact v5 constructor required');
 need(c.problem==='p-vs-np'&&typeof c.repository==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(c.repository)&&!['.','..'].includes(c.repository.split('/')[1])&&c.branch==='research','constructor problem identity required');
 need(wallet(c.verifier)&&wallet(c.executor)&&c.verifier.toLowerCase()!==c.executor.toLowerCase(),'distinct nonzero native roles required');
 need(Number.isSafeInteger(c.window)&&c.window>=300&&c.window<=604800&&isHash(c.policy)&&str(c.objective,30,2000),'bounded reviewed window, policy and objective required');
 need(Number.isSafeInteger(c.minimum_account_age_days)&&c.minimum_account_age_days>=1&&c.minimum_account_age_days<=3650,'bounded minimum GitHub account age required');
 need(Array.isArray(c.legacy_ledgers)&&c.legacy_ledgers.length<=8,'bounded historical ledgers required');
 const addresses=new Set();for(const l of c.legacy_ledgers){
  need(exact(l,['chain_id','address','reserved_statement_hashes','reserved_proposition_hashes','description'])&&l.chain_id===61999&&wallet(l.address)&&str(l.description,10,500)&&!addresses.has(l.address.toLowerCase()),'unique historical Studio ledger required');addresses.add(l.address.toLowerCase());
  for(const key of ['reserved_statement_hashes','reserved_proposition_hashes'])need(Array.isArray(l[key])&&l[key].length<=100&&l[key].every(isHash)&&new Set(l[key]).size===l[key].length,'unique historical content hashes required');
 }
 need(Buffer.byteLength(JSON.stringify(c))<=32768,'constructor exceeds 32,768 UTF-8 bytes');return c;
}

export function assertOpenConfiguration(actual,expected){
 validateOpenConstructor(expected);
 const integer=v=>{need(typeof v==='number'&&Number.isSafeInteger(v)||['string','bigint'].includes(typeof v)&&/^(0|[1-9][0-9]*)$/.test(String(v))&&Number.isSafeInteger(Number(v)),'native integer mismatch');return Number(v);};
 need(actual&&typeof actual==='object'&&!Array.isArray(actual),'native configuration mismatch');
 const normalized={...actual,version:integer(actual.version),window:integer(actual.window),minimum_account_age_days:integer(actual.minimum_account_age_days)};
 need(Array.isArray(actual.legacy_ledgers),'historical ledger mismatch');
 normalized.legacy_ledgers=actual.legacy_ledgers.map(l=>{need(l&&typeof l==='object'&&typeof l.address==='string','historical ledger mismatch');return {...l,chain_id:integer(l.chain_id),address:l.address.toLowerCase()};});
 for(const key of ['verifier','executor']){need(typeof actual[key]==='string','native role mismatch');normalized[key]=actual[key].toLowerCase();}
 const wanted={...expected,verifier:expected.verifier.toLowerCase(),executor:expected.executor.toLowerCase(),legacy_ledgers:expected.legacy_ledgers.map(l=>({...l,address:l.address.toLowerCase()}))};
 need(stableJSON(normalized)===stableJSON(wanted),'native configuration or role mismatch');return actual;
}

export async function requireOpenConfiguration(problem,read){
 return assertOpenConfiguration(await read('get_config',[]),openNativeConfiguration(problem));
}

export function validateOpenArtifactBytes(bytes,kind){
 need(bytes instanceof Uint8Array&&['formal','research-note'].includes(kind),'artifact bytes and evidence kind required');
 const maximum=kind==='formal'?32768:12000;
 need(bytes.byteLength>=3&&bytes.byteLength<=maximum,`artifact must contain 3..${maximum.toLocaleString('en-US')} UTF-8 bytes`);
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 need(text.trim().length>0&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text),'nonempty UTF-8 artifact without control characters required');
 if(kind==='formal'){
  const b=parseProblemJSON(bytes);
  need(exact(b,['version','definitions','statement','proof','dependencies'])&&b.version===1&&Array.isArray(b.definitions)&&b.definitions.length<=8&&typeof b.statement==='string'&&b.statement===b.statement.trim()&&Buffer.byteLength(b.statement)>0&&Buffer.byteLength(b.statement)<=4000&&typeof b.proof==='string'&&b.proof.startsWith('by\n')&&Buffer.byteLength(b.proof)<=12000&&Array.isArray(b.dependencies)&&b.dependencies.length<=4,'bounded exact formal bundle required; run check for expression validation');
 }
 return text;
}

export function validateOpenSubmission(s,{wallet:signer,problem='p-vs-np'}={}){
 const id=typeof problem==='string'?problem:problem.descriptor.id;
 need(exact(s,['schema_version','problem','kind','title','claim','novelty','prior_art','research_direction','provenance','evidence','dependencies','attribution','limitations'])&&s.schema_version===3&&s.problem===id,'exact open submission schema required');
 need(['lemma','counterexample','algorithm','construction','failed-approach','infrastructure','research-note'].includes(s.kind),'unknown contribution kind');
 for(const [k,min,max] of [['title',8,160],['claim',40,3000],['novelty',40,2000],['limitations',30,2000],['research_direction',10,160]])need(str(s[k],min,max),'bounded substantive '+k+' required');
 validateProvenance(s.provenance);
 need(Array.isArray(s.prior_art)&&s.prior_art.length<=8,'at most eight prior art entries');
 for(const p of s.prior_art)need(exact(p,['reference','relationship'])&&str(p.reference,5,500)&&str(p.relationship,20,1000),'describe actual relationship to prior art');
 const e=s.evidence;
 need(exact(e,['kind','artifact_path','reproduce'])&&['formal','research-note'].includes(e.kind)&&str(e.reproduce,20,1000),'explicit evidence kind and reproduction required');
 const m=typeof e.artifact_path==='string'&&e.artifact_path.match(artifactPath);
 need(m&&(e.kind==='formal'?m[1]==='artifacts'&&m[3]==='json':m[1]==='notes'&&m[3]==='md'),'contained artifact path for evidence kind required');
 need(s.kind!=='research-note'||e.kind==='research-note','research notes cannot claim formal verification');
 need(Array.isArray(s.dependencies)&&s.dependencies.length<=8,'bounded contribution dependencies required');
 const seen=new Set();for(const dep of s.dependencies){need(exact(dep,['id','use','importance'])&&str(dep.id,1,100)&&str(dep.use,30,1500)&&str(dep.importance,30,1500)&&!seen.has(dep.id),'unique dependency with substantive use required');seen.add(dep.id);}
 need(exact(s.attribution,['wallet','contributions'])&&wallet(s.attribution.wallet)&&s.attribution.wallet.toLowerCase()===signer?.toLowerCase()&&str(s.attribution.contributions,20,1500),'attribution must match signing wallet');
 need(![s.title,s.claim,s.novelty,s.limitations,s.research_direction,s.attribution.contributions].some(t=>t.startsWith('REPLACE:')),'replace template guidance with actual evidence');
 return s;
}

export function decodeOpenSubmission(bytes,options){
 need(bytes.byteLength<=16000,'record exceeds 16,000 bytes');
 return validateOpenSubmission(parseProblemJSON(bytes),options);
}

export function openSubmissionBlobs({claim,tree,baseTree,head}){
 const m=claim.submission_path.match(recordPath);need(m,'valid submission path required');
 need(head.parents?.length===1&&head.parents[0].sha===claim.base,'one contribution commit directly on signed canonical base required');
 for(const t of [tree,baseTree])need(!t.truncated&&Array.isArray(t.tree)&&new Set(t.tree.map(e=>e.path)).size===t.tree.length,'complete unique immutable tree required');
 const old=new Map(baseTree.tree.filter(e=>e.type!=='tree').map(e=>[e.path,e])),current=new Map(tree.tree.filter(e=>e.type!=='tree').map(e=>[e.path,e]));
 const changed=[...new Set([...old.keys(),...current.keys()])].filter(p=>['sha','mode','type'].some(k=>old.get(p)?.[k]!==current.get(p)?.[k]));
 const artifact=changed.find(p=>p!==claim.submission_path),a=artifact?.match(artifactPath);
 need(changed.length===2&&changed.includes(claim.submission_path)&&a&&a[2]===m[1]&&((a[1]==='artifacts'&&a[3]==='json')||(a[1]==='notes'&&a[3]==='md'))&&changed.every(p=>!old.has(p)),'add exactly one new record and matching new artifact; no other changes');
 const blob=p=>{const e=current.get(p);need(e?.mode==='100644'&&e.type==='blob'&&isCommit(e.sha),'plain regular immutable files required');return e.sha;};
 return {artifactPath:artifact,artifactSha:blob(artifact),submissionSha:blob(claim.submission_path)};
}
