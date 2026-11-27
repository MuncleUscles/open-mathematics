// Browser-safe, read-only views of the companion account ledger. Usernames are
// accepted only from that pinned contract, never from an HTTP profile fallback.
import {normalizeOpenRead,openMigrationHash,validateSnapshotConfig} from './open-snapshot.mjs';

export const GITHUB_ACCOUNTS_LIMIT=64;
export const GITHUB_ACCOUNTS_READ_LIMIT=69;
export const GITHUB_ACCOUNTS_BYTE_LIMIT=512*1024;
const need=(ok,message)=>{if(!ok)throw Error('GitHub account ledger: '+message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const commit=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const address=value=>typeof value==='string'&&/^0x[a-fA-F0-9]{40}$/.test(value)&&!/^0x0{40}$/i.test(value);
const sameAddress=(a,b)=>address(a)&&address(b)&&a.toLowerCase()===b.toLowerCase();
const same=(a,b)=>a!==undefined&&b!==undefined&&openMigrationHash(a)===openMigrationHash(b);
const integer=value=>typeof value==='number'?Number.isSafeInteger(value)&&value>=0:
 typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value);
const safe=value=>integer(value)&&Number.isSafeInteger(Number(value));
const accountId=value=>typeof value==='string'&&/^[1-9][0-9]{0,77}$/.test(value)&&BigInt(value)<2n**256n;
const amount=value=>typeof value==='string'&&integer(value)&&BigInt(value)<2n**256n;
const login=value=>typeof value==='string'&&/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(value);
const deploymentKeys=['version','chainId','contract','codeHash','sourceContract','sourceCodeHash','sourceConfigHash','problem','repository','policyHash','implementationCommit'];
const configKeys=['version','source_contract','source_config_hash','problem','repository','policy'];
const pointKeys=['author_points','impact_points','returned_points','note_points','points'];
const sourcePointKeys=[...pointKeys,'reserved_points','award_budgets'];
const sourceFields={author_points:'total_initial_points',impact_points:'total_impact_points',returned_points:'total_returned_points',
 note_points:'total_note_points',points:'total_awarded',reserved_points:'total_reserved_points',award_budgets:'total_award_budgets'};
const accountKeys=['github_author_id','login','username_checked_at','contribution_count','credited_count','formal_count','wallet_count',...pointKeys];
const stateKeys=[...configKeys,'indexed_count','source_count','account_count','source_consistent','indexed_totals','source_totals','complete'];
const identity=value=>({...value,contract:value.contract.toLowerCase(),sourceContract:value.sourceContract.toLowerCase()});

function deploymentShape(value){
 need(exact(value,deploymentKeys)&&value.version===1&&value.chainId===61999,'exact version-one Studio deployment required');
 need(address(value.contract)&&address(value.sourceContract)&&!sameAddress(value.contract,value.sourceContract),'distinct companion and source contracts required');
 need(['codeHash','sourceCodeHash','sourceConfigHash','policyHash'].every(key=>hash(value[key]))&&commit(value.implementationCommit),'exact code, configuration and implementation pins required');
 need(value.problem==='p-vs-np'&&typeof value.repository==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository),'invalid problem scope');
 return value;
}

export function validateGitHubAccountsDeployment(value,problem){
 deploymentShape(value);
 need(object(problem)&&object(problem.deployment)&&object(problem.policy),'reviewed research configuration required');
 const d=problem.deployment;
 need(sameAddress(value.sourceContract,d.contract)&&value.sourceCodeHash===d.codeHash&&value.chainId===d.chainId&&
  value.problem===d.problem&&value.repository===d.repository&&value.policyHash===problem.policyHash,'source deployment mismatch');
 // This is the same constructor data used by the pinned research tools. Keep
 // its actual address casing: the native source commits the original config.
 const sourceConfig={version:5,problem:d.problem,repository:d.repository,branch:d.branch,verifier:d.verifier,executor:d.executor,
  window:d.windowSeconds,minimum_account_age_days:d.minimumGitHubAccountAgeDays,policy:problem.policyHash,objective:problem.policy.objective,
  legacy_ledgers:d.legacyLedgers,...(d.predecessor===undefined?{}:{predecessor:d.predecessor})};
 validateSnapshotConfig(sourceConfig,problem);
 need(openMigrationHash(sourceConfig)===value.sourceConfigHash,'source configuration commitment mismatch');
 return value;
}

export function githubAccountsConfig(deployment){
 deploymentShape(deployment);
 return {version:1,source_contract:deployment.sourceContract,source_config_hash:deployment.sourceConfigHash,
  problem:deployment.problem,repository:deployment.repository,policy:deployment.policyHash};
}

export function validateGitHubAccountsConfig(actual,deployment){
 const value=normalizeOpenRead(actual),expected=githubAccountsConfig(deployment);
 need(exact(value,configKeys)&&sameAddress(value.source_contract,expected.source_contract)&&
  same({...value,source_contract:expected.source_contract},expected),'native configuration mismatch');
 return value;
}

