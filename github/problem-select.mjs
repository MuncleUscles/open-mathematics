// Select one eligible signed comment using reviewed problem data. The worker
// and verifier independently enforce the submission, receipt and merge gates.
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {recoverMessageAddress} from 'viem';
import {GitHub} from '../src/github.mjs';
import {canonical,digest,message} from '../src/security.mjs';
import {loadProblem,validateProblemClaim,verifyProtocolCheckout} from '../src/problem.mjs';

const PROTOCOL_ROOT=fileURLToPath(new URL('../',import.meta.url));
const TERMINAL=new Set(['rejected','invalid','expired']);
const PREFIX=/^Open-Mathematics-Claim: ([a-f0-9]{64})\n```json\n([\s\S]+)\n```\s*$/;
export const positiveId=value=>Number.isSafeInteger(value)&&value>0;
const oldest=(a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id-b.id;

export function loadWorkflowProblem(environment){
 if(!environment.OPEN_MATH_PROBLEM_DIR)throw Error('Reviewed problem directory required');
 const problem=loadProblem(environment.OPEN_MATH_PROBLEM_DIR);
 if(environment.GITHUB_REF!==`refs/heads/${problem.descriptor.configBranch}`||
  environment.GITHUB_REPOSITORY!==problem.deployment.repository)
  throw Error('Reviewed problem configuration branch and repository required');
 return problem;
}

export async function readClaimComment({comment,problem,commentId}){
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
 const goal=validateProblemClaim(claim,problem,{now:Date.parse(comment.created_at)});
 const claimDigest=digest(claim);
 if(claimDigest!==match[1]||!/^0x[0-9a-fA-F]{130}$/.test(signature)||
    comment.issue_url!==`https://api.github.com/repos/${d.repository}/issues/${claim.pr}`||!positiveId(comment.user?.id))
  throw Error('Claim digest, signature or comment identity mismatch');
 const signer=await recoverMessageAddress({message:message(claim),signature});
 if(signer.toLowerCase()!==claim.wallet.toLowerCase())throw Error('Invalid wallet claim');
 return {id:`pr-${claim.pr}-${claim.head.slice(0,12)}-${claimDigest.slice(0,12)}`,
  commentId,createdAt:comment.created_at,claim,envelope,goal};
}

export function requireClaimAuthor(candidate,comment,pr,deployment){
 if(!positiveId(pr?.user?.id)||pr.number!==candidate.claim.pr||pr.user.id!==comment.user.id||
   pr.base?.repo?.full_name!==deployment.repository)throw Error('PR author and repository binding required');
}

export function exactProblemReport(candidate,report,deployment){
 return report?.id===candidate.id&&report.commentId===candidate.commentId&&
  report.commentCreatedAt===candidate.createdAt&&report.contract===deployment.contract&&
  report.chainId===deployment.chainId&&report.repository===deployment.repository&&
  report.pr===candidate.claim.pr&&report.head===candidate.claim.head&&report.base===candidate.claim.base&&
  canonical(report.claim)===canonical(candidate.envelope);
}

export function eligibleProblemClaim({candidate,pr,deployment,canonicalHead,report,entries=[],explicit=false}){
 if(entries.some(e=>e.id===candidate.id&&(TERMINAL.has(e.status)||(!explicit&&e.status==='credited'&&e.needsResume!==true))))return false;
 if(report){
  if(!exactProblemReport(candidate,report,deployment)||TERMINAL.has(report.status)||
   (!explicit&&(report.completedAt||report.blockedConsensus)))return false;
  // A saved claim may need exact-receipt recovery after merge, or release after
  // its PR was closed/retargeted. Eligibility grants no write authority.
  return pr.merged!==true||(pr.head?.sha===candidate.claim.head&&pr.base.ref===deployment.branch);
 }
 return pr.state==='open'&&pr.merged===false&&pr.base?.ref===deployment.branch&&
  pr.head?.sha===candidate.claim.head&&pr.base.sha===candidate.claim.base&&canonicalHead===candidate.claim.base;
}

export async function selectProblemClaim({github,problem,event={},eventName,readEvidence}){
 const {deployment:d}=problem;
 if(d.protocolVersion!==4||github.repository!==d.repository)throw Error('Reviewed v4 problem deployment required');
 const index=await readEvidence('index.json');
 if(index&&(!Array.isArray(index.entries)||index.entries.some(e=>!e||typeof e.id!=='string')))throw Error('Malformed evidence index');
 const entries=index?.entries||[];
 const canonicalHead=await github.branchHead(d.branch);

 async function candidate(comment,pr,{commentId=comment?.id,requireSaved=false,explicit=false}={}){
  let item;
  try{
   item=await readClaimComment({comment,problem,commentId});
   requireClaimAuthor(item,comment,pr,d);
  }catch{return null;}
  const report=await readEvidence(`reports/${item.id}.json`);
  if((requireSaved&&!report)||!eligibleProblemClaim({candidate:item,pr,deployment:d,canonicalHead,report,entries,explicit}))return null;
  if(!report&&await github.branchHead(d.branch)!==canonicalHead)return null;
  return item;
 }

 let requested;
 if(eventName==='issue_comment'){
  if(event.action!=='created'||!event.issue?.pull_request||!positiveId(event.comment?.id))return null;
  requested=event.comment.id;
 }else if(eventName==='workflow_dispatch'){
  const raw=event.inputs?.comment_id;
  if(raw!==undefined&&raw!==''){
   if(typeof raw!=='string'||!/^[1-9][0-9]*$/.test(raw)||!positiveId(Number(raw)))return null;
   requested=Number(raw);
  }
 }else if(eventName!=='schedule')return null;

 async function byCommentId(commentId,options={}){
  let comment;
  try{comment=await github.request(`/issues/comments/${commentId}`);}
  catch(error){if(error.message==='GitHub 404')return null;throw error;}
  const prefix=`https://api.github.com/repos/${d.repository}/issues/`;
  if(comment?.id!==commentId||typeof comment.issue_url!=='string'||!comment.issue_url.startsWith(prefix))return null;
  const suffix=comment.issue_url.slice(prefix.length);
  if(!/^[1-9][0-9]*$/.test(suffix)||!positiveId(Number(suffix)))return null;
  return candidate(comment,await github.pr(Number(suffix)),{commentId,...options});
 }

 if(requested)return byCommentId(requested,{explicit:eventName==='workflow_dispatch'});
 const resumable=entries.filter(e=>e.needsResume===true&&!TERMINAL.has(e.status)&&positiveId(e.commentId))
  .sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt)||a.commentId-b.commentId).slice(0,100);
 for(const entry of resumable){
  const item=await byCommentId(entry.commentId,{requireSaved:true});
  if(item&&item.id===entry.id)return item;
 }
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
 return null;
}

async function main(){
 const problem=loadWorkflowProblem(process.env);
 verifyProtocolCheckout(problem,PROTOCOL_ROOT);
 const github=new GitHub({repository:problem.deployment.repository,token:process.env.GITHUB_TOKEN});
 const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
 async function readEvidence(file){
  try{
   const result=await github.request(`/contents/${file}?ref=evidence`);
   if(result.encoding!=='base64'||typeof result.content!=='string')throw Error('Malformed evidence file');
   return JSON.parse(Buffer.from(result.content,'base64').toString('utf8'));
  }catch(error){if(error.message==='GitHub 404')return null;throw error;}
 }
 const selected=await selectProblemClaim({github,problem,event,eventName:process.env.GITHUB_EVENT_NAME,readEvidence});
 if(!process.env.GITHUB_OUTPUT)throw Error('GitHub output file required');
 fs.appendFileSync(process.env.GITHUB_OUTPUT,`comment_id=${selected?.commentId||''}\n`);
 console.log(selected?`Selected public claim comment ${selected.commentId}.`:'No eligible signed claims in the bounded queue.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(()=>{
  console.error('Claim selection failed. Verification and execution did not start.');
  process.exitCode=1;
 });
}
