// One-time native release trial for a migrated accepted proof. The Actions worker
// handles ordinary submissions; this script never submits or merges a new PR.
import fs from 'node:fs';import {createAccount} from 'genlayer-js';
import {GitHub} from '../src/github.mjs';import {digest} from '../src/security.mjs';
import {clientFor,read,saveJSON,sleep} from '../github/runtime.mjs';
import {journaledTransaction} from '../github/journaled-transaction.mjs';
const d=JSON.parse(fs.readFileSync('public/deployment.json')),id=process.argv[2];
if(d.protocolVersion!==3||d.codeHash!==digest(fs.readFileSync('contracts/research.py')))throw Error('Exact v3 source and deployment required');
const frozen=JSON.parse(fs.readFileSync('public/ledger-snapshot.json')),expected=frozen.records.find(x=>x.id===id);
if(!expected)throw Error('This release trial only reconciles an exact migrated accepted contribution');
const key=fs.readFileSync(`${process.env.OPERATOR_KEY_DIR}/executor.key`,'utf8').trim(),sender=createAccount(key).address;
if(sender.toLowerCase()!==d.executor.toLowerCase())throw Error('Enrolled executor required');
const client=clientFor(key),gh=new GitHub({repository:d.repository,token:process.env.GITHUB_TOKEN});
const record=await read(client,d.contract,'get',[id]);
if(record.status!=='credited'||record.digest!==expected.record.digest||record.merge_commit!==expected.record.merge_commit||record.ledger_migration?.snapshot_hash!==digest(fs.readFileSync('public/ledger-snapshot.json')))throw Error('Exact migrated record required');
const pr=await gh.pr(Number(record.evidence.pr)),merge=await gh.commit(record.merge_commit);
if(!pr.merged||pr.head.sha!==record.evidence.head||pr.merge_commit_sha!==record.merge_commit||merge.parents.length!==2||merge.parents[0].sha!==record.evidence.base||merge.parents[1].sha!==record.evidence.head||!await gh.canonicalMerge(d.branch,record.merge_commit))throw Error('Canonical historical merge required');
const file='public/v3-impact-evidence.json',report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{mode:'native-release-trial',execution:'Local enrolled operator; actual Studio consensus and finalized points. Historical PR was already merged through GitHub Actions.',id,contract:d.contract,codeHash:d.codeHash,sourceDigest:record.digest,transactions:{},startedAt:new Date().toISOString(),previousAttempt:{contract:frozen.source_contract,hash:'0x1130e4c70a6114051e99df17bba3810d41fe595d5a2f693f29885bd549b2d94d',outcome:'v2 consensus failed; zero later points. Preserved, never rerolled on the v2 protocol.'}};
if(report.contract!==d.contract||report.id!==id||report.sourceDigest!==record.digest)throw Error('Trial journal identity mismatch');
const save=async()=>{report.updatedAt=new Date().toISOString();saveJSON(file,report);};
const tx=(stage,method,args,independent=false,recoverOnly=false)=>journaledTransaction({client,address:d.contract,sender,method,args,independent,recoverOnly,transactions:report.transactions,stage,save});
try{
 let impact=await read(client,d.contract,'get_impact',[id]);
 if(['not-requested','challenged'].includes(impact.status)){
  const round=Number(impact.round||0);await tx(`review-r${round}`,'review_impact',[id,round],true);impact=await read(client,d.contract,'get_impact',[id]);
 }
 report.impact=impact;await save();
 if(impact.status==='provisional'){
  await tx(`review-r${impact.round}`,'review_impact',[id,Number(impact.round)],true,true);
  while(Date.now()<Number(impact.deadline)*1000+1500)await sleep(Math.min(5000,Number(impact.deadline)*1000+1500-Date.now()));
  impact=await read(client,d.contract,'get_impact',[id]);if(impact.status!=='provisional')throw Error('Impact changed during its challenge window; resume the exact new native round');
  await tx(`settle-r${impact.round}`,'settle_impact',[id,Number(impact.round)]);impact=await read(client,d.contract,'get_impact',[id]);
 }
 if(impact.status==='settled'){
  await tx(`review-r${impact.round}`,'review_impact',[id,Number(impact.round)],true,true);
  if(impact.eligible.length)await tx(`settle-r${impact.round}`,'settle_impact',[id,Number(impact.round)],false,true);
 }
 report.impact=impact;report.balances=[];
 for(const b of frozen.balances)report.balances.push({wallet:b.wallet,...await read(client,d.contract,'get_points',[b.wallet])});
 if(impact.status==='settled')report.completedAt=new Date().toISOString();delete report.error;await save();console.log('Native later impact:',impact.status,impact.paid_points||'0');
}catch(e){report.error=String(e.message).split(key).join('[redacted]');await save();throw Error(report.error);}
