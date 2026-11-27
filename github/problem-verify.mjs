// Read trusted release files and immutable PR data. Only the sandboxed Lean
// runner receives the submitted proof, and it receives no operator secrets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {recoverMessageAddress} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {GitHub} from '../src/github.mjs';
import {canonical,digest,enrolledSubmissionBlobs,message} from '../src/security.mjs';
import {decodeSubmission,validateSubmission} from '../src/submission.mjs';
import {isHash,propositionHash,requireNativeConfiguration,requireNativeEnrollment,stableJSON,validateProblemClaim,verifyProblemSource,verifyProtocolCheckout} from '../src/problem.mjs';
import {clientFor,read} from './runtime.mjs';
import {loadWorkflowProblem,positiveId} from './problem-select.mjs';

const PROTOCOL_ROOT=fileURLToPath(new URL('../',import.meta.url));
const ATTESTATION_DOMAIN='Open Mathematics proof attestation v2\n';
const signaturePattern=/^0x[0-9a-fA-F]{130}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sameAddress=(left,right)=>typeof left==='string'&&typeof right==='string'&&left.toLowerCase()===right.toLowerCase();
const require=(condition,message)=>{if(!condition)throw Error(message);};

export async function requireProblemNative(problem,goal,client){
 const {deployment:d}=problem;
 require(await client.getChainId()===d.chainId,'Wrong native chain');
 const view=(method,args)=>read(client,d.contract,method,args);
 await requireNativeConfiguration(problem,view);
 const enrolled=await requireNativeEnrollment(problem,goal,view);
 require(enrolled.statement===goal.statement&&enrolled.path===goal.path&&enrolled.theorem===goal.theorem&&
  enrolled.dependency===goal.dependency&&stableJSON(enrolled.definition_files)===stableJSON(goal.definition_files),
 'Native goal content mismatch');
 return enrolled;
}

export function requireOpenProblemGoal(enrolled){
 if(enrolled.status!=='open')throw Error('New registration requires an open goal');
}

function context(problem,goal,claim){
 const release=problem.policies.get(goal.policyHash);
 require(release?.policy.goals[goal.id]?.goal_hash===goal.goal_hash,'Missing trusted policy goal');
 return {
  release,
  options:{wallet:claim.wallet,goals:{[goal.id]:goal},problem:problem.descriptor.id,policyName:release.policy.name,directions:problem.descriptor.directions},
 };
}

export function validateProblemProof(result,{problem,goal,claim,proofBytes}){
 const {release}=context(problem,goal,claim);
 const expected={
  checker:'open-mathematics-v4',problem:claim.problem,repository:claim.repository,head:claim.head,base:claim.base,
  goal:goal.id,goal_hash:goal.goal_hash,policy:goal.policyHash,problem_commit:goal.problemCommit,
  protocol_commit:goal.protocolCommit,statement_hash:goal.statement_hash,proposition_hash:propositionHash(goal),
  formal_statement:goal.statement,
  theorem:goal.theorem,toolchain:release.policy.toolchain,rewardable:goal.rewardable,
  proof_hash:digest(proofBytes),
 };
 require(object(result),'Missing v4 proof result');
 for(const [key,value] of Object.entries(expected))require(result[key]===value,'Proof result '+key+' mismatch');
 require(result.production_verified===true&&result.verified===true&&result.verification==='verified'&&
  typeof result.image==='string'&&/^sha256:[a-f0-9]{64}$/.test(result.image)&&
  result.mode==='isolated'&&result.result==='pass'&&result.sorry===false,
 'Isolated production proof verification required');
 require(isHash(result.artifact_hash)&&Array.isArray(result.theorems)&&result.theorems.length===1&&
  result.theorems[0]===goal.theorem,'Pinned theorem and artifact commitment required');
 require(Array.isArray(result.axioms)&&new Set(result.axioms).size===result.axioms.length&&
  result.axioms.every(axiom=>release.policy.allowed_axioms.includes(axiom)),'Unauthorized Lean axioms');
 const sourceHashes=Object.fromEntries(goal.definition_files.map(file=>[file,release.policy.files[file]]));
 require(stableJSON(result.source_hashes)===stableJSON(sourceHashes)&&
  stableJSON(result.policy_source_hashes)===stableJSON(release.policy.files),'Trusted proof source hashes mismatch');
 require(result.dependency_artifact===null&&Array.isArray(result.proof_body_uses)&&!result.proof_body_uses.length,
  'This policy has no enrolled credited proof dependencies');
 return result;
}