function points(value,{source=false}={}){
 need(exact(value,source?sourcePointKeys:pointKeys)&&(source?sourcePointKeys:pointKeys).every(key=>amount(value[key])),'invalid native point totals');
 need(BigInt(value.author_points)+BigInt(value.impact_points)===BigInt(value.points)&&
  BigInt(value.returned_points)<=BigInt(value.author_points)&&BigInt(value.note_points)<=BigInt(value.author_points),'point accounting mismatch');
 if(source)need(BigInt(value.points)+BigInt(value.reserved_points)===BigInt(value.award_budgets),'source budget mismatch');
 return value;
}

function state(value,deployment){
 need(exact(value,stateKeys),'exact native state required');
 validateGitHubAccountsConfig(Object.fromEntries(configKeys.map(key=>[key,value[key]])),deployment);
 need(['indexed_count','source_count','account_count'].every(key=>safe(value[key]))&&
  Number(value.indexed_count)<=Number(value.source_count)&&typeof value.source_consistent==='boolean'&&typeof value.complete==='boolean','invalid source counters');
 points(value.indexed_totals);points(value.source_totals,{source:true});
 const matches=pointKeys.every(key=>value.indexed_totals[key]===value.source_totals[key]);
 need(value.complete===(value.source_consistent&&Number(value.indexed_count)===Number(value.source_count)&&matches),'native completeness mismatch');
 return value;
}

function account(value,id,completed){
 need(exact(value,accountKeys)&&value.github_author_id===id&&accountId(id),'account identity mismatch');
 need(['username_checked_at','contribution_count','credited_count','formal_count','wallet_count'].every(key=>safe(value[key]))&&
  Number(value.formal_count)<=Number(value.credited_count)&&Number(value.credited_count)<=Number(value.contribution_count)&&
  (Number(value.wallet_count)>0||Number(value.contribution_count)===0),'invalid account counters');
 const checked=Number(value.username_checked_at);
 need(value.login===null?checked===0:login(value.login)&&checked>0&&checked<=Math.floor(completed/1000)+60,'invalid on-chain username profile');
 points(Object.fromEntries(pointKeys.map(key=>[key,value[key]])));
 return value;
}

function sums(accounts){
 const totals=Object.fromEntries(pointKeys.map(key=>[key,0n]));let contributions=0n;
 for(const row of accounts){for(const key of pointKeys)totals[key]+=BigInt(row[key]);contributions+=BigInt(row.contribution_count);}
 return {totals,contributions};
}

export function validateGitHubAccountsSnapshot(snapshot,deployment,{now=Date.now()}={}){
 deploymentShape(deployment);
 need(object(snapshot)&&new TextEncoder().encode(JSON.stringify(snapshot)).length<=GITHUB_ACCOUNTS_BYTE_LIMIT,'snapshot byte bound');
 need(snapshot.version===1&&snapshot.readMode==='latest-final'&&snapshot.atomic===false&&same(snapshot.identity,identity(deployment)),'snapshot deployment mismatch');
 const started=Date.parse(snapshot.startedAt),completed=Date.parse(snapshot.completedAt);
 need(Number.isFinite(started)&&completed>=started&&completed-started<=300000&&completed<=now+60000,'invalid capture interval');
 validateGitHubAccountsConfig(snapshot.config,deployment);state(snapshot.state,deployment);state(snapshot.finalState,deployment);
 need(same(snapshot.state,snapshot.finalState),'account or source state changed during capture');
 need(safe(snapshot.count)&&Number(snapshot.count)===Number(snapshot.state.account_count),'account count mismatch');
 const count=Number(snapshot.count),size=Math.min(count,GITHUB_ACCOUNTS_LIMIT),offset=count-size;
 need(snapshot.offset===offset&&Array.isArray(snapshot.accounts)&&snapshot.accounts.length===size,'bounded newest account page required');
 const ids=snapshot.accounts.map(row=>row?.github_author_id);
 need(ids.every(accountId)&&new Set(ids).size===size,'duplicate or invalid account IDs');
 snapshot.accounts.forEach((row,index)=>account(row,ids[index],completed));
 const sum=sums(snapshot.accounts),full=offset===0;
 need(pointKeys.every(key=>sum.totals[key]<=BigInt(snapshot.state.indexed_totals[key]))&&sum.contributions<=BigInt(snapshot.state.indexed_count),'account rows exceed indexed totals');
 if(full)need(pointKeys.every(key=>sum.totals[key]===BigInt(snapshot.state.indexed_totals[key]))&&sum.contributions===BigInt(snapshot.state.indexed_count),'complete account rows do not reconcile');
 const calls=[['get_config',[]],['get_state',[]],['count_accounts',[]],...(size?[['list_accounts',[offset,size]]]:[]),...ids.map(id=>['get_account',[id]]),['get_state',[]]];
 need(Array.isArray(snapshot.reads)&&snapshot.reads.length===calls.length&&calls.length<=GITHUB_ACCOUNTS_READ_LIMIT,'read budget mismatch');
 let previous=started;
 snapshot.reads.forEach((read,index)=>{const at=Date.parse(read?.at);need(same(read?.call,calls[index])&&at>=previous&&at<=completed,'invalid read provenance');previous=at;});
 return snapshot;
}

