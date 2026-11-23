// Execute the reviewed open research protocol for one selected signed claim. All
// transaction stages use the same exact-call journal as the historical pilot.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createAccount} from 'genlayer-js';
import {GitHub,executeDecision} from '../src/github.mjs';
import {readEvidenceFile} from './evidence-file.mjs';
import {StudioAuthority} from '../src/studio.mjs';
import {canonical,digest} from '../src/security.mjs';
import {verifyOpenCheckout} from '../src/open-research.mjs';
import {exactOpenReport,loadWorkflowOpenProblem,openIndexScope,positiveId,readOpenClaimComment,requireClaimAuthor,selectOpenRecoveryClaim,staleOpenRecoveryPR} from './open-select.mjs';
import {requireOpenNative,verifyOpenAttestation} from './open-verify.mjs';
import {claimFailureOutcome,expireStaleUnmergedClaim} from './claim-recovery.mjs';
import {journaledTransaction} from './journaled-transaction.mjs';
import {clientFor,read,clean,sleep} from './runtime.mjs';

const PROTOCOL_ROOT=fileURLToPath(new URL('../',import.meta.url));
const terminal=new Set(['invalid','expired']);
const secrets=()=>[process.env.GITHUB_TOKEN,process.env.VERIFIER_SIGNING_KEY,process.env.EXECUTOR_SIGNING_KEY].filter(Boolean);
const safeError=error=>secrets().reduce((text,key)=>text.split(key).join('[redacted]'),String(error.message));

export function blockedOpenConsensus(error,failure=String(error.message)){
 return ['WORKER_ATTESTATION_MISMATCH','STUDIO_FINALIZED_OUTCOME_INVALID'].includes(error.code)||
  /UNDETERMINED|CANCELED|LEADER_TIMEOUT|VALIDATORS_TIMEOUT|Finalized execution failed|failed receipt verification|corrected attribution requires|attribution changed before impact/.test(failure);
}

export async function openEvidenceJSON({attestation,problem,candidate,authorId,cached}){
 const {claim,id,commentId,createdAt}=candidate;
 const {evidence:e,submission:s}=await verifyOpenAttestation(attestation,{problem,claim,authorId,commentId,createdAt});
 const context=JSON.stringify({
  title:s.title,novelty:s.novelty,prior_art:s.prior_art,dependencies:s.dependencies,
  attribution:s.attribution.contributions,limitations:s.limitations,
  scope_note:'Contribution scope and novelty are separate merit questions. A GitHub author may control multiple agent wallets.',
 });
 if(context.length>12000)throw Error('Research context exceeds the contract limit');
 const evidenceJSON=JSON.stringify({
  id,problem:claim.problem,policy:claim.policy,protocol_commit:claim.protocol_commit,worker_commit:e.worker_commit,
  contract:problem.deployment.contract,repository:claim.repository,branch:claim.branch,
  pr:claim.pr,head:claim.head,base:claim.base,wallet:claim.wallet,claim_digest:digest(claim),
  submission_hash:claim.submission_hash,github_author_id:authorId,claim_comment_id:commentId,claim_comment_created_at:createdAt,
  github_account_created_at:e.github_account_created_at,github_account_type:e.github_account_type,
  statement_hash:e.statement_hash,proposition_hash:e.proposition_hash,artifact_hash:e.artifact_hash,bundle_hash:e.bundle_hash,
  verification:e.verification,claim:s.claim,kind:s.kind,research_direction:s.research_direction,provenance:s.provenance,
  dependencies:s.dependencies.map(dep=>dep.id),verified_dependencies:e.verified_dependencies.map(({id,artifact_hash,proof_body_use})=>({id,artifact_hash,proof_body_use})),
  formal_statement:e.formal_statement,proof:e.proof,context,evidence_kind:e.evidence_kind,artifact_path:e.artifact_path,
  related_contributions:[],
 });
 if(Buffer.byteLength(evidenceJSON)>65536)throw Error('Research evidence exceeds the contract limit');
 if(cached!==undefined&&cached!==evidenceJSON)throw Error('Cached report differs from signed verifier evidence');
 return evidenceJSON;
}

