// All executable code is checked out from trusted main. PR data is never executed.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';
import {createAccount} from 'genlayer-js';import {recoverMessageAddress} from 'viem';
import {GitHub,executeDecision} from '../src/github.mjs';
import {StudioAuthority} from '../src/studio.mjs';
import {digest,canonical,message,validateClaim,verifyAttestation} from '../src/security.mjs';
import {clientFor,finalized,read,clean,sleep} from './runtime.mjs';
const deployment=JSON.parse(fs.readFileSync('public/deployment.json','utf8'));
const gh=new GitHub({repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN});
if(gh.repository!==deployment.repository||digest(fs.readFileSync('lean/policy.json','utf8'))!==deployment.policy)throw Error('Unenrolled repository or policy');
const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
const commentId=event.comment?.id||Number(event.inputs?.comment_id);
if(!Number.isSafeInteger(commentId))throw Error('Signed claim comment ID required');
const comment=await gh.request(`/issues/comments/${commentId}`);
if(comment.created_at!==comment.updated_at||comment.body.length>20000)throw Error('Fresh unedited signed comment required');
const match=comment.body.match(/^Open-Mathematics-Claim: ([a-f0-9]{64})\n```json\n([\s\S]+)\n```\s*$/);
if(!match)throw Error('Use the exact signed claim comment format');
const envelope=JSON.parse(match[2]);const {claim,signature}=envelope;
if(digest(claim)!==match[1])throw Error('Claim digest mismatch');
validateClaim(claim,{domain:deployment.origin,chainId:deployment.chainId,now:Date.parse(comment.created_at)});
if((await recoverMessageAddress({message:message(claim),signature})).toLowerCase()!==claim.wallet.toLowerCase())throw Error('Invalid signature');
if(claim.repository!==gh.repository||comment.issue_url!==`https://api.github.com/repos/${gh.repository}/issues/${claim.pr}`)throw Error('Claim repository/PR mismatch');
const pr=await gh.pr(claim.pr);
if(comment.user.id!==pr.user.id||pr.base.ref!=='main'||pr.head.sha!==claim.head)throw Error('PR author and immutable commit binding required');
const meta=claim.contribution;
if(!meta||typeof meta.claim!=='string'||meta.claim.length<20||meta.claim.length>4000||typeof meta.context!=='string'||meta.context.length>4000||!['lemma','counterexample','infrastructure'].includes(meta.kind)||!Array.isArray(meta.dependencies)||meta.dependencies.length>8)throw Error('Signed research metadata required');
const id=`pr-${claim.pr}-${claim.head.slice(0,12)}-${digest(claim).slice(0,12)}`;
async function getFile(path){try{const r=await gh.request(`/contents/${path}?ref=evidence`);return {sha:r.sha,data:JSON.parse(Buffer.from(r.content,'base64'))};}catch(e){if(e.message==='GitHub 404')return null;throw e;}}
async function putFile(path,data){const old=await getFile(path);return gh.request(`/contents/${path}`,{method:'PUT',body:{message:`Record ${id} research evidence`,branch:'evidence',content:Buffer.from(JSON.stringify(clean(data),null,2)+'\n').toString('base64'),...(old?{sha:old.sha}:{})}});}
const reportPath=`reports/${id}.json`;
let report=(await getFile(reportPath))?.data||{id,mode:'live-github-studio',contract:deployment.contract,chainId:deployment.chainId,repository:gh.repository,pr:claim.pr,head:claim.head,base:pr.base.sha,claim:envelope,commentId,transactions:{},startedAt:new Date().toISOString(),status:'verifying'};
async function save(){report.updatedAt=new Date().toISOString();report.run=`https://github.com/${gh.repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;await putFile(reportPath,report);const index=(await getFile('index.json'))?.data||{mode:'live-github-studio',deployment,entries:[]};index.entries=index.entries.filter(e=>e.id!==id);index.entries.unshift({id,pr:claim.pr,head:claim.head,wallet:claim.wallet,title:meta.claim.slice(0,150),status:report.status,points:report.record?.credited_points||'0',report:reportPath,run:report.run,updatedAt:report.updatedAt});await putFile('index.json',index);}
const verifier=clientFor(process.env.VERIFIER_SIGNING_KEY),executor=clientFor(process.env.EXECUTOR_SIGNING_KEY);
if(createAccount(process.env.VERIFIER_SIGNING_KEY).address.toLowerCase()!==deployment.verifier.toLowerCase()||createAccount(process.env.EXECUTOR_SIGNING_KEY).address.toLowerCase()!==deployment.executor.toLowerCase())throw Error('Wrong enrolled operator');
async function tx(stage,client,method,args){
 if(!report.transactions[stage]){const hash=await client.writeContract({address:deployment.contract,functionName:method,args,leaderOnly:false});report.transactions[stage]={hash};await save();}
 const t=report.transactions[stage];if(!t.receipt){t.receipt=await finalized(client,t.hash,{address:deployment.contract,method,id,args,independent:method==='adjudicate'});await save();}return t.hash;
}
async function check(name,conclusion,title,summary,externalId){return gh.request('/check-runs',{method:'POST',body:{name,head_sha:claim.head,status:'completed',conclusion,external_id:externalId,output:{title,summary:summary.slice(0,60000)}}});}
try{
 if(!report.attestation){
  if(pr.state!=='open'||pr.base.sha!==report.base)throw Error('PR changed; sign a new claim');
  fs.writeFileSync('/tmp/open-math-claim.json',JSON.stringify(envelope));
  const run=spawnSync(process.execPath,['github/verify-pr.mjs','/tmp/open-math-claim.json'],{encoding:'utf8',timeout:90000,maxBuffer:100000,env:{...process.env,APP_ORIGIN:deployment.origin,CHAIN_ID:String(deployment.chainId),CLAIM_AT:String(Date.parse(comment.created_at))}});
  if(run.status!==0)throw Error('Proof verifier rejected: '+run.stderr.slice(-3000));
  report.attestation=JSON.parse(run.stdout);
  const proofPolicy=JSON.parse(fs.readFileSync('lean/policy.json','utf8'));
  await verifyAttestation(report.attestation,{repository:gh.repository,head:claim.head,base:report.base,policy:deployment.policy,statement_hash:proofPolicy.files['Trusted.lean'],checker:'open-mathematics-v1',toolchain:proofPolicy.toolchain,allowedAxioms:proofPolicy.allowed_axioms,theorem:proofPolicy.theorem},deployment.verifier);
  report.status='verified';await save();
 }
 const leanCheck=await check('open-mathematics/lean','success','Pinned Lean evidence verified',JSON.stringify(report.attestation.evidence,null,2),digest(report.attestation.evidence));
 if(leanCheck.app.id!==deployment.verifierAppId)throw Error('Wrong check publisher');
 if(!report.evidenceJSON){const e=report.attestation.evidence;report.evidenceJSON=JSON.stringify({id,problem:'p-vs-np',policy:deployment.policy,repository:gh.repository,pr:claim.pr,head:claim.head,base:report.base,wallet:claim.wallet,claim_digest:digest(claim),statement_hash:e.statement_hash,artifact_hash:e.artifact_hash,verification:'verified',claim:meta.claim,kind:meta.kind,dependencies:meta.dependencies,context:meta.context+'\nTrusted pilot context: known CNF renaming theorem, not new mathematical discovery; no complete P/NP formalization. This workflow admits only a proof of the pinned RenamingSound theorem. Evaluate what is actually proved, not unsupported claims of solving P vs NP.'});await save();}
 await tx('register',verifier,'register',[report.evidenceJSON]);
 await tx('adjudicate',executor,'adjudicate',[id]);
 let record=await read(executor,deployment.contract,'get',[id]);report.record=record;report.status=record.status;await save();
 if(record.status==='challenged')throw Error('Challenge blocks execution; review required');
 if(record.status==='provisional'){
  while(Date.now()<=Number(record.deadline)*1000+1500){await sleep(Math.min(5000,Math.max(500,Number(record.deadline)*1000+1500-Date.now())));}
  await tx('finalize',executor,'finalize',[id]);
 }
 record=await read(executor,deployment.contract,'get',[id]);report.record=record;report.status=record.status;await save();
 const registry=new Map([[id,{mode:'live',evidenceJSON:report.evidenceJSON,evidenceDigest:digest(report.evidenceJSON),adjudicationTx:report.transactions.adjudicate.hash,finalizeTx:report.transactions.finalize.hash,round:record.round}]]);
 const chain=new StudioAuthority({client:executor,contract:deployment.contract,chainId:deployment.chainId,policy:deployment.policy,registry,github:gh,appId:deployment.appId,verifierAppId:deployment.verifierAppId});
 chain.confirmMerge=async(id,head,merge)=>tx('merge',executor,'confirm_merge',[id,head,merge]);
 if(record.status==='rejected')await check('open-mathematics/finalized','failure','GenLayer rejected contribution',record.verdict.reason,report.transactions.finalize.hash);
 else{const outcome=await executeDecision({id,chain,github:gh,journal:{record:async(_,sha)=>{report.mergeCommit=sha;await save();}}});report.outcome=outcome;}
 report.record=await read(executor,deployment.contract,'get',[id]);report.points=await read(executor,deployment.contract,'get_points',[claim.wallet]);report.status=report.record.status;report.completedAt=new Date().toISOString();delete report.error;await save();console.log('Contribution outcome:',report.status,report.record.credited_points);
}catch(e){report.error=e.message;report.status=report.record?.status||'invalid';await save();await check(report.attestation?'open-mathematics/finalized':'open-mathematics/lean','failure','Contribution processing stopped',e.message,id);throw e;}
