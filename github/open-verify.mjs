// Resolve immutable GitHub inputs before sending one bounded artifact bundle
// to the pinned verifier. Contributor files are data and never host scripts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {recoverMessageAddress} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {GitHub} from '../src/github.mjs';
import {fetchGitHubIdentity,validateGitHubIdentityEvidence} from '../src/github-identity.mjs';
import {canonical,digest,message} from '../src/security.mjs';
import {
 decodeOpenSubmission,openSubmissionBlobs,parseProblemJSON,requireOpenConfiguration,sha256,stableJSON,
 validateOpenArtifactBytes,validateOpenClaim,verifyOpenCheckout,
} from '../src/open-research.mjs';
import {clientFor,read} from './runtime.mjs';
import {loadWorkflowOpenProblem,positiveId} from './open-select.mjs';

const PROTOCOL_ROOT=fileURLToPath(new URL('../',import.meta.url));
const ATTESTATION_DOMAIN='Open Mathematics open research attestation v5\n';
const SIGNATURE=/^0x[0-9a-fA-F]{130}$/;
const COMMIT=/^[a-f0-9]{40}$/;
const HASH=/^[a-f0-9]{64}$/;
const ID=/^pr-[1-9][0-9]*-[a-f0-9]{12}-[a-f0-9]{12}$/;
const IMAGE=/^sha256:[a-f0-9]{64}$/;
const MAX_FORMAL=32768;
const MAX_NOTE=12000;
const MAX_RECORD=16000;
const MAX_CLOSURE=262144;
const MAX_VERIFIER_OUTPUT=196608;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sameAddress=(left,right)=>typeof left==='string'&&typeof right==='string'&&left.toLowerCase()===right.toLowerCase();
const ensure=(condition,reason)=>{if(!condition)throw Error(reason);};

export async function requireOpenNative(problem,client){
 const {deployment:d}=problem;
 ensure(await client.getChainId()===d.chainId,'Wrong native chain');
 return requireOpenConfiguration(problem,(method,args)=>read(client,d.contract,method,args));
}

function text(bytes){
 return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
}

async function readTree(github,treeSha){
 ensure(typeof treeSha==='string'&&COMMIT.test(treeSha),'Immutable Git tree identifier required');
 const tree=await github.request(`/git/trees/${treeSha}?recursive=1`);
 ensure(tree.sha===treeSha&&tree.truncated===false&&Array.isArray(tree.tree)&&
  tree.tree.every(entry=>typeof entry?.path==='string')&&
  new Set(tree.tree.map(entry=>entry.path)).size===tree.tree.length,'Complete immutable tree with unique paths required');
 return tree;
}

async function readBlob(github,sha,maximum){
 ensure(typeof sha==='string'&&COMMIT.test(sha),'Immutable Git blob identifier required');
 const response=await github.request(`/git/blobs/${sha}`);
 const encodedLimit=Math.ceil(maximum/3)*4;
 ensure(response.sha===sha&&response.encoding==='base64'&&typeof response.content==='string'&&
  response.content.length<=encodedLimit+Math.ceil(encodedLimit/30)+4&&
  Number.isSafeInteger(response.size)&&response.size>=1&&response.size<=maximum,
 'Invalid immutable blob');
 const bytes=Buffer.from(response.content,'base64');
 const computed=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
 ensure(bytes.length===response.size&&computed===sha,'Immutable blob hash mismatch');
 return bytes;
}

export async function readOpenBlobs(github,claim,problem){
 const [head,base]=await Promise.all([github.commit(claim.head),github.commit(claim.base)]);
 ensure(head.sha===claim.head&&base.sha===claim.base,'Immutable head/base commit binding required');
 const [tree,baseTree]=await Promise.all([readTree(github,head.tree?.sha),readTree(github,base.tree?.sha)]);
 const paths=openSubmissionBlobs({claim,tree,baseTree,head});
 const artifactLimit=paths.artifactPath.endsWith('.md')?MAX_NOTE:MAX_FORMAL;
 const [artifactBytes,recordBytes]=await Promise.all([
  readBlob(github,paths.artifactSha,artifactLimit),readBlob(github,paths.submissionSha,MAX_RECORD),
 ]);
 ensure(sha256(recordBytes)===claim.submission_hash,'Signed submission record changed');
 const submission=decodeOpenSubmission(recordBytes,{wallet:claim.wallet,problem});
 ensure(submission.evidence.artifact_path===paths.artifactPath,'Submission artifact and immutable tree differ');
 return {artifactBytes,recordBytes,submission};
}