export function requireOpenRecord(record,evidenceJSON,{settledImpact}={}){
 if(record?.digest!==digest(evidenceJSON))throw Error('Native record differs from signed verifier evidence');
 const expected=JSON.parse(evidenceJSON),actual={...record.evidence};
 // Studio may represent native integers as canonical decimal strings.
 for(const key of ['pr','github_author_id','claim_comment_id','github_account_created_at']){
  if(actual[key]===String(expected[key]))actual[key]=expected[key];
 }
 if(canonical(actual)!==canonical(expected))throw Error('Native record fields differ from signed verifier evidence');
 if(settledImpact&&(record.status!=='credited'||record.reserve_settled!==true||
  settledImpact.status!=='settled'||settledImpact.downstream!==expected.id||
  settledImpact.source_digest!==record.digest||String(settledImpact.budget)!==record.impact_reserve||
  settledImpact.returned_points!==record.reserve_returned)){
  throw Error('Finalized contribution and reserve settlement do not agree');
 }
 return record;
}

export function expireUnregisteredOpenReport(report){
 if(Object.hasOwn(report.transactions,'register'))return false;
 report.status='expired';
 report.expiredBeforeRegistration=true;
 report.completedAt=new Date().toISOString();
 delete report.blockedConsensus;
 return true;
}

function invalidateUnregisteredOpenReport(report){
 if(Object.hasOwn(report.transactions,'register'))return false;
 report.status='invalid';report.invalidBeforeRegistration=true;
 report.completedAt=new Date().toISOString();delete report.blockedConsensus;
 return true;
}

export function openClaimFailureOutcome(report,error){
 if(report.expiredBeforeRegistration===true&&!Object.hasOwn(report.transactions,'register'))return {status:'expired'};
 if(report.invalidBeforeRegistration===true&&!Object.hasOwn(report.transactions,'register'))return {status:'invalid'};
 return claimFailureOutcome(report,error);
}

export async function bindOpenRegistration({github,report,candidate,problem,expire,save}){
 const {claim,envelope,commentId,createdAt}=candidate;
 try{
  const selected=await github.bindAuthor(envelope,{commentId,createdAt});
  if(selected.state!=='open'||selected.merged!==false||selected.base.ref!==problem.deployment.branch||
   selected.base.sha!==claim.base||await github.branchHead(problem.deployment.branch)!==claim.base)
   throw Error('Canonical PR changed before registration');
  return selected;
 }catch(error){
  if(!Object.hasOwn(report.transactions,'register')){
   try{
    const current=await github.pr(claim.pr);
    if(current.merged===true||await expire(current)){
     if(report.status!=='expired'&&expireUnregisteredOpenReport(report))await save();
    }else{
     let original;
     try{original=await github.request(`/issues/comments/${commentId}`);}
     catch(readError){if(readError.message!=='GitHub 404')throw readError;}
     let valid=false;
     if(original){
      try{
       const parsed=await readOpenClaimComment({comment:original,problem,commentId});
       requireClaimAuthor(parsed,original,current,problem.deployment);
       valid=parsed.createdAt===createdAt&&canonical(parsed.envelope)===canonical(envelope);
      }catch{}
     }
     if(!valid&&invalidateUnregisteredOpenReport(report))await save();
    }
   }catch(recovery){error.message+='; stale-claim inspection: '+String(recovery.message);}
  }
  throw error;
 }
}

export async function adjudicateOpenRecord({id,record,tx}){
 if(!['submitted','challenged'].includes(record.status))return false;
 const round=Number(record.round);
 await tx(`begin-adjudicate-r${round}`,'begin_adjudication',[id,round]);
 await tx(`adjudicate-r${round}`,'adjudicate',[id,round]);
 return true;
}

