// Trusted protocol checkout only. This queue reads public claims; it never reads
// signing keys, executes PR code, or authorizes a merge/award.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {recoverMessageAddress} from 'viem';
import {GitHub} from '../src/github.mjs';
import {canonical,digest,message,validateClaim} from '../src/security.mjs';

const TERMINAL=new Set(['rejected','invalid','expired']);
const PREFIX=/^Open-Mathematics-Claim: ([a-f0-9]{64})\n```json\n([\s\S]+)\n```\s*$/;
const positiveId=x=>Number.isSafeInteger(x)&&x>0;
const oldest=(a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id-b.id;

export function reportMatches(candidate,report,deployment){
  if(!report)return true;
  return !TERMINAL.has(report.status)&&!report.completedAt&&report.id===candidate.id&&
    report.commentId===candidate.commentId&&report.contract?.toLowerCase()===deployment.contract.toLowerCase()&&
    report.repository===deployment.repository&&report.pr===candidate.claim.pr&&
    report.head===candidate.claim.head&&report.base===candidate.claim.base&&
    canonical(report.claim)===canonical(candidate.envelope);
}

// Invalid/unrelated input is simply not work. All authority is rechecked by the
// executor; this preflight is only an inexpensive filter before the Docker build.
export async function validateQueuedClaim({comment,pr,deployment,canonicalHead,entries=[],report,preflight=false}){
  try{
    if(deployment.protocolVersion!==2||!positiveId(comment?.id)||
      typeof comment.body!=='string'||comment.body.length>20000||
      comment.created_at!==comment.updated_at||!Number.isFinite(Date.parse(comment.created_at)))return null;
    const match=comment.body.match(PREFIX);if(!match)return null;
    const envelope=JSON.parse(match[2]);
    if(!envelope||Object.keys(envelope).length!==2||!Object.hasOwn(envelope,'claim')||!Object.hasOwn(envelope,'signature'))return null;
    const {claim,signature}=envelope;
    if(!/^0x[0-9a-fA-F]{130}$/.test(signature)||digest(claim)!==match[1])return null;
    validateClaim(claim,{domain:deployment.origin,chainId:deployment.chainId,contract:deployment.contract,
      policy:deployment.policy,branch:deployment.branch,now:Date.parse(comment.created_at)});
    if(claim.repository!==deployment.repository||claim.pr!==pr?.number||
      comment.issue_url!==`https://api.github.com/repos/${deployment.repository}/issues/${claim.pr}`||
      !positiveId(comment.user?.id)||comment.user.id!==pr.user?.id||
      pr.base?.repo?.full_name!==deployment.repository)return null;
    const id=`pr-${claim.pr}-${claim.head.slice(0,12)}-${digest(claim).slice(0,12)}`;
    if(entries.some(e=>e.id===id&&(TERMINAL.has(e.status)||(e.status==='credited'&&e.needsResume!==true))))return null;
    const signer=await recoverMessageAddress({message:message(claim),signature});
    if(signer.toLowerCase()!==claim.wallet.toLowerCase())return null;
    const candidate={id,commentId:comment.id,claim,envelope};
    if(preflight)return candidate;
    if(report){
      if(!reportMatches(candidate,report,deployment))return null;
      // A saved exact claim can resume after merge, or let the executor expire
      // an unmerged stale claim and release its reservation. Neither authorizes
      // settlement: the executor independently verifies all final receipts.
      if(pr.merged===true&&(pr.head?.sha!==claim.head||pr.base.ref!==deployment.branch))return null;
      return candidate;
    }
    if(pr.state!=='open'||pr.merged===true||pr.base.ref!==deployment.branch||
      pr.head?.sha!==claim.head||pr.base.sha!==claim.base||canonicalHead!==claim.base)return null;
    return candidate;
  }catch{return null;}
}

export async function selectClaim({github,deployment,event={},eventName,readEvidence}){
  if(deployment.protocolVersion!==2||github.repository!==deployment.repository||!deployment.branch)throw Error('Enrolled v2 deployment required');
  const index=await readEvidence('index.json');
  if(index&&(!Array.isArray(index.entries)||index.entries.some(e=>!e||typeof e.id!=='string')))throw Error('Malformed evidence index');
  const entries=index?.entries||[];
  const canonicalHead=await github.branchHead(deployment.branch);
  async function candidate(comment,pr,requireSaved=false){
    const c=await validateQueuedClaim({comment,pr,deployment,canonicalHead,entries,preflight:true});
    if(!c)return null;
    const report=await readEvidence(`reports/${c.id}.json`);
    if(requireSaved&&!report)return null;
    if(!await validateQueuedClaim({comment,pr,deployment,canonicalHead,entries,report}))return null;
    // A merge during the scan invalidates a newly selected old-base claim.
    if(!report&&await github.branchHead(deployment.branch)!==canonicalHead)return null;
    return c;
  }
  let requested;
  if(eventName==='issue_comment'){
    if(event.action!=='created'||!event.issue?.pull_request||!positiveId(event.comment?.id))return null;
    requested=event.comment.id;
  }else if(eventName==='workflow_dispatch'){
    const raw=event.inputs?.comment_id;
    if(raw!==undefined&&raw!==''){
      if(typeof raw!=='string'||! /^[1-9][0-9]*$/.test(raw)||!positiveId(Number(raw)))return null;
      requested=Number(raw);
    }
  }else if(eventName!=='schedule')return null;
  async function byCommentId(commentId,requireSaved=false){
    let comment;
    try{comment=await github.request(`/issues/comments/${commentId}`);}
    catch(e){if(e.message==='GitHub 404')return null;throw e;}
    const start=`https://api.github.com/repos/${deployment.repository}/issues/`;
    if(typeof comment.issue_url!=='string'||!comment.issue_url.startsWith(start))return null;
    const suffix=comment.issue_url.slice(start.length);
    if(!/^[1-9][0-9]*$/.test(suffix)||!positiveId(Number(suffix)))return null;
    return candidate(comment,await github.pr(Number(suffix)),requireSaved);
  }
  if(requested)return byCommentId(requested);
  // Recover interrupted execution, including an already merged PR whose initial
  // credit is settled but whose separately reviewed downstream award is not.
  // Only saved exact claims are eligible. Bound recovery work as well as scans.
  const resumable=entries.filter(e=>e.needsResume===true&&!TERMINAL.has(e.status)&&positiveId(e.commentId))
    .sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt)||a.commentId-b.commentId).slice(0,100);
  for(const entry of resumable){
    const c=await byCommentId(entry.commentId,true);
    if(c&&c.id===entry.id)return c;
  }
  // GitHub concurrency keeps only one pending job. A periodic, bounded scan
  // recovers claims whose event jobs were displaced. API failures fail closed.
  const prs=await github.request(`/pulls?state=open&base=${encodeURIComponent(deployment.branch)}&sort=created&direction=asc&per_page=100&page=1`);
  if(!Array.isArray(prs))throw Error('Malformed PR queue');
  for(const item of prs.slice(0,100).sort(oldest)){
    const pr=await github.pr(item.number);
    if(pr.state!=='open'||pr.base?.ref!==deployment.branch||pr.base.sha!==canonicalHead)continue;
    const comments=await github.request(`/issues/${pr.number}/comments?per_page=100&page=1`);
    if(!Array.isArray(comments))throw Error('Malformed comment queue');
    for(const comment of comments.slice(0,100).sort(oldest)){
      const c=await candidate(comment,pr);if(c)return c;
    }
  }
  return null;
}