function declaredDependencies(submission){
 return submission.dependencies.map(item=>item.id);
}

function parseBundle(artifactText){
 const bundle=parseProblemJSON(Buffer.from(artifactText));
 ensure(object(bundle)&&Object.keys(bundle).length===5&&bundle.version===1&&
  Array.isArray(bundle.definitions)&&Array.isArray(bundle.dependencies)&&
  typeof bundle.statement==='string'&&typeof bundle.proof==='string','Exact formal bundle required');
 return bundle;
}

function validateBundleDeps(bundle,expectedIds){
 ensure(bundle.dependencies.length<=4&&bundle.dependencies.every(item=>
  object(item)&&Object.keys(item).length===2&&typeof item.id==='string'&&ID.test(item.id)&&
  typeof item.bundle_hash==='string'&&HASH.test(item.bundle_hash))&&
  stableJSON(bundle.dependencies.map(dep=>dep.id))===stableJSON(expectedIds),
 'Formal bundle dependencies must match the published submission record');
}

// Resolve one exact, previously credited record at a time. A regular blob
// reachable from an exact two-parent canonical merge is the prior input.
async function creditedArtifact(github,problem,id,readRecord,formal){
 const {deployment:d,policyHash}=problem;
 const record=await readRecord(id);
 const e=record?.evidence;
 ensure(record?.status==='credited'&&e?.id===id&&e.repository===d.repository&&e.branch===d.branch&&
  e.problem===d.problem&&sameAddress(e.contract,d.contract)&&e.policy===policyHash,
 'Dependency must be credited in this exact problem ledger and policy');
 const type=e.evidence_kind;
 const formalRecord=type==='formal'&&e.verification==='verified'&&
  typeof e.artifact_path==='string'&&/^research\/artifacts\/[a-z0-9][a-z0-9-]{0,63}\.json$/.test(e.artifact_path);
 const noteRecord=type==='research-note'&&e.verification==='not-formal'&&
  typeof e.artifact_path==='string'&&/^research\/notes\/[a-z0-9][a-z0-9-]{0,63}\.md$/.test(e.artifact_path);
 ensure(formalRecord||(!formal&&noteRecord),'A formal proof dependency requires a prior kernel-verified artifact');
 ensure([e.head,e.base,record.merge_commit].every(value=>typeof value==='string'&&COMMIT.test(value))&&
  typeof e.bundle_hash==='string'&&HASH.test(e.bundle_hash)&&e.artifact_hash===e.bundle_hash,
 'Credited dependency is missing immutable artifact commitments');
 const [head,merge,canonicalMerge]=await Promise.all([
  github.commit(e.head),github.commit(record.merge_commit),github.canonicalMerge(d.branch,record.merge_commit),
 ]);
 ensure(canonicalMerge===true&&head.sha===e.head&&merge.sha===record.merge_commit&&
  head.parents?.length===1&&head.parents[0].sha===e.base&&merge.parents?.length===2&&
  merge.parents[0].sha===e.base&&merge.parents[1].sha===e.head&&head.tree?.sha===merge.tree?.sha,
 'Credited dependency is not an exact canonical merge');
 const tree=await readTree(github,head.tree?.sha);
 const entry=tree.tree.find(item=>item.path===e.artifact_path);
 ensure(entry?.type==='blob'&&entry.mode==='100644','Credited dependency artifact must be a plain immutable file');
 const maximum=formalRecord?MAX_FORMAL:MAX_NOTE;
 const bytes=await readBlob(github,entry.sha,maximum);
 const proof=validateOpenArtifactBytes(bytes,type);
 ensure(sha256(bytes)===e.bundle_hash&&proof===e.proof,'Credited dependency bytes differ from its native commitment');
 if(formalRecord){
  const bundle=parseBundle(proof);
  ensure(bundle.statement===e.formal_statement&&Array.isArray(e.dependencies),'Credited formal statement commitment mismatch');
  validateBundleDeps(bundle,e.dependencies);
  return {id,bundle_hash:e.bundle_hash,artifact_hash:e.artifact_hash,bytes,dependencies:bundle.dependencies};
 }
 return {id,bundle_hash:e.bundle_hash,artifact_hash:e.artifact_hash,bytes,dependencies:[]};
}