export async function recoverStaleOpenRegistration({github,candidate,deployment,authorId,confirmRegistration,readRecord,expire}){
 if(candidate.recoveryOnly!==true)throw Error('Cleanup-only saved claim required');
 // These callbacks verify the exact native receipt and evidence digest; no
 // archive status is sufficient to grant cancellation authority.
 await confirmRegistration();
 const record=await readRecord();
 if(!['submitted','provisional','challenged','approved','expired'].includes(record.status))
  throw Error('Cleanup cannot alter credited or rejected native work');
 const current=await github.pr(candidate.claim.pr);
 if(!await staleOpenRecoveryPR({github,candidate,pr:current,authorId,deployment}))
  throw Error('Cleanup requires a stale unmerged PR with the attested original author');
 if(!await expire(current))throw Error('PR became current; cleanup refused');
 const expired=await readRecord();
 if(expired.status!=='expired')throw Error('Native expiration was not confirmed');
 return expired;
}

function verifierRun(problem,candidate){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'open-math-open-claim-'));
 try{
  const file=path.join(dir,'claim.json');
  fs.writeFileSync(file,JSON.stringify(candidate.envelope),{mode:0o600});
  const run=spawnSync(process.execPath,['github/open-verify.mjs',file],{
   cwd:PROTOCOL_ROOT,encoding:'utf8',timeout:problem.policy.version===6?1260000:120000,maxBuffer:250000,
   env:{PATH:process.env.PATH,GITHUB_REF:process.env.GITHUB_REF,GITHUB_REPOSITORY:problem.deployment.repository,
    GITHUB_TOKEN:process.env.GITHUB_TOKEN,VERIFIER_SIGNING_KEY:process.env.VERIFIER_SIGNING_KEY,
    OPEN_MATH_PROBLEM_DIR:problem.root,TRUSTED_LEAN_IMAGE:process.env.TRUSTED_LEAN_IMAGE,
    CLAIM_COMMENT_ID:String(candidate.commentId),CLAIM_CREATED_AT:candidate.createdAt},
  });
  if(run.status!==0)throw Error('Proof verifier rejected: '+(run.stderr?.slice(-3000)||'isolated verification did not finish'));
  return JSON.parse(run.stdout);
 }finally{
  fs.rmSync(dir,{recursive:true,force:true});
 }
}

