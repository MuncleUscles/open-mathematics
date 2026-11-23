import {journaledTransaction} from './journaled-transaction.mjs';
// Trusted protocol checkout. No PR-controlled code, workflow or dependency install.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {createAccount} from 'genlayer-js';import {recoverMessageAddress} from 'viem';
import {GitHub,executeDecision} from '../src/github.mjs';import {StudioAuthority} from '../src/studio.mjs';
import {digest,canonical,message,validateClaim,verifyAttestation} from '../src/security.mjs';
import {validateSubmission} from '../src/submission.mjs';
import {claimFailureOutcome,expireStaleUnmergedClaim} from './claim-recovery.mjs';
import {clientFor,read,clean,sleep} from './runtime.mjs';
const deployment=JSON.parse(fs.readFileSync('public/deployment.json','utf8'));
const proofPolicy=JSON.parse(fs.readFileSync('lean/policy.json','utf8'));
const gh=new GitHub({repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN});
if(deployment.protocolVersion!==3||gh.repository!==deployment.repository||digest(fs.readFileSync('lean/policy.json'))!==deployment.policy||digest(fs.readFileSync('contracts/research.py'))!==deployment.codeHash)throw Error('Unenrolled v3 repository or policy');
const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
const commentId=Number(process.env.CLAIM_COMMENT_ID)||event.comment?.id||Number(event.inputs?.comment_id);
if(!Number.isSafeInteger(commentId))throw Error('Signed claim comment ID required');
const comment=await gh.request(`/issues/comments/${commentId}`);
if(comment.created_at!==comment.updated_at||comment.body.length>20000)throw Error('Fresh unedited signed comment required');
const match=comment.body.match(/^Open-Mathematics-Claim: ([a-f0-9]{64})\n```json\n([\s\S]+)\n```\s*$/);
if(!match)throw Error('Use the exact signed claim comment format');
const envelope=JSON.parse(match[2]),{claim,signature}=envelope;
if(digest(claim)!==match[1])throw Error('Claim digest mismatch');
validateClaim(claim,{domain:deployment.origin,chainId:deployment.chainId,contract:deployment.contract,policy:deployment.policy,branch:deployment.branch,now:Date.parse(comment.created_at)});
if((await recoverMessageAddress({message:message(claim),signature})).toLowerCase()!==claim.wallet.toLowerCase())throw Error('Invalid signature');
if(claim.repository!==gh.repository||comment.issue_url!==`https://api.github.com/repos/${gh.repository}/issues/${claim.pr}`)throw Error('Claim repository/PR mismatch');
const pr=await gh.pr(claim.pr);
if(comment.user.id!==pr.user.id||pr.base?.repo?.full_name!==gh.repository)throw Error('PR author and repository binding required');
const id=`pr-${claim.pr}-${claim.head.slice(0,12)}-${digest(claim).slice(0,12)}`;
async function getFile(file){try{const r=await gh.request(`/contents/${file}?ref=evidence`);return {sha:r.sha,data:JSON.parse(Buffer.from(r.content,'base64'))};}catch(e){if(e.message==='GitHub 404')return null;throw e;}}
async function putFile(file,data){const old=await getFile(file);return gh.request(`/contents/${file}`,{method:'PUT',body:{message:`Record ${id} research evidence`,branch:'evidence',content:Buffer.from(JSON.stringify(clean(data),null,2)+'\n').toString('base64'),...(old?{sha:old.sha}:{})}});}
const reportPath=`reports/${id}.json`;
let report=(await getFile(reportPath))?.data||{id,mode:'live-github-studio',contract:deployment.contract,chainId:deployment.chainId,repository:gh.repository,pr:claim.pr,head:claim.head,base:claim.base,claim:envelope,commentId,transactions:{},startedAt:new Date().toISOString(),status:'verifying'};
if(report.id!==id||report.commentId!==commentId||report.repository!==gh.repository||report.pr!==claim.pr||report.head!==claim.head||report.contract!==deployment.contract||report.base!==claim.base||canonical(report.claim)!==canonical(envelope))throw Error('Report binding mismatch');
async function save(){
 report.updatedAt=new Date().toISOString();report.run=`https://github.com/${gh.repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
 await putFile(reportPath,report);
 const index=(await getFile('index.json'))?.data||{entries:[]};index.mode='live-github-studio';index.deployment=Object.fromEntries(['protocolVersion','contract','repository','branch','sourceBranch','chainId','policy','windowSeconds'].map(k=>[k,deployment[k]]));
 index.entries=index.entries.filter(e=>e.id!==id);
 index.entries.unshift({id,pr:claim.pr,head:claim.head,wallet:claim.wallet,title:report.attestation?.evidence.submission.title||`Submission PR #${claim.pr}`,status:report.status,reason:report.registrationRejection?.reason,points:report.record?.credited_points||'0',impact:report.impact?Object.fromEntries(['downstream','status','paid_points','allocations','reason'].map(k=>[k,report.impact[k]])):null,dependencies:report.record?.evidence.dependencies||[],report:reportPath,run:report.run,updatedAt:report.updatedAt,commentId,needsResume:!report.completedAt&&!report.blockedConsensus&&!['rejected','invalid','expired'].includes(report.status)});
 await putFile('index.json',index);
}
const verifier=clientFor(process.env.VERIFIER_SIGNING_KEY),executor=clientFor(process.env.EXECUTOR_SIGNING_KEY);
if(createAccount(process.env.VERIFIER_SIGNING_KEY).address.toLowerCase()!==deployment.verifier.toLowerCase()||createAccount(process.env.EXECUTOR_SIGNING_KEY).address.toLowerCase()!==deployment.executor.toLowerCase())throw Error('Wrong enrolled operator');
async function tx(stage,client,method,args,recoverOnly=false){
 const result=await journaledTransaction({client,address:deployment.contract,sender:client===verifier?deployment.verifier:deployment.executor,method,args,independent:['adjudicate','review_impact'].includes(method),recoverOnly,transactions:report.transactions,stage,save});
 return result.hash;
}
async function check(name,conclusion,title,summary,externalId){const c=await gh.request('/check-runs',{method:'POST',body:{name,head_sha:claim.head,status:'completed',conclusion,external_id:externalId,output:{title,summary:summary.slice(0,60000)}}});if(c.app.id!==(name==='open-mathematics/lean'?deployment.verifierAppId:deployment.appId))throw Error('Wrong check publisher');return c;}
async function waitWindow(record){while(Date.now()<=Number(record.deadline)*1000+1500)await sleep(Math.min(5000,Math.max(500,Number(record.deadline)*1000+1500-Date.now())));}
async function recordState(){
 const record=await read(executor,deployment.contract,'get',[id]);
 if(record.evidence.claim_digest!==digest(claim))throw Error('Contract record does not match the signed claim');
 report.record=record;report.status=record.status;await save();return record;
}
function expireIfStale(current){
 return expireStaleUnmergedClaim({
  pr:current,claim,branchHead:branch=>gh.branchHead(branch),
  registered:!!report.transactions.register,expirationStarted:!!report.transactions.expire,
  confirmRegistration:()=>tx('register',verifier,'register',[report.evidenceJSON]),
  readRecord:recordState,release:reason=>tx('expire',executor,'release_unmerged',[id,reason]),
 });
}
try{
 if(await expireIfStale(pr)||(pr.merged&&(pr.head.sha!==claim.head||pr.base.ref!==deployment.branch)))
  throw Error('PR changed; rebase and sign a new claim');
 if(!report.attestation){
  if(pr.state!=='open'||pr.base.sha!==claim.base||await gh.branchHead(deployment.branch)!==claim.base)throw Error('Canonical base changed; rebase and sign a new claim');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'open-math-claim-'));
  try{
   const file=path.join(dir,'claim.json');fs.writeFileSync(file,JSON.stringify(envelope));
   const run=spawnSync(process.execPath,['github/verify-pr.mjs',file],{encoding:'utf8',timeout:90000,maxBuffer:100000,env:{PATH:process.env.PATH,GITHUB_REPOSITORY:gh.repository,GITHUB_TOKEN:process.env.GITHUB_TOKEN,VERIFIER_SIGNING_KEY:process.env.VERIFIER_SIGNING_KEY,TRUSTED_LEAN_IMAGE:process.env.TRUSTED_LEAN_IMAGE,CLAIM_AT:String(Date.parse(comment.created_at))}});
   if(run.status!==0)throw Error('Proof verifier rejected: '+run.stderr.slice(-3000));
   report.attestation=JSON.parse(run.stdout);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
 const e=report.attestation.evidence,meta=validateSubmission(e.submission,{wallet:claim.wallet,goals:proofPolicy.goals}),goal=proofPolicy.goals[meta.evidence.goal];
 await verifyAttestation(report.attestation,{repository:gh.repository,head:claim.head,base:claim.base,policy:deployment.policy,statement_hash:goal.statement_hash,checker:'open-mathematics-v2',toolchain:proofPolicy.toolchain,allowedAxioms:proofPolicy.allowed_axioms,theorem:goal.theorem},deployment.verifier);
 if(e.chainId!==deployment.chainId||e.contract!==deployment.contract||e.branch!==deployment.branch||e.submission_hash!==claim.submission_hash||e.claim_digest!==digest(claim)||e.github_author_id!==pr.user.id||e.pr!==claim.pr||e.wallet.toLowerCase()!==claim.wallet.toLowerCase())throw Error('Attestation identity mismatch');
 {
  const evidenceJSON=JSON.stringify({id,problem:'p-vs-np',policy:deployment.policy,repository:gh.repository,branch:deployment.branch,pr:claim.pr,head:claim.head,base:claim.base,wallet:claim.wallet,claim_digest:digest(claim),submission_hash:claim.submission_hash,github_author_id:e.github_author_id,statement_hash:e.statement_hash,artifact_hash:e.artifact_hash,verification:'verified',claim:meta.claim,kind:meta.kind,research_direction:meta.research_direction,provenance:meta.provenance,dependencies:meta.dependencies.map(d=>d.id),verified_dependencies:e.verified_dependencies,formal_statement:goal.statement,proof:e.proof,context:JSON.stringify({title:meta.title,novelty:meta.novelty,prior_art:meta.prior_art,dependencies:meta.dependencies,attribution:meta.attribution,limitations:meta.limitations})+'\nTrusted scope: established CNF infrastructure, not a P/NP breakthrough. Proof-body use demonstrates structural use of an exact prior artifact, not indispensability. Same GitHub author may control multiple agent wallets; this pilot provides no proof of distinct people.'});
  if(report.evidenceJSON&&report.evidenceJSON!==evidenceJSON)throw Error('Cached report differs from signed verifier evidence');
  report.evidenceJSON=evidenceJSON;
  if(Buffer.byteLength(report.evidenceJSON)>24000||JSON.parse(report.evidenceJSON).context.length>8000)throw Error('Research context exceeds the contract limit');
 }
 await save();
 await check('open-mathematics/lean','success','Pinned Lean and signed submission verified',JSON.stringify(e,null,2),digest(e));
 if(!report.transactions.register&&await gh.branchHead(deployment.branch)!==claim.base)throw Error('Canonical branch advanced before registration');
 await tx('register',verifier,'register',[report.evidenceJSON]);
 let record=await recordState();
 if(['submitted','challenged'].includes(record.status)){
  await tx(`adjudicate-r${record.round}`,executor,'adjudicate',[id,Number(record.round)]);record=await recordState();
 }
 if(record.status==='provisional'){
  await tx(`adjudicate-r${record.round}`,executor,'adjudicate',[id,Number(record.round)],true);
  await waitWindow(record);record=await recordState();
  if(record.status==='challenged')throw Error('Challenge blocks merge; resume this signed comment to request a fresh review');
  if(record.status==='provisional'){
   const fresh=await gh.pr(claim.pr);
   if(await expireIfStale(fresh))throw Error('Stale PR expired without locking the statement');
   if(fresh.merged)throw Error('PR merged before this claim was approved');
   await tx(`finalize-r${record.round}`,executor,'finalize',[id,Number(record.round)]);record=await recordState();
  }
 }
 if(['approved','credited','rejected'].includes(record.status)){
  await tx(`adjudicate-r${record.round}`,executor,'adjudicate',[id,Number(record.round)],true);
  await tx(`finalize-r${record.round}`,executor,'finalize',[id,Number(record.round)],true);
 }
 if(record.status==='rejected')await check('open-mathematics/finalized','failure','GenLayer rejected contribution',record.verdict.reason,report.transactions[`finalize-r${record.round}`].hash);
 else if(['approved','credited'].includes(record.status)){
  const a=report.transactions[`adjudicate-r${record.round}`],f=report.transactions[`finalize-r${record.round}`];
  if(!a||!f)throw Error('Receipts for the current challenge round are missing');
  const registry=new Map([[id,{mode:'live',evidenceJSON:report.evidenceJSON,evidenceDigest:digest(report.evidenceJSON),adjudicationTx:a.hash,finalizeTx:f.hash,round:record.round}]]);
  const chain=new StudioAuthority({client:executor,contract:deployment.contract,chainId:deployment.chainId,policy:deployment.policy,registry,github:gh,appId:deployment.appId,verifierAppId:deployment.verifierAppId,branch:deployment.branch});
  chain.confirmMerge=async(id,head,merge)=>tx('merge',executor,'confirm_merge',[id,head,merge],record.status==='credited');
  report.outcome=await executeDecision({id,chain,github:gh,journal:{record:async(_,sha)=>{report.mergeCommit=sha;await save();}}});
  record=await recordState();
  let impact=await read(executor,deployment.contract,'get_impact',[id]);
  if(['not-requested','challenged'].includes(impact.status)){
   const round=Number(impact.round||0);await tx(`impact-r${round}`,executor,'review_impact',[id,round]);impact=await read(executor,deployment.contract,'get_impact',[id]);
  }
  report.impact=impact;await save();
  if(impact.status==='provisional'){
   await tx(`impact-r${impact.round}`,executor,'review_impact',[id,Number(impact.round)],true);
   await waitWindow(impact);impact=await read(executor,deployment.contract,'get_impact',[id]);
   if(impact.status==='challenged')throw Error('Impact challenge blocks later points; initial earned points remain settled. Resume for fresh review.');
   if(impact.status==='provisional')await tx(`settle-impact-r${impact.round}`,executor,'settle_impact',[id,Number(impact.round)]);
  }
  report.impact=await read(executor,deployment.contract,'get_impact',[id]);
  if(report.impact.status==='settled'){
   const round=Number(report.impact.round);if(!Array.isArray(report.impact.eligible))throw Error('Settled impact eligibility is missing');
   await tx(`impact-r${round}`,executor,'review_impact',[id,round],true);
   if(report.impact.eligible.length)await tx(`settle-impact-r${round}`,executor,'settle_impact',[id,round],true);
  }
  report.upstreamPoints={};for(const use of e.verified_dependencies){const prior=await read(executor,deployment.contract,'get',[use.id]);report.upstreamPoints[use.id]=await read(executor,deployment.contract,'get_points',[prior.evidence.wallet]);}
 }else throw Error('Contribution awaits a resolved contract decision');
 report.points=await read(executor,deployment.contract,'get_points',[claim.wallet]);report.completedAt=new Date().toISOString();delete report.error;delete report.blockedConsensus;await save();console.log('Contribution outcome:',report.status,report.record.credited_points,'Later impact:',report.impact?.paid_points||'0');
}catch(e){
 let failure=String(e.message);
 if(report.record&&['submitted','provisional','challenged','approved'].includes(report.record.status)){
  try{await expireIfStale(await gh.pr(claim.pr));}catch(recovery){failure+=`\nStale-claim recovery: ${recovery.message}`;}
 }
 const {status,registrationRejection}=claimFailureOutcome(report,e);
 report.status=status;
 if(registrationRejection){
  report.registrationRejection=registrationRejection;
  report.completedAt=new Date().toISOString();
  delete report.blockedConsensus;
 }else report.blockedConsensus=/UNDETERMINED|CANCELED|LEADER_TIMEOUT|Finalized execution failed|failed receipt verification|corrected attribution requires|attribution changed before impact/.test(failure);
 report.error=[process.env.GITHUB_TOKEN,process.env.VERIFIER_SIGNING_KEY,process.env.EXECUTOR_SIGNING_KEY].filter(Boolean).reduce((m,key)=>m.split(key).join('[redacted]'),failure);
 await save();
 if(registrationRejection)await check('open-mathematics/finalized','failure','GenLayer registration rejected',registrationRejection.reason,registrationRejection.hash);
 else if(report.status!=='credited')await check(report.attestation?'open-mathematics/finalized':'open-mathematics/lean','failure','Contribution processing stopped',report.error,id);
 throw Error(report.error);
}