export async function resolveOpenDependencies({github,problem,claim,submission,artifactText,readRecord}){
 const formal=submission.evidence.kind==='formal',expectedIds=declaredDependencies(submission);
 const bundle=formal?parseBundle(artifactText):null;
 if(formal)validateBundleDeps(bundle,expectedIds);
 const pending=new Set(),resolved=new Map(),heights=new Map();
 const currentId=claim&&`pr-${claim.pr}-${claim.head.slice(0,12)}-${digest(claim).slice(0,12)}`;
 async function visit(id,expectedHash,depth){
  ensure(typeof id==='string'&&ID.test(id)&&id!==currentId&&!pending.has(id)&&depth<=4,
   'Credited dependency cycle, self-reference or depth limit');
  if(resolved.has(id)){
   ensure(!expectedHash||resolved.get(id).bundle_hash===expectedHash,'Credited dependency bundle commitment mismatch');
   ensure(depth+heights.get(id)<=4,'Credited dependency depth limit');
   return;
  }
  ensure(pending.size+resolved.size<8,'Credited dependency closure exceeds eight artifacts');
  pending.add(id);
  const artifact=await creditedArtifact(github,problem,id,readRecord,formal);
  ensure(!expectedHash||artifact.bundle_hash===expectedHash,'Credited dependency bundle commitment mismatch');
  let height=0;
  if(formal){
   for(const dep of artifact.dependencies){
    await visit(dep.id,dep.bundle_hash,depth+1);
    height=Math.max(height,heights.get(dep.id)+1);
   }
  }
  pending.delete(id);
  resolved.set(id,artifact);
  heights.set(id,height);
 }
 for(const [index,id] of expectedIds.entries())await visit(id,bundle?.dependencies[index].bundle_hash,1);
 const artifacts=[...resolved.values()];
 ensure(!formal||Buffer.byteLength(artifactText)+artifacts.reduce((total,item)=>total+item.bytes.length,0)<=MAX_CLOSURE,
  'Credited dependency closure byte limit');
 return {artifacts,direct:expectedIds.map(id=>resolved.get(id))};
}

export function writeOpenDependencyManifest(directory,dependencies){
 const artifacts=dependencies.artifacts.map((item,index)=>{
  const file=path.resolve(directory,`dependency-${index}.json`);
  fs.writeFileSync(file,item.bytes,{mode:0o600,flag:'wx'});
  return {id:item.id,bundle_hash:item.bundle_hash,artifact_hash:item.artifact_hash,path:file};
 });
 const manifest=path.resolve(directory,'dependencies.json');
 fs.writeFileSync(manifest,JSON.stringify({version:1,artifacts},null,2)+'\n',{mode:0o600,flag:'wx'});
 return manifest;
}

function expectedIdentity(problem,claim){
 return {
  problem:claim.problem,repository:claim.repository,head:claim.head,base:claim.base,
  protocol_commit:claim.protocol_commit,policy:problem.policyHash,
 };
}