export async function verifyProblemAttestation(attestation,{problem,goal,claim,authorId,commentId,createdAt}){
 const {deployment:d}=problem;
 const claimDigest=digest(claim);
 require(object(attestation)&&Object.keys(attestation).length===4&&
  attestation.claimDigest===claimDigest&&sameAddress(attestation.verifier,d.verifier)&&
  signaturePattern.test(attestation.signature)&&object(attestation.evidence),'Invalid v4 verifier envelope');
 const e=attestation.evidence;
 const signer=await recoverMessageAddress({message:ATTESTATION_DOMAIN+canonical(e),signature:attestation.signature});
 require(sameAddress(signer,d.verifier),'Unknown proof verifier');
 if(e.worker_commit!==problem.descriptor.protocol.commit)
  throw Object.assign(Error('Attestation has another worker pin. Reconcile the journal under its original reviewed worker.'),{code:'WORKER_ATTESTATION_MISMATCH'});
 require(e.claim_digest===claimDigest&&e.pr===claim.pr&&e.chainId===d.chainId&&e.contract===d.contract&&
  e.branch===d.branch&&e.submission_path===claim.submission_path&&e.submission_hash===claim.submission_hash&&
  positiveId(commentId)&&e.comment_id===commentId&&typeof createdAt==='string'&&e.comment_created_at===createdAt&&
  positiveId(authorId)&&e.github_author_id===authorId&&e.wallet===claim.wallet,
 'Attestation identity mismatch');
 require(typeof e.proof==='string'&&e.proof.length>=3&&Buffer.byteLength(e.proof)<=12000,
  'Bounded attested proof required');
 validateProblemProof(e,{problem,goal,claim,proofBytes:Buffer.from(e.proof)});
 const {options}=context(problem,goal,claim);
 const submission=validateSubmission(e.submission,options);
 require(!submission.dependencies.length&&Array.isArray(e.verified_dependencies)&&!e.verified_dependencies.length,
  'This policy has no enrolled credited proof dependencies');
 return {evidence:e,submission};
}

export async function readProblemProofBlobs(github,claim,goal){
 const [head,base]=await Promise.all([github.commit(claim.head),github.commit(claim.base)]);
 require(head.sha===claim.head&&base.sha===claim.base&&/^[a-f0-9]{40}$/.test(head.tree?.sha||'')&&
  /^[a-f0-9]{40}$/.test(base.tree?.sha||''),'Immutable head/base commit binding required');
 const [tree,baseTree]=await Promise.all([
  github.request(`/git/trees/${head.tree.sha}?recursive=1`),
  github.request(`/git/trees/${base.tree.sha}?recursive=1`),
 ]);
 require(tree.sha===head.tree.sha&&baseTree.sha===base.tree.sha,'Immutable head/base tree binding required');
 for(const snapshot of [tree,baseTree]){
  require(snapshot.truncated===false&&Array.isArray(snapshot.tree)&&
   snapshot.tree.every(entry=>typeof entry?.path==='string')&&
   new Set(snapshot.tree.map(entry=>entry.path)).size===snapshot.tree.length,
  'Complete immutable tree with unique paths required');
 }
 const entries=enrolledSubmissionBlobs({claim,tree,baseTree,head,proofPaths:[goal.path]});
 async function blob(sha){
  const response=await github.request(`/git/blobs/${sha}`);
  require(response.sha===sha&&response.encoding==='base64'&&typeof response.content==='string'&&
   response.content.length<=17000&&Number.isSafeInteger(response.size)&&response.size>=1&&response.size<=12000,
  'Invalid immutable blob');
  const bytes=Buffer.from(response.content,'base64');
  const computed=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  require(bytes.length===response.size&&computed===sha,'Immutable blob hash mismatch');
  return bytes;
 }
 const [proofBytes,recordBytes]=await Promise.all([blob(entries.proofSha),blob(entries.submissionSha)]);
 require(digest(recordBytes)===claim.submission_hash,'Signed submission record changed');
 return {proofBytes,recordBytes};
}