async function main(){
  if(process.env.GITHUB_REF!=='refs/heads/protocol')throw Error('Trusted protocol branch required');
  const deployment=JSON.parse(fs.readFileSync('public/deployment.json','utf8'));
  if(digest(fs.readFileSync('lean/policy.json'))!==deployment.policy||digest(fs.readFileSync('contracts/research.py'))!==deployment.codeHash)throw Error('Deployment source hashes do not match');
  const github=new GitHub({repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN});
  const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  async function readEvidence(file){
    try{
      const r=await github.request(`/contents/${file}?ref=evidence`);
      if(r.encoding!=='base64'||typeof r.content!=='string')throw Error('Malformed evidence file');
      return JSON.parse(Buffer.from(r.content,'base64').toString('utf8'));
    }catch(e){if(e.message==='GitHub 404')return null;throw e;}
  }
  const selected=await selectClaim({github,deployment,event,eventName:process.env.GITHUB_EVENT_NAME,readEvidence});
  if(!process.env.GITHUB_OUTPUT)throw Error('GitHub output file required');
  fs.appendFileSync(process.env.GITHUB_OUTPUT,`comment_id=${selected?.commentId||''}\n`);
  console.log(selected?`Selected public claim comment ${selected.commentId}.`:'No eligible pending signed claims in the bounded queue.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{console.error('Claim selection failed; no verifier or executor was started.');process.exitCode=1;});
}