async function main(){
 const problem=loadWorkflowOpenProblem(process.env),d=problem.deployment;
 const rawCommentId=process.env.CLAIM_COMMENT_ID,commentId=Number(rawCommentId);
 if(!/^[1-9][0-9]*$/.test(rawCommentId||'')||!positiveId(commentId))throw Error('Selected signed claim comment ID required');
 const github=new GitHub({repository:d.repository,token:process.env.GITHUB_TOKEN});
 let comment,candidate;
 try{comment=await github.request(`/issues/comments/${commentId}`);}
 catch(error){if(error.message!=='GitHub 404')throw error;}
 if(comment){try{candidate=await readOpenClaimComment({comment,problem,commentId});}catch{}}
 if(!candidate)candidate=await selectOpenRecoveryClaim({github,problem,commentId,readEvidence:async file=>(await getFile(file))?.data});
 if(!candidate)throw Error('Original signed comment unavailable; no safely bound stale registration can be cleaned up');
 const {id,claim,createdAt,envelope}=candidate;
 verifyOpenCheckout(problem,PROTOCOL_ROOT);
 const pr=await github.pr(claim.pr);
 if(!candidate.recoveryOnly)requireClaimAuthor(candidate,comment,pr,d);

 async function getFile(file){return readEvidenceFile(github,file);}
 async function putFile(file,data){
  const old=await getFile(file);
  return github.request(`/contents/${file}`,{method:'PUT',body:{
   message:`Record ${id} research evidence`,branch:'evidence',
   content:Buffer.from(JSON.stringify(clean(data),null,2)+'\n').toString('base64'),
   ...(old?{sha:old.sha}:{}),
  }});
 }
 const reportPath=`reports/${id}.json`;
 const report=(await getFile(reportPath))?.data||{
  id,mode:'live-github-studio',contract:d.contract,chainId:d.chainId,repository:d.repository,pr:claim.pr,
  head:claim.head,base:claim.base,claim:envelope,commentId,commentCreatedAt:createdAt,transactions:{},
  startedAt:new Date().toISOString(),status:'verifying',
 };
 if(!exactOpenReport(candidate,report,d)||!report.transactions||typeof report.transactions!=='object'||
  Array.isArray(report.transactions))throw Error('Report binding mismatch');
 if(terminal.has(report.status)||(report.status==='rejected'&&report.completedAt))throw Error('This exact claim has a terminal outcome');
 async function save(){
  report.updatedAt=new Date().toISOString();
  report.run=`https://github.com/${d.repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  await putFile(reportPath,report);
  const index=(await getFile('index.json'))?.data||{entries:[]};
  if(!Array.isArray(index.entries))throw Error('Malformed evidence index');
  index.mode='live-github-studio';
  index.deployment=Object.fromEntries(['protocolVersion','contract','problem','repository','branch','chainId','windowSeconds'].map(key=>[key,d[key]]));
  index.entries=index.entries.filter(entry=>entry.id!==id||!openIndexScope(entry,d));
  index.entries.unshift({
   id,contract:d.contract,chainId:d.chainId,repository:d.repository,
   pr:claim.pr,head:claim.head,wallet:claim.wallet,policy:problem.policyHash,protocolCommit:claim.protocol_commit,
   evidenceKind:report.attestation?.evidence?.evidence_kind,verification:report.attestation?.evidence?.verification,
   title:report.attestation?.evidence?.submission?.title||`Submission PR #${claim.pr}`,
   status:report.status,reason:report.registrationRejection?.reason,points:report.record?.credited_points||'0',
   awardBudget:report.record?.award_budget,initialPaid:report.record?.initial_paid,
   impactReserve:report.record?.impact_reserve,reserveReturned:report.record?.reserve_returned,reserveSettled:report.record?.reserve_settled,
   impact:report.impact?Object.fromEntries(['downstream','status','budget','band_points','paid_points','returned_points','allocations','reason'].map(key=>[key,report.impact[key]])):null,
   dependencies:report.record?.evidence?.dependencies||[],report:reportPath,run:report.run,updatedAt:report.updatedAt,commentId,
   needsResume:!report.completedAt&&!report.blockedConsensus&&!terminal.has(report.status),
  });
  await putFile('index.json',index);
 }
 const verifierKey=process.env.VERIFIER_SIGNING_KEY,executorKey=process.env.EXECUTOR_SIGNING_KEY;
 if(!verifierKey||!executorKey||createAccount(verifierKey).address.toLowerCase()!==d.verifier.toLowerCase()||
  createAccount(executorKey).address.toLowerCase()!==d.executor.toLowerCase())throw Error('Wrong enrolled operator');
 const verifier=clientFor(verifierKey),executor=clientFor(executorKey);
 const native=(method,args)=>read(executor,d.contract,method,args);
 await requireOpenNative(problem,executor);

 async function tx(stage,client,method,args,recoverOnly=false){
  const result=await journaledTransaction({
   client,address:d.contract,sender:client===verifier?d.verifier:d.executor,method,args,
   independent:['adjudicate','review_impact'].includes(method),recoverOnly,transactions:report.transactions,stage,save,
  });
  return result.hash;
 }
 async function check(name,conclusion,title,summary,externalId){
  const result=await github.request('/check-runs',{method:'POST',body:{
   name,head_sha:claim.head,status:'completed',conclusion,external_id:externalId,
   output:{title,summary:summary.slice(0,60000)},
  }});
  if(result.app?.id!==(name==='open-mathematics/evidence'?d.verifierAppId:d.appId))throw Error('Wrong check publisher');
 }
 async function waitWindow(record){
  const deadline=Number(record.deadline)*1000+1500;
  if(!Number.isSafeInteger(deadline))throw Error('Invalid native deadline');
  while(Date.now()<=deadline)await sleep(Math.min(5000,Math.max(500,deadline-Date.now())));
 }
 let evidenceValidated=false;
 async function recordState({settledImpact}={}){
  const record=requireOpenRecord(await native('get',[id]),report.evidenceJSON,{settledImpact});
  report.record=record;
  report.status=record.status;
  if(settledImpact)report.impact=settledImpact;
  await save();
  return record;
 }
 async function expireIfStale(current){
  const expired=await expireStaleUnmergedClaim({
   pr:current,claim,branchHead:branch=>github.branchHead(branch),
   registered:Object.hasOwn(report.transactions,'register'),expirationStarted:Object.hasOwn(report.transactions,'expire'),
   confirmRegistration:()=>tx('register',verifier,'register',[report.evidenceJSON],true),
   readRecord:recordState,release:reason=>tx('expire',executor,'release_unmerged',[id,reason]),
  });
  if(expired&&expireUnregisteredOpenReport(report))await save();
  return expired;
 }

 async function freshClaim(){
  if(Object.hasOwn(report.transactions,'register')||report.evidenceJSON!==undefined)throw Error('Saved claim lost its verifier attestation');
  if(await expireIfStale(pr)||pr.merged!==false||pr.base.sha!==claim.base)throw Error('PR changed; rebase and sign a new claim');
  return verifierRun(problem,candidate);
 }
 try{
  const attestation=report.attestation||await freshClaim();
  report.evidenceJSON=await openEvidenceJSON({attestation,problem,candidate,authorId:pr.user.id,cached:report.evidenceJSON});
  report.attestation=attestation;
  evidenceValidated=true;
  if(candidate.recoveryOnly){
   if(candidate.abandonOnly){
    if(!invalidateUnregisteredOpenReport(report))throw Error('Registration journal appeared; cleanup requires native reconciliation');
    report.recovery='Original signed comment became unavailable before any saved registration intent. No native transaction was requested.';
    await save();
    await check('open-mathematics/finalized','failure','Unregistered claim invalidated',report.recovery,id);
    return;
   }
   // Recovery is deliberately narrower than processing an intact author comment.
   // The saved journal is only a hint; a fresh exact successful native receipt
   // and evidence-bound native record are required before releasing a slot.
   await recoverStaleOpenRegistration({github,candidate,deployment:d,authorId:attestation.evidence.github_author_id,
    confirmRegistration:()=>tx('register',verifier,'register',[report.evidenceJSON],true),
    readRecord:recordState,expire:expireIfStale});
   report.completedAt=new Date().toISOString();
   report.recovery='Expired stale unmerged work from its exact saved signed evidence after the original comment became unavailable.';
   delete report.error;delete report.blockedConsensus;
   await save();
   await check('open-mathematics/finalized','failure','Stale contribution expired',report.recovery,report.transactions.expire?.hash||id);
   return;
  }
  const currentPR=await github.pr(claim.pr);
  if(await expireIfStale(currentPR)||(currentPR.merged===true&&(currentPR.head.sha!==claim.head||currentPR.base.ref!==d.branch)))
   throw Error('PR changed; rebase and sign a new claim');
  await save();
  const summary=attestation.evidence.evidence_kind==='formal'?'Pinned Lean proof and signed submission verified':'Signed research note checked for format. No formal verification.';
  await check('open-mathematics/evidence','success',summary,JSON.stringify(attestation.evidence,null,2),digest(attestation.evidence));
  if(!Object.hasOwn(report.transactions,'register')){
   await bindOpenRegistration({github,report,candidate,problem,expire:expireIfStale,save});
  }
  await tx('register',verifier,'register',[report.evidenceJSON]);
  let record=await recordState();
  if(await adjudicateOpenRecord({id,record,tx:(stage,method,args)=>tx(stage,executor,method,args)})){
   record=await recordState();
  }
  if(record.status==='provisional'){
   await tx(`adjudicate-r${record.round}`,executor,'adjudicate',[id,Number(record.round)],true);
   await waitWindow(record);
   record=await recordState();
   if(record.status==='challenged')throw Error('Challenge blocks merge. Resume this signed comment for another review.');
   if(record.status==='provisional'){
    const current=await github.pr(claim.pr);
    if(await expireIfStale(current))throw Error('Stale PR expired without locking the statement');
    if(current.merged===true)throw Error('PR merged before this claim was approved');
    await tx(`finalize-r${record.round}`,executor,'finalize',[id,Number(record.round)]);
    record=await recordState();
   }
  }
  if(['approved','credited','rejected'].includes(record.status)){
   await tx(`adjudicate-r${record.round}`,executor,'adjudicate',[id,Number(record.round)],true);
   await tx(`finalize-r${record.round}`,executor,'finalize',[id,Number(record.round)],true);
  }
  const finalized=report.transactions[`finalize-r${record.round}`];
  if(record.status==='rejected'){
   await check('open-mathematics/finalized','failure','GenLayer rejected contribution',record.verdict.reason,finalized.hash);
  }else if(['approved','credited'].includes(record.status)){
   const adjudicated=report.transactions[`adjudicate-r${record.round}`];
   const registry=new Map([[id,{
    mode:'live',evidenceJSON:report.evidenceJSON,evidenceDigest:digest(report.evidenceJSON),
    adjudicationTx:adjudicated.hash,finalizeTx:finalized.hash,round:record.round,
   }]]);
   const chain=new StudioAuthority({client:executor,contract:d.contract,chainId:d.chainId,
    policy:problem.policyHash,registry,github,appId:d.appId,verifierAppId:d.verifierAppId,branch:d.branch});
   chain.confirmMerge=async(_,head,merge)=>tx('merge',executor,'confirm_merge',[id,head,merge],record.status==='credited');
   report.outcome=await executeDecision({id,chain,github,evidenceCheck:'open-mathematics/evidence',journal:{record:async(_,sha)=>{report.mergeCommit=sha;await save();}}});
   record=await recordState();
   let impact=await native('get_impact',[id]);
   if(['not-requested','challenged'].includes(impact.status)){
    const round=Number(impact.round||0);
    await tx(`impact-r${round}`,executor,'review_impact',[id,round]);
    impact=await native('get_impact',[id]);
   }
   report.impact=impact;
   await save();
   if(impact.status==='provisional'){
    await tx(`impact-r${impact.round}`,executor,'review_impact',[id,Number(impact.round)],true);
    await waitWindow(impact);
    impact=await native('get_impact',[id]);
    if(impact.status==='challenged')throw Error('Impact challenge paused reserve settlement. Credit issued at merge remains settled.');
    if(impact.status==='provisional')await tx(`settle-impact-r${impact.round}`,executor,'settle_impact',[id,Number(impact.round)]);
   }
   const settledImpact=await native('get_impact',[id]);
   if(settledImpact.status!=='settled')throw Error('Native reserve settlement is still pending');
   const round=Number(settledImpact.round);
   if(!Array.isArray(settledImpact.eligible))throw Error('Settled impact eligibility is missing');
   await tx(`impact-r${round}`,executor,'review_impact',[id,round],true);
   if(settledImpact.eligible.length)await tx(`settle-impact-r${round}`,executor,'settle_impact',[id,round],true);
   // Reserve settlement can increase the downstream author's net credit.
   record=await recordState({settledImpact});
  }else{
   throw Error('Contribution awaits a resolved contract decision');
  }
  report.points=await native('get_points',[claim.wallet]);
  report.completedAt=new Date().toISOString();
  delete report.error;
  delete report.blockedConsensus;
  await save();
  console.log('Contribution outcome:',report.status,report.record.credited_points,'Upstream reserve allocation:',report.impact?.paid_points||'0');
 }catch(error){
  let failure=safeError(error);
  if(!candidate.recoveryOnly&&evidenceValidated&&report.record&&['submitted','provisional','challenged','approved'].includes(report.record.status)){
   try{await expireIfStale(await github.pr(claim.pr));}
   catch(recovery){failure+='\nStale-claim recovery: '+safeError(recovery);}
  }
  const {status,registrationRejection}=openClaimFailureOutcome(report,error);
  report.status=status;
  if(registrationRejection){
   report.registrationRejection=registrationRejection;
   report.completedAt=new Date().toISOString();
   delete report.blockedConsensus;
  }else{
   report.blockedConsensus=blockedOpenConsensus(error,failure);
  }
  report.error=failure;
  await save();
  if(registrationRejection)await check('open-mathematics/finalized','failure','GenLayer registration rejected',registrationRejection.reason,registrationRejection.hash);
  else if(report.status!=='credited')await check(report.attestation?'open-mathematics/finalized':'open-mathematics/evidence','failure','Contribution processing stopped',report.error,id);
  throw Error(failure);
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(error=>{console.error(safeError(error));process.exitCode=1;});
}