async function main(){
 const [claimFile]=process.argv.slice(2);
 require(claimFile,'Usage: node github/problem-verify.mjs signed-claim.json');
 const commentId=Number(process.env.CLAIM_COMMENT_ID),createdAt=process.env.CLAIM_CREATED_AT;
 require(/^[1-9][0-9]*$/.test(process.env.CLAIM_COMMENT_ID||'')&&positiveId(commentId)&&Number.isFinite(Date.parse(createdAt)),
  'Selected claim comment ID and original creation time required');
 const problem=loadWorkflowProblem(process.env);
 const {deployment:d}=problem;
 const {claim,signature}=JSON.parse(fs.readFileSync(claimFile,'utf8'));
 const goal=validateProblemClaim(claim,problem,{now:Date.parse(createdAt)});
 verifyProtocolCheckout(problem,PROTOCOL_ROOT);
 require(signaturePattern.test(signature),'Invalid claim signature');
 const signer=await recoverMessageAddress({message:message(claim),signature});
 require(sameAddress(signer,claim.wallet),'Invalid wallet claim');
 const github=new GitHub({repository:d.repository,token:process.env.GITHUB_TOKEN});
 const pr=await github.bindAuthor({claim,signature},{commentId,createdAt});
 require(pr.state==='open'&&pr.merged===false&&pr.base.ref===d.branch&&pr.base.sha===claim.base&&
  await github.branchHead(d.branch)===claim.base,'Canonical branch advanced; rebase and sign a new claim');
 const enrolled=await requireProblemNative(problem,goal,clientFor());
 requireOpenProblemGoal(enrolled);
 await verifyProblemSource(problem,goal,github);
 const {options,release}=context(problem,goal,claim);
 const {proofBytes,recordBytes}=await readProblemProofBlobs(github,claim,goal);
 const submission=decodeSubmission(recordBytes,options);
 require(!submission.dependencies.length,'This policy has no enrolled credited proof dependencies');
 const proofText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(proofBytes);
 require(/^sha256:[a-f0-9]{64}$/.test(process.env.TRUSTED_LEAN_IMAGE||''),'Pinned Lean image ID required');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'open-math-problem-proof-'));
 try{
  const proof=path.join(dir,'candidate.proof');
  fs.writeFileSync(proof,proofBytes,{mode:0o600});
  const args=['scripts/verify_problem.py',proof,'--problem-root',problem.root,'--policy',release.entry.path,
   '--policy-hash',goal.policyHash,'--goal',goal.id,'--head',claim.head,'--base',claim.base,
   '--problem-commit',goal.problemCommit,'--protocol-commit',goal.protocolCommit,'--repository',d.repository];
  const run=spawnSync('python3',args,{cwd:PROTOCOL_ROOT,encoding:'utf8',timeout:60000,maxBuffer:100000,
   env:{PATH:process.env.PATH,TRUSTED_LEAN_IMAGE:process.env.TRUSTED_LEAN_IMAGE}});
  if(run.status!==0)throw Error('Isolated verifier rejected: '+run.stderr?.slice(-3000));
  const result=validateProblemProof(JSON.parse(run.stdout),{problem,goal,claim,proofBytes});
  require(result.image===process.env.TRUSTED_LEAN_IMAGE,'Proof verifier used a different Lean image');
  const claimDigest=digest(claim);
  const evidence={...result,claim_digest:claimDigest,worker_commit:problem.descriptor.protocol.commit,
   wallet:claim.wallet,pr:claim.pr,chainId:d.chainId,contract:d.contract,
   branch:d.branch,submission_path:claim.submission_path,submission_hash:claim.submission_hash,
   github_author_id:pr.user.id,comment_id:commentId,comment_created_at:createdAt,
   submission,proof:proofText,verified_dependencies:[]};
  const verifier=privateKeyToAccount(process.env.VERIFIER_SIGNING_KEY);
  require(sameAddress(verifier.address,d.verifier),'Wrong enrolled verifier');
  const attestation={evidence,claimDigest,verifier:verifier.address,signature:await verifier.signMessage({message:ATTESTATION_DOMAIN+canonical(evidence)})};
  console.log(JSON.stringify(attestation));
 }finally{
  fs.rmSync(dir,{recursive:true,force:true});
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(error=>{
  const sensitive=[process.env.GITHUB_TOKEN,process.env.VERIFIER_SIGNING_KEY].filter(Boolean);
  console.error(sensitive.reduce((message,key)=>message.split(key).join('[redacted]'),String(error.message)));
  process.exitCode=1;
 });
}