function validateFormalResult(result,{problem,claim,artifactText,submission,direct,closure}){
 const bundle=parseBundle(artifactText);
 const expectedIds=declaredDependencies(submission);
 validateBundleDeps(bundle,expectedIds);
 const rawHash=sha256(artifactText);
 const expected={
  ...expectedIdentity(problem,claim),checker:'open-mathematics-v5',toolchain:problem.policy.toolchain,
  bundle_hash:rawHash,artifact_hash:rawHash,formal_statement:bundle.statement,proposition_hash:sha256(bundle.statement),
  statement_hash:sha256({definitions:bundle.definitions,statement:bundle.statement,dependencies:bundle.dependencies}),
  proof_hash:sha256(bundle.proof),theorem:`B_${rawHash}.result`,
 };
 for(const [key,value] of Object.entries(expected))ensure(result[key]===value,'Formal verifier result '+key+' mismatch');
 ensure(result.mode==='isolated'&&result.result==='pass'&&result.production_verified===true&&result.verified===true&&
  result.verification==='verified'&&result.sorry===false&&typeof result.image==='string'&&IMAGE.test(result.image),
 'Isolated production proof verification required');
 ensure(typeof result.statement_hash==='string'&&HASH.test(result.statement_hash)&&
  typeof result.assembly_hash==='string'&&HASH.test(result.assembly_hash),'Verified statement and assembly digests required');
 ensure(Array.isArray(result.axioms)&&new Set(result.axioms).size===result.axioms.length&&
  result.axioms.every(axiom=>problem.policy.allowed_axioms.includes(axiom)),'Unauthorized Lean axioms');
 const bundleHashes=result.dependency_bundle_hashes,artifactHashes=result.dependency_artifact_hashes;
 ensure(object(bundleHashes)&&object(artifactHashes)&&Object.keys(bundleHashes).length<=8&&
  stableJSON(Object.keys(bundleHashes).sort())===stableJSON(Object.keys(artifactHashes).sort())&&
  Object.entries(bundleHashes).every(([id,hash])=>ID.test(id)&&typeof hash==='string'&&HASH.test(hash)&&
   artifactHashes[id]===hash),
 'Bounded credited dependency commitments required');
 if(closure){
  ensure(stableJSON(bundleHashes)===stableJSON(Object.fromEntries(closure.map(item=>[item.id,item.bundle_hash])))&&
   stableJSON(artifactHashes)===stableJSON(Object.fromEntries(closure.map(item=>[item.id,item.artifact_hash]))),
  'Verified dependency closure differs from canonical credited artifacts');
 }
 const evidence=result.verified_dependencies;
 ensure(Array.isArray(result.proof_body_uses)&&Array.isArray(evidence)&&evidence.length===expectedIds.length&&
  result.proof_body_uses.length===expectedIds.length&&new Set(result.proof_body_uses).size===expectedIds.length&&
  expectedIds.every(id=>result.proof_body_uses.includes(id)&&evidence.some(use=>use?.id===id)),
 'Every declared formal dependency must occur in the surviving Lean proof body');
 for(const use of evidence){
  const index=expectedIds.indexOf(use.id),dep=bundle.dependencies[index],prior=direct?.find(item=>item.id===use.id);
  ensure(dep&&Object.keys(use).length===4&&use.proof_body_use===true&&bundleHashes[use.id]===dep.bundle_hash&&
   use.constant===`B_${dep.bundle_hash}.result`&&use.artifact_hash===artifactHashes[use.id]&&
   (!direct||(prior&&prior.bundle_hash===dep.bundle_hash&&use.artifact_hash===prior.artifact_hash)),
  'Formal dependency use differs from its exact credited artifact');
 }
 return result;
}

export function noteResult(problem,claim,artifactText){
 const noteHash=sha256('Open Mathematics research note v5\n'+artifactText),bundleHash=sha256(artifactText);
 return {...expectedIdentity(problem,claim),checker:'open-mathematics-v5-note',mode:'static-note',
  production_verified:false,verified:false,verification:'not-formal',formal_statement:'',
  statement_hash:noteHash,proposition_hash:noteHash,bundle_hash:bundleHash,artifact_hash:bundleHash,
  proof_body_uses:[],verified_dependencies:[]};
}

export function validateOpenResult(result,options){
 ensure(object(result),'Missing open research verifier result');
 if(options.submission.evidence.kind==='formal')return validateFormalResult(result,options);
 const expected=noteResult(options.problem,options.claim,options.artifactText);
 for(const [key,value] of Object.entries(expected))ensure(stableJSON(result[key])===stableJSON(value),'Research note result '+key+' mismatch');
 ensure(!['axioms','theorem','theorems','result','assembly_hash'].some(field=>Object.hasOwn(result,field)),
  'Research notes cannot carry kernel verification results');
 return result;
}

