// Permissionless derived accounting. Runs only reviewed code, never PR checkout code.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createAccount} from 'genlayer-js';
import {loadOpenProblem,readProblemFile,parseProblemJSON,sha256} from '../src/open-research.mjs';
import {openMigrationHash} from '../src/open-snapshot.mjs';
import {validateGitHubAccountsDeployment,validateGitHubAccountsConfig} from '../src/github-accounts.mjs';
import {GitHub} from '../src/github.mjs';
import {readEvidenceFile} from './evidence-file.mjs';
import {requireOpenNative} from './open-verify.mjs';
import {clientFor,read,clean,saveJSON} from './runtime.mjs';
import {journaledTransaction} from './journaled-transaction.mjs';
import {withStudioBatchPacing} from './batch-studio-client.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const BATCH=12;
export function accountSyncOffsets(total,cursor=0){
 if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(cursor)||cursor<0)throw Error('Invalid account scan bounds');
 if(total===0)return {offsets:[],next:0};
 const start=cursor<total?cursor:0,end=Math.min(total,start+BATCH);
 return {offsets:[...new Set([...Array.from({length:end-start},(_,i)=>start+i),...Array.from({length:Math.min(total,BATCH)},(_,i)=>Math.max(0,total-BATCH)+i)])],next:end===total?0:end};
}
export function accountSyncHash(record,impact){return openMigrationHash({record,impact});}
export function accountNameOrder(authors,cursor=0){
 const ids=[...new Set(authors)].sort();
 if(ids.some(id=>typeof id!=='string'||!(/^[1-9][0-9]{0,77}$/).test(id))||!Number.isSafeInteger(cursor)||cursor<0)throw Error('Invalid name scan bounds');
 const start=ids.length?cursor%ids.length:0;
 return {ids:[...ids.slice(start),...ids.slice(0,start)],start};
}

export async function syncAccounts({problem,deployment,client,load,save,now=()=>Date.now()}){
 client=withStudioBatchPacing(client);
 validateGitHubAccountsDeployment(deployment,problem);await requireOpenNative(problem,client);
 const native=(method,args=[])=>read(client,deployment.contract,method,args);
 const source=(method,args=[])=>read(client,deployment.sourceContract,method,args);
 validateGitHubAccountsConfig(await native('get_config'),deployment);
 const sender=typeof client.account==='string'?client.account:client.account?.address;
 if(!sender)throw Error('Dedicated sync signer required');
 const prefix='reports/github-accounts-'+deployment.contract.slice(2).toLowerCase(),cursorFile=prefix+'-cursor.json';
 const prior=(await load(cursorFile))?.data;
 if(prior&&(prior.contract!==deployment.contract||!Number.isSafeInteger(prior.cursor)||prior.cursor<0||!Number.isSafeInteger(prior.nameCursor??0)||(prior.nameCursor??0)<0))throw Error('Invalid account scan cursor');
 const total=Number(await source('count_contributions')),{offsets,next}=accountSyncOffsets(total,prior?.cursor||0);
 const authors=new Set(),results=[];
 async function tx(method,args){
  const intent={contract:deployment.contract,sender:sender.toLowerCase(),method,args};
  const file=prefix+'-'+openMigrationHash(intent)+'.json';
  const report=(await load(file))?.data||{version:1,intent,transactions:{}};
  if(report.version!==1||openMigrationHash(report.intent)!==openMigrationHash(intent)||!report.transactions||Array.isArray(report.transactions))throw Error('Account update journal binding mismatch');
  const persist=()=>save(file,{...report,updatedAt:new Date(now()).toISOString()});
  const result=await journaledTransaction({client,address:deployment.contract,sender,method,args,independent:method==='refresh_username',transactions:report.transactions,stage:'apply',save:persist});
  results.push({method,args,hash:result.hash});
 }
 for(const offset of offsets){
  const page=await source('list_contributions',[offset,1]);
  if(Number(page.total)!==total||page.items?.length!==1||typeof page.items[0]!=='string')throw Error('Source registry changed during bounded scan');
  const id=page.items[0],record=await source('get',[id]),impact=await source('get_impact',[id]);
  if(record.evidence?.id!==id)throw Error('Wrong source record');
  const hash=accountSyncHash(record,impact),indexed=await native('get_record',[id]);
  if(indexed.source_hash!==hash){
   await tx('sync_contribution',[id,hash]);
   const confirmed=await native('get_record',[id]);
   if(confirmed.source_hash!==hash)throw Error('Account copy not confirmed in finalized state');
  }
  authors.add(String(record.evidence.github_author_id));
 }
 // Fresh federation deployments declare their capability in a reviewed file.
 // Older pinned deployments never receive calls to methods they do not expose.
 if(fs.existsSync(path.join(problem.root,'.open-math/federation.json'))){
  const marker=parseProblemJSON(readProblemFile(problem.root,'.open-math/federation.json'));
  if(marker.version!==1||marker.sourceContract!==problem.deployment.contract||marker.sourceCodeHash!==problem.deployment.codeHash)throw Error('Federation capability pin mismatch');
  const page=await source('list_external_authors',[0,64]);
  if(!Array.isArray(page.items)||page.items.length>64)throw Error('Bounded external author page required');
  for(const subject of page.items){
   const external=await source('get_external_author',[subject]);
   if(external.subject!==subject)throw Error('Wrong external author');
   await tx('sync_external_author',[subject,openMigrationHash(external)]);
   authors.add(String(external.github_author_id));
  }
 }
 // A missing public name never prevents point reconciliation. Separate calls
 // retain terminal failures so an undetermined observation is not silently rerolled.
 const nameErrors=[];let refreshes=0,visited=0;
 const nameOrder=accountNameOrder(authors,prior?.nameCursor||0);
 for(const id of nameOrder.ids){
  if(refreshes>=4)break;visited++;
  const account=await native('get_account',[id]),checked=String(account.username_checked_at);
  if(!/^(0|[1-9][0-9]*)$/.test(checked))throw Error('Invalid native name observation time');
  if(Number(checked)*1000+86400000>now())continue;
  refreshes++;
  try{await tx('refresh_username',[id,checked]);}
  catch(error){nameErrors.push({github_author_id:id,error:String(error.message).slice(0,250)});}
 }
 const state=await native('get_state');
 await save(cursorFile,{version:1,contract:deployment.contract,cursor:next,nameCursor:nameOrder.ids.length?(nameOrder.start+visited)%nameOrder.ids.length:0,observedCount:total,updatedAt:new Date(now()).toISOString()});
 return {contract:deployment.contract,scanned:offsets.length,transactions:results,state,nameErrors};
}

