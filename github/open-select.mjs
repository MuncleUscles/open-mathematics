// Select one eligible signed comment using reviewed problem data. The worker
// and verifier independently enforce the submission, receipt and merge gates.
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {recoverResearchOperation} from './research-recovery.mjs';
import {recoverMessageAddress} from 'viem';
import {GitHub} from '../src/github.mjs';
import {readEvidenceFile} from './evidence-file.mjs';
import {walletIntake} from '../src/wallet-intake.mjs';
import {openBuildPlan} from './open-build-plan.mjs';
import {canonical,digest,message} from '../src/security.mjs';
import {loadOpenProblem,validateOpenClaim,verifyOpenCheckout} from '../src/open-research.mjs';

const PROTOCOL_ROOT=process.env.OPEN_MATH_VERIFIER_DIR||fileURLToPath(new URL('../',import.meta.url));
const TERMINAL=new Set(['invalid','expired']);
const terminalEntry=entry=>TERMINAL.has(entry.status)||(entry.status==='rejected'&&entry.needsResume!==true);
const PREFIX=/^Open-Mathematics-Claim: ([a-f0-9]{64})\n```json\n([\s\S]+)\n```\s*$/;
const CONTRIBUTION_ID=/^pr-[1-9][0-9]*-[a-f0-9]{12}-[a-f0-9]{12}$/;
export const positiveId=value=>Number.isSafeInteger(value)&&value>0;
const oldest=(a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id-b.id;

export function openIndexScope(entry,deployment){
 return entry?.repository===deployment.repository&&entry.chainId===deployment.chainId&&
  typeof entry.contract==='string'&&entry.contract.toLowerCase()===deployment.contract.toLowerCase();
}

export function loadWorkflowOpenProblem(environment){
 if(!environment.OPEN_MATH_PROBLEM_DIR)throw Error('Reviewed problem directory required');
 const problem=loadOpenProblem(environment.OPEN_MATH_PROBLEM_DIR);
 if(environment.GITHUB_REF!==`refs/heads/${problem.descriptor.configBranch}`||
  environment.GITHUB_REPOSITORY!==problem.deployment.repository)
  throw Error('Reviewed problem configuration branch and repository required');
 return problem;
}

export async function readOpenClaimComment({comment,problem,commentId}){
 if(!positiveId(commentId)||comment?.id!==commentId||
    typeof comment.created_at!=='string'||comment.created_at!==comment.updated_at||
    !Number.isFinite(Date.parse(comment.created_at))||typeof comment.body!=='string'||comment.body.length>20000)
  throw Error('Fresh unedited signed comment required');
 const match=comment.body.match(PREFIX);
 if(!match)throw Error('Use the exact signed claim comment format');
 const envelope=JSON.parse(match[2]);
 if(!envelope||Object.keys(envelope).length!==2||!Object.hasOwn(envelope,'claim')||
  !Object.hasOwn(envelope,'signature'))throw Error('Exact signed claim envelope required');
 const {claim,signature}=envelope,d=problem.deployment;
 validateOpenClaim(claim,problem,{now:Date.parse(comment.created_at)});
 const claimDigest=digest(claim);
 if(claimDigest!==match[1]||!/^0x[0-9a-fA-F]{130}$/.test(signature)||
    comment.issue_url!==`https://api.github.com/repos/${d.repository}/issues/${claim.pr}`||!positiveId(comment.user?.id))
  throw Error('Claim digest, signature or comment identity mismatch');
 const signer=await recoverMessageAddress({message:message(claim),signature});
 if(signer.toLowerCase()!==claim.wallet.toLowerCase())throw Error('Invalid wallet claim');
 return {id:`pr-${claim.pr}-${claim.head.slice(0,12)}-${claimDigest.slice(0,12)}`,
  commentId,createdAt:comment.created_at,claim,envelope};
}

export function requireClaimAuthor(candidate,comment,pr,deployment){
 if(!positiveId(pr?.user?.id)||pr.number!==candidate.claim.pr||pr.user.id!==comment.user.id||
   pr.base?.repo?.full_name!==deployment.repository)throw Error('PR author and repository binding required');
}

export function exactOpenReport(candidate,report,deployment){
 return report?.id===candidate.id&&report.commentId===candidate.commentId&&
  report.commentCreatedAt===candidate.createdAt&&report.contract===deployment.contract&&
  report.chainId===deployment.chainId&&report.repository===deployment.repository&&
  report.pr===candidate.claim.pr&&report.head===candidate.claim.head&&report.base===candidate.claim.base&&
  canonical(report.claim)===canonical(candidate.envelope);
}

// A saved wallet signature supplies an immutable claim, not fresh GitHub or
// native authority. The worker must verify the signed attestation and exact
// successful registration before this candidate can release anything.
export async function readOpenRecoveryClaim({report,problem,commentId}){
 if(!positiveId(commentId)||report?.commentId!==commentId||
  typeof report.commentCreatedAt!=='string'||!Number.isFinite(Date.parse(report.commentCreatedAt))||
  !report.attestation||typeof report.evidenceJSON!=='string'||
  !report.transactions||typeof report.transactions!=='object'||Array.isArray(report.transactions))throw Error('Saved signed evidence required for cleanup');
 const envelope=report.claim;
 if(!envelope||typeof envelope!=='object'||Object.keys(envelope).length!==2||
  !Object.hasOwn(envelope,'claim')||!Object.hasOwn(envelope,'signature'))throw Error('Saved exact signed envelope required');
 const {claim,signature}=envelope;
 validateOpenClaim(claim,problem,{now:Date.parse(report.commentCreatedAt)});
 if(typeof signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(signature)||
  (await recoverMessageAddress({message:message(claim),signature})).toLowerCase()!==claim.wallet.toLowerCase())
  throw Error('Invalid saved wallet claim');
 const candidate={id:`pr-${claim.pr}-${claim.head.slice(0,12)}-${digest(claim).slice(0,12)}`,
  commentId,createdAt:report.commentCreatedAt,claim,envelope,recoveryOnly:true,
  abandonOnly:!Object.hasOwn(report.transactions,'register')};
 if(!exactOpenReport(candidate,report,problem.deployment))throw Error('Saved recovery report binding mismatch');
 return candidate;
}

export async function staleOpenRecoveryPR({github,candidate,pr,authorId,deployment}){
 if(!positiveId(authorId)||pr?.user?.id!==authorId||pr.number!==candidate.claim.pr||
  pr.base?.repo?.full_name!==deployment.repository||pr.merged!==false||
  !['open','closed'].includes(pr.state)||typeof pr.head?.sha!=='string'||
  !/^[a-f0-9]{40}$/.test(pr.head.sha)||typeof pr.base?.ref!=='string')return false;
 return pr.state==='closed'||pr.head.sha!==candidate.claim.head||pr.base.ref!==candidate.claim.branch||
  await github.branchHead(candidate.claim.branch)!==candidate.claim.base;
}

export async function selectOpenRecoveryClaim({github,problem,commentId,readEvidence,entries}){
 const d=problem.deployment;
 if(!entries){
  const index=await readEvidence('index.json');
  if(!index||!Array.isArray(index.entries))return null;
  entries=index.entries;
 }
 const matches=entries.filter(e=>openIndexScope(e,d)&&e.commentId===commentId&&
  typeof e.id==='string'&&CONTRIBUTION_ID.test(e.id));
 // Never choose between contradictory archive entries for one original comment.
 if(matches.length!==1)return null;
 const report=await readEvidence(`reports/${matches[0].id}.json`);
 if(!report||report.completedAt||['credited','rejected','invalid','expired'].includes(report.status))return null;
 let candidate;
 try{candidate=await readOpenRecoveryClaim({report,problem,commentId});}catch{return null;}
 if(candidate.id!==matches[0].id)return null;
 const pr=await github.pr(candidate.claim.pr),authorId=report.attestation?.evidence?.github_author_id;
 if(candidate.abandonOnly)return positiveId(authorId)&&pr?.user?.id===authorId&&
  pr.number===candidate.claim.pr&&pr.base?.repo?.full_name===d.repository?candidate:null;
 return await staleOpenRecoveryPR({github,candidate,pr,authorId,deployment:d})?candidate:null;
}

export function eligibleOpenClaim({candidate,pr,deployment,canonicalHead,report,entries=[],explicit=false}){
 if(entries.some(e=>e.id===candidate.id&&(terminalEntry(e)||(!explicit&&e.status==='credited'&&e.needsResume!==true))))return false;
 if(report){
  if(!exactOpenReport(candidate,report,deployment)||TERMINAL.has(report.status)||(report.status==='rejected'&&report.completedAt)||
   (!explicit&&(report.completedAt||report.blockedConsensus)))return false;
  // A saved claim may need exact-receipt recovery after merge, or release after
  // its PR was closed/retargeted. Eligibility grants no write authority.
  return pr.merged!==true||(pr.head?.sha===candidate.claim.head&&pr.base.ref===deployment.branch);
 }
 return pr.state==='open'&&pr.merged===false&&pr.base?.ref===deployment.branch&&
  pr.head?.sha===candidate.claim.head&&pr.base.sha===candidate.claim.base&&canonicalHead===candidate.claim.base;
}

export async function selectOpenClaim({github,problem,event={},eventName,readEvidence,intake,wait=delay}){
 const {deployment:d}=problem;
 if(d.protocolVersion!==5||github.repository!==d.repository)throw Error('Reviewed open research deployment required');
 const index=await readEvidence('index.json');
 if(index&&(!Array.isArray(index.entries)||index.entries.some(e=>!e||typeof e.id!=='string')))throw Error('Malformed evidence index');
 const entries=(index?.entries||[]).filter(entry=>openIndexScope(entry,d));
 const canonicalHead=await github.branchHead(d.branch);

 async function finalizedRequest(item,hash,poll){
  let ready=await intake.has(item,hash);
  // The contributor may broadcast immediately after posting the signed comment.
  // Limit polling to the exact foreground event so background scans stay fast.
  for(let attempt=0;poll && !ready && attempt<4;attempt++){
   await wait(20000);
   ready=await intake.has(item,hash);
  }
  return ready;
 }

 async function candidate(comment,pr,{commentId=comment?.id,requireSaved=false,explicit=false}={}){
  let item;
  try{
   item=await readOpenClaimComment({comment,problem,commentId});
   requireClaimAuthor(item,comment,pr,d);
  }catch{return null;}
  const report=await readEvidence(`reports/${item.id}.json`);
  if(requireSaved&&!report)return null;
  const current=pr.state==='open'&&pr.merged===false&&pr.head?.sha===item.claim.head&&
   pr.base?.ref===d.branch&&pr.base.sha===item.claim.base&&canonicalHead===item.claim.base;
  // The finalized request is the trigger. GitHub events and timers only wake the worker.
  if(intake&&current&&report&&!report.completedAt&&exactOpenReport(item,report,d)&&
     ['submitted','challenged'].includes(report.record?.status)){
   const round=Number(report.record.round),hash=report.transactions?.[`adjudicate-r${round}`]?.hash;
   const poll=retryRequest && retryRequest.hash===hash && retryRequest.pr===pr.number && retryRequest.author===pr.user.id;
   if(/^0x[a-f0-9]{64}$/.test(hash)&&await finalizedRequest(item,hash,poll)&&await intake.canRetry(item,hash,round)){
    item.retryHash=hash;
    explicit=true;
   }
  }
  if(!eligibleOpenClaim({candidate:item,pr,deployment:d,canonicalHead,report,entries,explicit}))return null;
  if(!report&&await github.branchHead(d.branch)!==canonicalHead)return null;
  if(intake&&!report?.transactions?.register){
   const poll=current && eventName==='issue_comment' && event.issue?.number===item.claim.pr &&
    (event.comment?.id===item.commentId || (wakePR===item.claim.pr && requested===item.commentId));
   if(!await finalizedRequest(item,undefined,poll))return null;
  }
  return item;
 }

 let requested,retryRequest,wakePR;
 if(eventName==='issue_comment'){
  if(event.action!=='created'||!event.issue?.pull_request||!positiveId(event.comment?.id))return null;
  const retry=event.comment.body?.match(/^Open-Mathematics-Retry: ([1-9][0-9]*) (0x[a-f0-9]{64})\s*$/);
  const wake=event.comment.body?.match(/^Open-Mathematics-Process: ([1-9][0-9]*)\s*$/);
  if(wake){
   requested=Number(wake[1]);wakePR=event.issue.number;
   if(!positiveId(requested)||!positiveId(wakePR))return null;
  }else if(retry){
   requested=Number(retry[1]);
   if(!positiveId(requested)||!positiveId(event.comment.user?.id)||!positiveId(event.issue.number))return null;
   retryRequest={hash:retry[2],pr:event.issue.number,author:event.comment.user.id};
  }else requested=event.comment.id;
 }else if(eventName==='workflow_dispatch'){
  const raw=event.inputs?.comment_id;
  if(raw!==undefined&&raw!==''){
   if(typeof raw!=='string'||!/^[1-9][0-9]*$/.test(raw)||!positiveId(Number(raw)))return null;
   requested=Number(raw);
  }
 }else if(!['schedule','workflow_run','push'].includes(eventName))return null;

 async function byCommentId(commentId,options={}){
  let comment;
  try{comment=await github.request(`/issues/comments/${commentId}`);}
  catch(error){if(error.message!=='GitHub 404')throw error;}
  const recover=()=>selectOpenRecoveryClaim({github,problem,commentId,readEvidence,entries});
  if(!comment)return recover();
  const prefix=`https://api.github.com/repos/${d.repository}/issues/`;
  if(comment?.id!==commentId||typeof comment.issue_url!=='string'||!comment.issue_url.startsWith(prefix))return null;
  const suffix=comment.issue_url.slice(prefix.length);
  if(!/^[1-9][0-9]*$/.test(suffix)||!positiveId(Number(suffix)))return null;
  const pr=await github.pr(Number(suffix));
  try{requireClaimAuthor(await readOpenClaimComment({comment,problem,commentId}),comment,pr,d);}
  catch{return recover();}
  return candidate(comment,pr,{commentId,...options});
 }

 // The recovery workflow receives only a default-branch completion event or
 // its own deployment push. Rebind the saved comment through normal selection.
 if(eventName==='workflow_run'||eventName==='push'){
  if(event.repository?.full_name!==d.repository)return null;
  let failedRun;
  if(eventName==='workflow_run'){
   const run=event.workflow_run;
   if(event.action!=='completed'||!positiveId(run?.id)||run.head_repository?.full_name!==d.repository||
      run.path!=='.github/workflows/research.yml'||run.head_branch!==problem.descriptor.configBranch||
      !['failure','timed_out'].includes(run.conclusion))return null;
   failedRun=`https://github.com/${d.repository}/actions/runs/${run.id}`;
  }else if(event.ref!=='refs/heads/'+problem.descriptor.configBranch)return null;
  const unfinished=entries.filter(entry=>entry.needsResume===true&&!terminalEntry(entry)&&
   CONTRIBUTION_ID.test(entry.id)&&positiveId(entry.commentId)&&(!failedRun||entry.run===failedRun));
  for(const entry of unfinished.slice(0,100)){
   const report=await readEvidence(`reports/${entry.id}.json`);
   if(!report||report.completedAt||report.blockedConsensus||report.commentId!==entry.commentId||
      (failedRun&&report.run!==failedRun))continue;
   // Older workers recorded only the error text. Match their known transport
   // failures exactly; contract execution and disputed judgments stay fenced.
   const interrupted=report.temporaryFailure ?? /^(fetch failed|GitHub (408|429|500|502|503|504))$/.test(report.error);
   if(interrupted!==true&&event.workflow_run?.conclusion!=='timed_out')continue;
   const item=await byCommentId(entry.commentId,{requireSaved:true});
   if(item?.id===entry.id&&!item.recoveryOnly)return item;
  }
  return null;
 }

 if(retryRequest){
  const original=await byCommentId(requested,{explicit:true,requireSaved:true});
  if(!original||original.recoveryOnly||original.claim.pr!==retryRequest.pr)return null;
  const pr=await github.pr(original.claim.pr);
  if(pr.user?.id!==retryRequest.author||pr.state!=='open'||pr.merged!==false||
     pr.head?.sha!==original.claim.head||pr.base?.sha!==original.claim.base||canonicalHead!==original.claim.base)return null;
  const report=await readEvidence(`reports/${original.id}.json`);
  const stage=report?.transactions?.[`adjudicate-r${report.record?.round}`];
  if(!stage||stage.hash!==retryRequest.hash||(intake&&original.retryHash!==retryRequest.hash))return null;
  return {...original,retryHash:retryRequest.hash};
 }
 if(wakePR){
  const item=await byCommentId(requested);
  return item?.claim.pr===wakePR&&!item.recoveryOnly?item:null;
 }
 if(requested)return byCommentId(requested,{explicit:eventName==='workflow_dispatch'});
 // Failed consensus still needs stale-slot cleanup if its original comment
 // disappears. Normal selection remains blocked by the saved failure journal.
 const resumable=entries.filter(e=>(e.needsResume===true||['submitted','provisional','challenged','approved','registration-pending'].includes(e.status))&&!terminalEntry(e)&&positiveId(e.commentId))
  .sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt)||a.commentId-b.commentId).slice(0,100);
 async function firstResumable(entries){
  for(const entry of entries){
   const item=await byCommentId(entry.commentId,{requireSaved:true});
   if(item&&item.id===entry.id)return item;
  }
  return null;
 }
 // A merged result can wait on another attribution case indefinitely. It
 // should not consume every sweep while new contributor requests are ready.
 const active=await firstResumable(resumable.filter(entry=>entry.status!=='credited'));
 if(active)return active;
 const prs=await github.request(`/pulls?state=open&base=${encodeURIComponent(d.branch)}&sort=created&direction=asc&per_page=100&page=1`);
 if(!Array.isArray(prs))throw Error('Malformed PR queue');
 for(const item of prs.slice(0,100).sort(oldest)){
  const pr=await github.pr(item.number);
  if(pr.state!=='open'||pr.base?.ref!==d.branch||pr.base.sha!==canonicalHead)continue;
  const comments=await github.request(`/issues/${pr.number}/comments?per_page=100&page=1`);
  if(!Array.isArray(comments))throw Error('Malformed comment queue');
  for(const comment of comments.slice(0,100).sort(oldest)){
   const selected=await candidate(comment,pr);
   if(selected)return selected;
  }
 }
 return firstResumable(resumable.filter(entry=>entry.status==='credited'));
}

async function main(){
 const problem=loadWorkflowOpenProblem(process.env);
 verifyOpenCheckout(problem,PROTOCOL_ROOT);
 const github=new GitHub({repository:problem.deployment.repository,token:process.env.GITHUB_TOKEN});
 const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
 async function readEvidence(file){return (await readEvidenceFile(github,file))?.data??null;}
 const selected=await selectOpenClaim({github,problem,event,eventName:process.env.GITHUB_EVENT_NAME,readEvidence,intake:walletIntake(problem)});
 if(!process.env.GITHUB_OUTPUT)throw Error('GitHub output file required');
 const plan=selected?await openBuildPlan({github,problem,candidate:selected}):{needs_lean:true};
 fs.appendFileSync(process.env.GITHUB_OUTPUT,`comment_id=${selected?.commentId||''}\nretry_hash=${selected?.retryHash||''}\nneeds_lean=${plan.needs_lean===false?'false':'true'}\n`);
 console.log(selected?`Selected public claim comment ${selected.commentId}.`:'No eligible signed claims in the bounded queue.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 recoverResearchOperation(main).catch(()=>{
  console.error('Claim selection failed. Verification and execution did not start.');
  process.exitCode=1;
 });
}
