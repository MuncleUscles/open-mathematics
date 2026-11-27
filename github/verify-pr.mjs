// Trusted protocol checkout only. Treat all repository/PR content as bounded data.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {recoverMessageAddress} from 'viem';import {privateKeyToAccount} from 'viem/accounts';
import {GitHub} from '../src/github.mjs';import {validateClaim,message,digest,canonical,enrolledSubmissionBlobs} from '../src/security.mjs';
import {decodeSubmission} from '../src/submission.mjs';import {clientFor,read} from './runtime.mjs';
const [claimFile]=process.argv.slice(2);if(!claimFile)throw Error('Usage: node github/verify-pr.mjs signed-claim.json');
const rawCommentId=process.env.CLAIM_COMMENT_ID,commentId=Number(rawCommentId),createdAt=process.env.CLAIM_CREATED_AT;
const claimAt=Date.parse(createdAt);
if(!/^[1-9][0-9]*$/.test(rawCommentId||'')||!Number.isSafeInteger(commentId)||!Number.isFinite(claimAt))
 throw Error('Selected claim comment ID and original creation time required');
const deployment=JSON.parse(fs.readFileSync('public/deployment.json','utf8'));
const policy=JSON.parse(fs.readFileSync('lean/policy.json','utf8'));
if(deployment.protocolVersion!==3||digest(fs.readFileSync('lean/policy.json'))!==deployment.policy)throw Error('Reviewed v3 deployment required');
const {claim,signature}=JSON.parse(fs.readFileSync(claimFile,'utf8'));
validateClaim(claim,{domain:deployment.origin,chainId:deployment.chainId,contract:deployment.contract,policy:deployment.policy,branch:deployment.branch,now:claimAt});
const signer=await recoverMessageAddress({message:message(claim),signature});if(signer.toLowerCase()!==claim.wallet.toLowerCase())throw Error('Invalid wallet claim');
const gh=new GitHub({repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN});
if(gh.repository!==deployment.repository)throw Error('Wrong repository');
const pr=await gh.bindAuthor({claim,signature},{commentId,createdAt});
if(pr.state!=='open'||pr.base.ref!==deployment.branch||pr.base.sha!==claim.base||await gh.branchHead(deployment.branch)!==claim.base)throw Error('Canonical branch advanced; rebase and sign a new claim');
const [tree,baseTree,head]=await Promise.all([gh.request(`/git/trees/${claim.head}?recursive=1`),gh.request(`/git/trees/${claim.base}?recursive=1`),gh.commit(claim.head)]);
const entries=enrolledSubmissionBlobs({claim,tree,baseTree,head,proofPaths:Object.values(policy.goals).map(g=>g.path)});
async function blob(sha){const r=await gh.request(`/git/blobs/${sha}`);if(r.sha!==sha||r.encoding!=='base64'||r.size>12000)throw Error('Invalid immutable blob');const bytes=Buffer.from(r.content,'base64');if(bytes.length!==r.size)throw Error('Truncated blob');return bytes;}
const [proofBytes,recordBytes]=await Promise.all([blob(entries.proofSha),blob(entries.submissionSha)]);
if(digest(recordBytes)!==claim.submission_hash)throw Error('Signed submission record changed');
const submission=decodeSubmission(recordBytes,{wallet:signer,goals:policy.goals});
if(submission.evidence.proof_path!==entries.proofPath)throw Error('Submission goal does not match changed proof');
const goal=policy.goals[submission.evidence.goal],verifiedDependencies=[];
let dependencyBytes,dependencyRecord;
if(goal.dependency){
 if(submission.dependencies.length!==1)throw Error('This goal requires exactly one credited renaming dependency');
 const id=submission.dependencies[0].id;
 dependencyRecord=await read(clientFor(),deployment.contract,'get',[id]);
 if(dependencyRecord.status!=='credited'||dependencyRecord.evidence.repository!==gh.repository||dependencyRecord.evidence.statement_hash!==policy.goals.renaming.statement_hash)throw Error('Exact credited renaming statement required');
 const priorBranch=dependencyRecord.migration?'main':deployment.branch;
 if(!await gh.canonicalMerge(priorBranch,dependencyRecord.merge_commit))throw Error('Dependency is not canonical');
 const priorTree=await gh.request(`/git/trees/${dependencyRecord.merge_commit}?recursive=1`);
 const entry=priorTree.tree?.find(e=>e.path===policy.goals.renaming.path);
 if(priorTree.truncated||!entry||entry.mode!=='100644'||entry.type!=='blob')throw Error('Plain immutable dependency required');
 dependencyBytes=await blob(entry.sha);
 verifiedDependencies.push({id,artifact_hash:dependencyRecord.evidence.artifact_hash,proof_body_use:true,constant:goal.dependency});
}else if(submission.dependencies.length)throw Error('This enrolled goal has no credited proof dependencies');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'open-math-proof-'));try{
 const proof=path.join(dir,'candidate.proof');fs.writeFileSync(proof,proofBytes);
 const args=['scripts/verify_lean.py',proof,'--goal',submission.evidence.goal,'--head',claim.head,'--base',claim.base,'--repository',gh.repository];
 if(dependencyBytes){const file=path.join(dir,'dependency.proof');fs.writeFileSync(file,dependencyBytes);args.push('--dependency-file',file,'--dependency-artifact',dependencyRecord.evidence.artifact_hash);}
 const run=spawnSync('python3',args,{encoding:'utf8',timeout:60000,maxBuffer:100000,env:{PATH:process.env.PATH,TRUSTED_LEAN_IMAGE:process.env.TRUSTED_LEAN_IMAGE}});
 if(run.status!==0)throw Error('Isolated verifier rejected: '+run.stderr);
 const evidence={...JSON.parse(run.stdout),claim_digest:digest(claim),wallet:claim.wallet,pr:claim.pr,chainId:deployment.chainId,contract:deployment.contract,branch:deployment.branch,submission_path:claim.submission_path,submission_hash:claim.submission_hash,github_author_id:pr.user.id,submission,proof:proofBytes.toString('utf8'),verified_dependencies:verifiedDependencies};
 const verifier=privateKeyToAccount(process.env.VERIFIER_SIGNING_KEY);
 console.log(JSON.stringify({evidence,claimDigest:digest(claim),verifier:verifier.address,signature:await verifier.signMessage({message:'Open Mathematics proof attestation v2\n'+canonical(evidence)})},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