export async function run(argv=process.argv.slice(2)){
 const [directory,localJournalDir,...rest]=argv;
 if(!directory||rest.length)throw Error('Usage: sync-accounts.mjs TRUSTED_PROBLEM [LOCAL_JOURNAL_DIRECTORY]');
 const problem=loadOpenProblem(directory),deployment=parseProblemJSON(readProblemFile(problem.root,'.open-math/github-accounts.json'));
 validateGitHubAccountsDeployment(deployment,problem);
 if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==deployment.implementationCommit||sha256(fs.readFileSync(path.join(root,'contracts/github_accounts.py')))!==deployment.codeHash)throw Error('Wrong pinned account implementation');
 execFileSync('git',['diff','--quiet','HEAD','--'],{cwd:root,stdio:'pipe'});
 if(execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim())throw Error('Untracked account implementation files');
 const key=process.env.EXECUTOR_SIGNING_KEY;if(!key||createAccount(key).address.toLowerCase()!==problem.deployment.executor.toLowerCase())throw Error('Wrong dedicated sync signer');
 const client=clientFor(key);let load,save;
 if(localJournalDir){
  fs.mkdirSync(localJournalDir,{recursive:true,mode:0o700});
  load=async file=>{const target=path.join(localJournalDir,file);return fs.existsSync(target)?{data:JSON.parse(fs.readFileSync(target,'utf8'))}:null;};
  save=async(file,data)=>{const target=path.join(localJournalDir,file);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});saveJSON(target,data);};
 }else{
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!==deployment.repository)throw Error('Reviewed main-only repository workflow required');
  const github=new GitHub({repository:deployment.repository,token:process.env.GITHUB_TOKEN});
  load=file=>readEvidenceFile(github,file);
  save=async(file,data)=>{const old=await load(file);await github.request('/contents/'+file,{method:'PUT',body:{branch:'evidence',message:'Record native GitHub account update',content:Buffer.from(JSON.stringify(clean(data),null,2)+'\n').toString('base64'),...(old?{sha:old.sha}:{})}});};
 }
 console.log(JSON.stringify(clean(await syncAccounts({problem,deployment,client,load,save})),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(error=>{
 const secrets=[process.env.EXECUTOR_SIGNING_KEY,process.env.GITHUB_TOKEN].filter(Boolean);
 console.error(secrets.reduce((text,key)=>text.split(key).join('[redacted]'),String(error.message)));process.exitCode=1;
});