export async function verifyOpenAttestation(attestation,{problem,claim,authorId,commentId,createdAt}){
 const {deployment:d}=problem;
 const claimDigest=digest(claim);
 ensure(object(attestation)&&Object.keys(attestation).length===4&&attestation.claimDigest===claimDigest&&
  sameAddress(attestation.verifier,d.verifier)&&typeof attestation.signature==='string'&&SIGNATURE.test(attestation.signature)&&
  object(attestation.evidence),'Invalid open research verifier envelope');
 const e=attestation.evidence;
 const signer=await recoverMessageAddress({message:ATTESTATION_DOMAIN+canonical(e),signature:attestation.signature});
 ensure(sameAddress(signer,d.verifier),'Unknown evidence verifier');
 if(e.worker_commit!==problem.descriptor.protocol.commit)
  throw Object.assign(Error('Attestation has another worker pin. Reconcile the journal under its original reviewed worker.'),{code:'WORKER_ATTESTATION_MISMATCH'});
 ensure(e.claim_digest===claimDigest&&e.pr===claim.pr&&e.chainId===d.chainId&&e.contract===d.contract&&
  e.branch===d.branch&&e.submission_path===claim.submission_path&&e.submission_hash===claim.submission_hash&&
  positiveId(commentId)&&e.comment_id===commentId&&typeof createdAt==='string'&&e.comment_created_at===createdAt&&
  positiveId(authorId)&&e.github_author_id===authorId&&e.wallet===claim.wallet,'Attestation identity mismatch');
 validateGitHubIdentityEvidence(e,{at:createdAt,minimumAgeDays:d.minimumGitHubAccountAgeDays});
 ensure(typeof e.proof==='string'&&typeof e.submission_text==='string','Exact attested artifact and submission bytes required');
 const artifactText=validateOpenArtifactBytes(Buffer.from(e.proof),e.evidence_kind);
 const recordBytes=Buffer.from(e.submission_text);
 ensure(sha256(recordBytes)===claim.submission_hash,'Attested submission bytes differ from signed record');
 const submission=decodeOpenSubmission(recordBytes,{wallet:claim.wallet,problem});
 ensure(stableJSON(e.submission)===stableJSON(submission)&&e.artifact_path===submission.evidence.artifact_path&&
  e.evidence_kind===submission.evidence.kind,'Attested submission metadata differs from its signed bytes');
 validateOpenResult(e,{problem,claim,artifactText,submission});
 return {evidence:e,submission};
}

export function openVerifierFailure({stdout,stderr}){
 try{
  const report=JSON.parse(stdout);
  if(report?.checker==='open-mathematics-v5'&&report.result==='fail'&&
   report.production_verified===false&&report.verified===false&&typeof report.error==='string'&&report.error)
   return report.error.slice(0,2800);
 }catch{
  // No valid failure object was produced. Keep a bounded process diagnostic.
 }
 return stderr?.slice(-2800)||'proof check did not finish';
}

function runFormal({problem,claim,artifactBytes,artifactText,submission,dependencies}){
 const image=process.env.TRUSTED_LEAN_IMAGE;
 ensure(typeof image==='string'&&IMAGE.test(image),'Pinned Lean image ID required');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'open-math-artifacts-'));
 try{
  const candidate=path.join(dir,'candidate.json');
  fs.writeFileSync(candidate,artifactBytes,{mode:0o600});
  const manifest=writeOpenDependencyManifest(dir,dependencies);
  const args=['scripts/verify_open.py',candidate,'--policy',path.join(problem.root,problem.descriptor.policy.path),
   '--policy-hash',problem.policyHash,'--dependencies',manifest,'--head',claim.head,'--base',claim.base,
   '--protocol-commit',claim.protocol_commit,'--repository',claim.repository];
  const run=spawnSync('python3',args,{cwd:PROTOCOL_ROOT,encoding:'utf8',timeout:90000,maxBuffer:MAX_VERIFIER_OUTPUT,
   env:{PATH:process.env.PATH,TRUSTED_LEAN_IMAGE:image}});
  if(run.status!==0)throw Error('Isolated verifier rejected: '+openVerifierFailure(run));
  const result=validateOpenResult(JSON.parse(run.stdout),{
   problem,claim,artifactText,submission,direct:dependencies.direct,closure:dependencies.artifacts,
  });
  ensure(result.image===image,'Proof verifier used a different Lean image');
  return result;
 }finally{
  fs.rmSync(dir,{recursive:true,force:true});
 }
}