export async function collectGitHubAccountsSnapshot({deployment,read,now=()=>new Date().toISOString()}){
 deploymentShape(deployment);
 const startedAt=now(),reads=[];
 const view=async(method,args=[])=>{
  need(reads.length<GITHUB_ACCOUNTS_READ_LIMIT,'read budget exceeded');
  const value=normalizeOpenRead(await read(method,args)),at=now();
  need(Date.parse(at)-Date.parse(startedAt)<=300000,'capture interval exceeded');
  reads.push({call:[method,args],at});return value;
 };
 const config=validateGitHubAccountsConfig(await view('get_config'),deployment),initial=state(await view('get_state'),deployment),count=await view('count_accounts');
 need(safe(count)&&Number(count)===Number(initial.account_count),'account count changed or invalid');
 const size=Math.min(Number(count),GITHUB_ACCOUNTS_LIMIT),offset=Number(count)-size;let ids=[];
 if(size){
  const page=await view('list_accounts',[offset,size]);
  need(exact(page,['items','total','next_offset'])&&safe(page.total)&&Number(page.total)===Number(count)&&page.next_offset===null&&
   Array.isArray(page.items)&&page.items.length===size&&page.items.every(accountId)&&new Set(page.items).size===size,'account page changed or invalid');
  ids=page.items;
 }
 const accounts=[];for(const id of ids)accounts.push(account(await view('get_account',[id]),id,Date.parse(now())));
 const finalState=state(await view('get_state'),deployment);
 return validateGitHubAccountsSnapshot({version:1,identity:identity(deployment),readMode:'latest-final',atomic:false,startedAt,completedAt:now(),
  reads,config,state:initial,finalState,count:String(count),offset,accounts},deployment);
}

// Both inputs must first be authenticated against their reviewed deployments.
// This comparison supplies synchronization/coverage status, not an identity pin.
export function githubAccountsCoverage(snapshot,researchSnapshot){
 need(object(researchSnapshot)&&object(researchSnapshot.identity)&&object(researchSnapshot.points),'validated research snapshot required');
 const d=snapshot.identity,r=researchSnapshot.identity;
 validateGitHubAccountsSnapshot(snapshot,d);
 need(r.chainId===d.chainId&&sameAddress(r.contract,d.sourceContract)&&r.codeHash===d.sourceCodeHash&&r.problem===d.problem&&
  r.repository===d.repository&&r.policy===d.policyHash&&openMigrationHash(researchSnapshot.config)===d.sourceConfigHash,'research snapshot scope mismatch');
 need(safe(researchSnapshot.count)&&researchSnapshot.points.transferable===false,'invalid research totals');
 const source=Object.fromEntries(sourcePointKeys.map(key=>[key,researchSnapshot.points[sourceFields[key]]]));points(source,{source:true});
 const sourceMatches=Number(snapshot.state.source_count)===Number(researchSnapshot.count)&&same(snapshot.state.source_totals,source);
 const accountsComplete=snapshot.offset===0,complete=accountsComplete&&snapshot.state.complete&&sourceMatches;
 const status=!sourceMatches?'source-changed':!snapshot.state.complete?'sync-pending':!accountsComplete?'partial':'complete';
 const label=status==='source-changed'?'Account and research views differ. Refresh or synchronize before ranking.':
  status==='sync-pending'?'On-chain account credit synchronization is incomplete; rankings are unavailable.':
  status==='partial'?`Showing ${snapshot.accounts.length} of ${snapshot.count} on-chain accounts; no rankings.`:
  'Complete on-chain GitHub account credit reconciles with the research ledger. Profiles show their last on-chain username check.';
 return {complete,ranked:complete,sourceMatches,accountsComplete,status,label};
}

export function githubAccountsSnapshotLabel(snapshot,{refreshing=false}={}){
 return `Published account snapshot from ${snapshot.completedAt}; ${refreshing?'live refresh in progress':'live unavailable'}. On-chain views collected ${snapshot.startedAt}–${snapshot.completedAt}, not atomically. Showing ${snapshot.accounts.length} of ${snapshot.count} accounts. This copy cannot authorize identities, merges or points.`;
}

export async function chooseGitHubAccountsView({loadLive,loadPublished,current=null}){
 try{return {mode:'live',snapshot:await loadLive(),changed:true};}
 catch(error){
  if(current?.mode==='live')return {...current,changed:false,unavailable:true,error};
  try{return {mode:'published',snapshot:await loadPublished(),changed:true,unavailable:true,error};}
  catch(snapshotError){return current?{...current,changed:false,unavailable:true,error,snapshotError}:{mode:'unavailable',changed:false,error,snapshotError};}
 }
}
