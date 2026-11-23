// Reconcile an already merged contribution, including a reviewed replacement ledger.
// This is separate from proof submission so an accepted proof is never replayed for points.
import fs from 'node:fs';
import {createAccount} from 'genlayer-js';
import {GitHub} from '../src/github.mjs';
import {digest} from '../src/security.mjs';
import {verifyReceipt} from '../src/studio.mjs';
import {clientFor,read,clean,sleep} from './runtime.mjs';
import {journaledTransaction} from './journaled-transaction.mjs';
const d=JSON.parse(fs.readFileSync('public/deployment.json'));
if(d.protocolVersion!==3||d.codeHash!==digest(fs.readFileSync('contracts/research.py'))||d.policy!==digest(fs.readFileSync('lean/policy.json')))throw Error('Exact reviewed v3 deployment required');
if(process.env.GITHUB_REF!=='refs/heads/protocol'||process.env.GITHUB_REPOSITORY!==d.repository)throw Error('Trusted protocol branch required');
const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH)),id=event.inputs?.contribution_id;
if(typeof id!=='string'||!/^pr-[1-9]\d*-[a-f0-9]{12}-[a-f0-9]{12}$/.test(id))throw Error('Explicit accepted contribution ID required');
const sender=createAccount(process.env.EXECUTOR_SIGNING_KEY).address;
if(sender.toLowerCase()!==d.executor.toLowerCase())throw Error('Enrolled executor required');
const c=clientFor(process.env.EXECUTOR_SIGNING_KEY),gh=new GitHub({repository:d.repository,token:process.env.GITHUB_TOKEN});
const record=await read(c,d.contract,'get',[id]);
if(record.status!=='credited'||record.evidence.repository!==d.repository)throw Error('Settled enrolled contribution required');
const pr=await gh.pr(Number(record.evidence.pr)),commit=await gh.commit(record.merge_commit);
if(!pr.merged||pr.head.sha!==record.evidence.head||pr.merge_commit_sha!==record.merge_commit||!await gh.canonicalMerge(d.branch,record.merge_commit)||commit.parents.length!==2||commit.parents[0].sha!==record.evidence.base||commit.parents[1].sha!==record.evidence.head)throw Error('Exact canonical historical merge required');
const reportPath=`impacts/${d.contract}/${id}.json`;
async function getFile(path){try{const r=await gh.request(`/contents/${path}?ref=evidence`);return {sha:r.sha,data:JSON.parse(Buffer.from(r.content,'base64'))};}catch(e){if(e.message==='GitHub 404')return null;throw e;}}
const saved=(await getFile(reportPath))?.data;
const report=saved||{id,contract:d.contract,chainId:d.chainId,sourceDigest:record.digest,transactions:{},startedAt:new Date().toISOString()};
if(report.id!==id||report.contract!==d.contract||report.chainId!==d.chainId||report.sourceDigest!==record.digest)throw Error('Impact journal identity mismatch');
async function save(){report.updatedAt=new Date().toISOString();report.run=`https://github.com/${d.repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;const old=await getFile(reportPath);await gh.request(`/contents/${reportPath}`,{method:'PUT',body:{branch:'evidence',message:'Record native later-impact outcome',content:Buffer.from(JSON.stringify(clean(report),null,2)+'\n').toString('base64'),...(old?{sha:old.sha}:{})}});}
async function tx(stage,method,args,independent=false,recoverOnly=false){return journaledTransaction({client:c,address:d.contract,sender,method,args,independent,recoverOnly,transactions:report.transactions,stage,save});}
try{
 let impact=await read(c,d.contract,'get_impact',[id]);
 const round=Number(impact.round||0);
 if(['not-requested','challenged'].includes(impact.status)){
  await tx(`review-r${round}`,'review_impact',[id,round],true);
  impact=await read(c,d.contract,'get_impact',[id]);
 }
 report.impact=impact;await save();
 if(impact.status==='provisional'){
  const review=await tx(`review-r${impact.round}`,'review_impact',[id,Number(impact.round)],true,true);
  verifyReceipt(review.receipt,{hash:review.hash,address:d.contract,method:'review_impact',args:[id,Number(impact.round)],independent:true});
  while(Date.now()<Number(impact.deadline)*1000+1500)await sleep(Math.min(5000,Number(impact.deadline)*1000+1500-Date.now()));
  impact=await read(c,d.contract,'get_impact',[id]);
  if(impact.status==='challenged')throw Error('Impact challenged; a fresh round is required before settlement');
  if(impact.status==='provisional')await tx(`settle-r${impact.round}`,'settle_impact',[id,Number(impact.round)]);
 }
 report.impact=await read(c,d.contract,'get_impact',[id]);
 report.walletBalances=[];
 for(const wallet of [...new Set([record.evidence.wallet,...(report.impact.eligible||[]).map(x=>x.wallet)])])report.walletBalances.push({wallet,...await read(c,d.contract,'get_points',[wallet])});
 if(report.impact.status==='settled'){
  const round=Number(report.impact.round);if(!Array.isArray(report.impact.eligible))throw Error('Settled impact eligibility is missing');
  await tx(`review-r${round}`,'review_impact',[id,round],true,true);
  if(report.impact.eligible.length)await tx(`settle-r${round}`,'settle_impact',[id,round],false,true);
  report.completedAt=new Date().toISOString();
 }
 delete report.error;delete report.blockedConsensus;await save();console.log('Later impact:',id,report.impact.status,report.impact.paid_points||'0');
}catch(error){report.error=[process.env.GITHUB_TOKEN,process.env.EXECUTOR_SIGNING_KEY].filter(Boolean).reduce((s,k)=>s.split(k).join('[redacted]'),String(error.message));report.blockedConsensus=/UNDETERMINED|CANCELED|LEADER_TIMEOUT|Finalized execution failed|failed receipt verification|corrected attribution|attribution changed/.test(report.error);await save();throw Error(report.error);}