async function main(){
 const [claimFile]=process.argv.slice(2);
 ensure(claimFile,'Usage: node github/open-verify.mjs signed-claim.json');
 const commentId=Number(process.env.CLAIM_COMMENT_ID),createdAt=process.env.CLAIM_CREATED_AT;
 ensure(/^[1-9][0-9]*$/.test(process.env.CLAIM_COMMENT_ID||'')&&positiveId(commentId)&&Number.isFinite(Date.parse(createdAt)),
  'Selected claim comment ID and original creation time required');
 const problem=loadWorkflowOpenProblem(process.env),d=problem.deployment;
 verifyOpenCheckout(problem,PROTOCOL_ROOT);
 const {claim,signature}=JSON.parse(fs.readFileSync(claimFile,'utf8'));
 validateOpenClaim(claim,problem,{now:Date.parse(createdAt)});
 ensure(typeof signature==='string'&&SIGNATURE.test(signature),'Invalid claim signature');
 const signer=await recoverMessageAddress({message:message(claim),signature});
 ensure(sameAddress(signer,claim.wallet),'Invalid wallet claim');
 const github=new GitHub({repository:d.repository,token:process.env.GITHUB_TOKEN});
 const pr=await github.bindAuthor({claim,signature},{commentId,createdAt});
 ensure(pr.state==='open'&&pr.merged===false&&pr.base.ref===d.branch&&pr.base.sha===claim.base&&
  await github.branchHead(d.branch)===claim.base,'Canonical branch advanced; rebase and sign a new claim');
 const identity=await fetchGitHubIdentity({
  github,authorId:pr.user.id,login:pr.user.login,at:createdAt,minimumAgeDays:d.minimumGitHubAccountAgeDays,
 });
 const client=clientFor();
 await requireOpenNative(problem,client);
 const {artifactBytes,recordBytes,submission}=await readOpenBlobs(github,claim,problem);
 const artifactText=validateOpenArtifactBytes(artifactBytes,submission.evidence.kind);
 const dependencies=await resolveOpenDependencies({github,problem,claim,submission,artifactText,
  readRecord:id=>read(client,d.contract,'get',[id])});
 const result=submission.evidence.kind==='formal'?
  runFormal({problem,claim,artifactBytes,artifactText,submission,dependencies}):noteResult(problem,claim,artifactText);
 const claimDigest=digest(claim);
 const evidence={...result,claim_digest:claimDigest,worker_commit:problem.descriptor.protocol.commit,
  wallet:claim.wallet,pr:claim.pr,chainId:d.chainId,contract:d.contract,branch:d.branch,
  submission_path:claim.submission_path,submission_hash:claim.submission_hash,submission_text:text(recordBytes),
  github_author_id:pr.user.id,...identity,comment_id:commentId,comment_created_at:createdAt,submission,proof:artifactText,
  evidence_kind:submission.evidence.kind,artifact_path:submission.evidence.artifact_path};
 const verifier=privateKeyToAccount(process.env.VERIFIER_SIGNING_KEY);
 ensure(sameAddress(verifier.address,d.verifier),'Wrong enrolled verifier');
 const attestation={evidence,claimDigest,verifier:verifier.address,
  signature:await verifier.signMessage({message:ATTESTATION_DOMAIN+canonical(evidence)})};
 console.log(JSON.stringify(attestation));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(error=>{
  const sensitive=[process.env.GITHUB_TOKEN,process.env.VERIFIER_SIGNING_KEY].filter(Boolean);
  console.error(sensitive.reduce((message,key)=>message.split(key).join('[redacted]'),String(error.message)));
  process.exitCode=1;
 });
}
