// Bounded, dated finalized views. This module never signs a transaction.
import {sha256,stringToBytes} from 'viem';
import {normalizeOpenRead,openMigrationHash,openSnapshotIdentity,validateSnapshotConfig,validateOpenRecordOrigin,readOpenRecordInheritance,chooseOpenLedgerView} from './open-snapshot.mjs';

export const FEDERATION_PAGE_LIMIT=8;
export const FEDERATION_ACCOUNT_LIMIT=32;
// At most 88 native views, including inherited origins: a three-second
// provider spacing still fits inside the five-minute capture interval.
export const FEDERATION_READ_LIMIT=88;
export const FEDERATION_BYTE_LIMIT=4*1024*1024;
const need=(ok,message)=>{if(!ok)throw Error('Federation snapshot: '+message);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const same=(a,b)=>a!==undefined&&b!==undefined&&openMigrationHash(a)===openMigrationHash(b);
const integer=v=>typeof v==='number'?Number.isSafeInteger(v)&&v>=0:typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v);
const safe=v=>integer(v)&&Number.isSafeInteger(Number(v));
const amount=v=>typeof v==='string'&&integer(v)&&BigInt(v)<2n**256n;
const account=v=>typeof v==='string'&&/^[1-9][0-9]{0,15}$/.test(v)&&Number.isSafeInteger(Number(v));
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const commit=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v)&&v!=='0'.repeat(40);
const address=v=>typeof v==='string'&&/^0x[a-fA-F0-9]{40}$/.test(v)&&!/^0x0{40}$/i.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(v);
const sourceId=v=>typeof v==='string'&&/^external-[a-f0-9]{32}$/.test(v);
const caseId=v=>typeof v==='string'&&/^attribution-[a-f0-9]{32}$/.test(v);
const subject=v=>typeof v==='string'&&v.startsWith('github:')&&account(v.slice(7));
const text=(v,max,min=0)=>typeof v==='string'&&v.length>=min&&v.length<=max;
const sorted=v=>Array.isArray(v)?v.map(sorted):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
const nativeHash=v=>sha256(stringToBytes(JSON.stringify(sorted(v)))).slice(2);
const timestamp=(v,completed)=>safe(v)&&Number(v)<=Math.floor(completed/1000)+60;
const unique=(values,valid)=>Array.isArray(values)&&values.every(valid)&&new Set(values).size===values.length;

export function validateFederationDeployment(value,problem){
 need(exact(value,['version','sourceContract','sourceCodeHash'])&&value.version===1&&address(value.sourceContract)&&hash(value.sourceCodeHash),'exact version-one federation marker required');
 need(value.sourceContract.toLowerCase()===problem.deployment.contract.toLowerCase()&&value.sourceCodeHash===problem.deployment.codeHash,'source deployment mismatch');
 return value;
}
function enabled(problem){
 need(problem.federation===true,'federation capability is not enabled');
 validateFederationDeployment({version:1,sourceContract:problem.deployment.contract,sourceCodeHash:problem.deployment.codeHash},problem);
}

const statePoints=['total_points','wallet_points','unclaimed_points','total_award_budgets','total_reserved_points','total_initial_points','total_impact_points','total_returned_points'];
function state(value){
 need(object(value)&&Number(value.version)===1&&amount(value.state_revision),'versioned native state required');
 need(['external_results','external_authors','attribution_cases','attribution_accounts','author_claims','research_records'].every(k=>safe(value[k]))&&statePoints.every(k=>amount(value[k])),'invalid federation counters');
 need(Number(value.external_results)<=256&&Number(value.external_authors)<=256&&Number(value.attribution_cases)<=512&&Number(value.author_claims)<=512,'pilot capacity exceeded');
 need(BigInt(value.wallet_points)+BigInt(value.unclaimed_points)===BigInt(value.total_points)&&BigInt(value.total_initial_points)+BigInt(value.total_impact_points)===BigInt(value.total_points)&&BigInt(value.total_points)+BigInt(value.total_reserved_points)===BigInt(value.total_award_budgets)&&BigInt(value.total_returned_points)<=BigInt(value.total_initial_points),'global points do not reconcile');
 need(object(value.capabilities)&&value.capabilities.zero_award_source_registration===true&&value.capabilities.initial_credit_corrections===true&&value.capabilities.explicit_future_impact_routes===true&&value.capabilities.github_author_wallet_claims===true&&value.capabilities.historical_impact_rewrite===false&&value.capabilities.revocation===false&&value.capabilities.transferable===false,'native capability mismatch');
 return value;
}

function external(value,key,completed){
 need(exact(value,['id','source_hash','evidence','subject','verification','points','registered_at'])&&value.id===key&&sourceId(key)&&hash(value.source_hash)&&value.verification==='not-locally-verified'&&value.points==='0'&&timestamp(value.registered_at,completed),'invalid external registration');
 const e=value.evidence,keys=['repository','repository_id','pr','commit','path','blob_sha','content_sha256','theorem','statement','license','source_url','github_author_id','origin','attribution_basis'];
 need(exact(e,keys)&&text(e.repository,140)&&/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(e.repository)&&!['.','..'].includes(e.repository.split('/')[1]),'invalid source repository');
 need(['repository_id','pr','github_author_id'].every(k=>account(String(e[k])))&&commit(e.commit)&&commit(e.blob_sha)&&hash(e.content_sha256)&&text(e.path,300,1)&&/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(e.path)&&!e.path.split('/').some(x=>x==='.'||x==='..'),'invalid immutable source pins');
 need(e.source_url===`https://github.com/${e.repository}/blob/${e.commit}/${e.path}`&&value.subject==='github:'+e.github_author_id,'source URL or author mismatch');
 need(text(e.theorem,300,1)&&text(e.statement,4000,10)&&text(e.license,100,1)&&text(e.attribution_basis,3000,40)&&['discovery','formalization','unknown'].includes(e.origin),'invalid qualified attribution');
 const canonical={...e,...Object.fromEntries(['repository_id','pr','github_author_id'].map(k=>[k,Number(e[k])]))};
 need(nativeHash(canonical)===value.source_hash&&key==='external-'+nativeHash(Object.fromEntries(['repository_id','commit','path','theorem'].map(k=>[k,canonical[k]]))).slice(0,32),'source content commitment mismatch');
 return value;
}
function author(value,key,completed){
 need(exact(value,['subject','github_author_id','sources','claimed_wallet','binding_version','initial_points','impact_points','unclaimed_points','claim_history'])&&value.subject===key&&subject(key)&&key==='github:'+value.github_author_id,'external author mismatch');
 need(unique(value.sources,sourceId)&&value.sources.length<=32&&safe(value.binding_version)&&['initial_points','impact_points','unclaimed_points'].every(k=>amount(value[k])),'invalid author sources or points');
 need(value.claimed_wallet===null?Number(value.binding_version)===0&&BigInt(value.unclaimed_points)===BigInt(value.initial_points)+BigInt(value.impact_points):address(value.claimed_wallet)&&Number(value.binding_version)>0&&value.unclaimed_points==='0','author wallet and unclaimed balance disagree');
 need(Array.isArray(value.claim_history)&&value.claim_history.length<=512&&value.claim_history.every(h=>object(h)&&timestamp(h.at,completed)),'invalid author claim history');
 return value;
}
function accountPoints(value,key){
 need(exact(value,['github_author_id','initial_points','impact_points','points','unclaimed_points'])&&value.github_author_id===key&&account(key)&&['initial_points','impact_points','points','unclaimed_points'].every(k=>amount(value[k])),'invalid account attribution');
 need(BigInt(value.initial_points)+BigInt(value.impact_points)===BigInt(value.points)&&BigInt(value.unclaimed_points)<=BigInt(value.points),'account attribution does not reconcile');
 return value;
}
function bands(values){
 need(Array.isArray(values)&&values.length>=1&&values.length<=5&&values.every(v=>exact(v,['subject','band'])&&(v.subject==='contributor'||subject(v.subject))&&safe(v.band)&&Number(v.band)>=1&&Number(v.band)<=10)&&new Set(values.map(v=>v.subject)).size===values.length&&values.reduce((n,v)=>n+Number(v.band),0)===10,'invalid attribution bands');
}
function allocations(values,pool){
 need(Array.isArray(values)&&values.length>=1&&values.length<=5&&values.every(v=>exact(v,['subject','points'])&&(v.subject==='contributor'||subject(v.subject))&&amount(v.points))&&new Set(values.map(v=>v.subject)).size===values.length&&values.reduce((n,v)=>n+BigInt(v.points),0n)===BigInt(pool),'allocation pool mismatch');
}
function split(pool,values){
 const rows=values.map(v=>({subject:v.subject,points:BigInt(pool)*BigInt(v.band)/10n,remainder:BigInt(pool)*BigInt(v.band)%10n}));
 const remainder=BigInt(pool)-rows.reduce((n,v)=>n+v.points,0n);
 const ranked=[...rows].sort((a,b)=>a.remainder===b.remainder?(a.subject<b.subject?-1:1):a.remainder>b.remainder?-1:1);
 for(let i=0;i<Number(remainder);i++)ranked[i].points++;
 return rows.sort((a,b)=>a.subject<b.subject?-1:1).map(v=>({subject:v.subject,points:String(v.points)}));
}
export function validateFederationAttribution(value,key,completed=Date.now()){
 need(exact(value,['contribution','revision','initial_pool','initial_bands','initial_allocations','impact_bands','route_hash','corrections'])&&value.contribution===key&&id(key)&&safe(value.revision)&&Number(value.revision)<=512&&amount(value.initial_pool)&&hash(value.route_hash),'invalid contribution attribution');
 bands(value.initial_bands);bands(value.impact_bands);allocations(value.initial_allocations,value.initial_pool);
 need(same(value.initial_allocations,split(value.initial_pool,value.initial_bands)),'initial allocation differs from its approved bands');
 need(value.route_hash===nativeHash({revision:Number(value.revision),bands:value.impact_bands.map(v=>({...v,band:Number(v.band)}))}),'future impact route commitment mismatch');
 need(Array.isArray(value.corrections)&&value.corrections.length===Number(value.revision),'correction revision mismatch');
 value.corrections.forEach((c,index)=>{
  need(exact(c,['case','revision','before','after','impact_bands','attestation_hash','reason','at'])&&caseId(c.case)&&Number(c.revision)===index+1&&hash(c.attestation_hash)&&text(c.reason,4000,40)&&timestamp(c.at,completed),'invalid correction history');
  allocations(c.before,value.initial_pool);allocations(c.after,value.initial_pool);bands(c.impact_bands);
  need(same(c.before,index?value.corrections[index-1].after:[{subject:'contributor',points:value.initial_pool}]),'correction chain mismatch');
 });
 if(value.corrections.length)need(same(value.corrections.at(-1).after,value.initial_allocations)&&same(value.corrections.at(-1).impact_bands,value.impact_bands),'current attribution differs from correction history');
 else need(same(value.initial_bands,[{subject:'contributor',band:10}])&&same(value.impact_bands,[{subject:'contributor',band:10}]),'uncorrected attribution must retain the contributor route');
 return value;
}
function attributionCase(value,key,completed){
 need(object(value)&&value.id===key&&caseId(key)&&id(value.target)&&safe(value.revision)&&safe(value.round)&&Number(value.round)<=2&&['submitted','verified','provisional','challenged','settled'].includes(value.status)&&timestamp(value.created_at,completed),'invalid attribution case');
 need(exact(value.request,['claim','sources'])&&text(value.request.claim,3000,40)&&Array.isArray(value.request.sources)&&value.request.sources.length>=1&&value.request.sources.length<=4&&value.request.sources.every(s=>exact(s,['id','source_hash'])&&sourceId(s.id)&&hash(s.source_hash))&&new Set(value.request.sources.map(s=>s.id)).size===value.request.sources.length,'invalid case source commitments');
 need(hash(value.request_hash)&&nativeHash(value.request)===value.request_hash&&key==='attribution-'+nativeHash({target:value.target,revision:Number(value.revision),sources:value.request.sources}).slice(0,32),'case commitment mismatch');
 if(value.verdict!==null){need(object(value.verdict)&&typeof value.verdict.apply==='boolean'&&text(value.verdict.reason,4000,40),'invalid case verdict');if(value.verdict.apply){bands(value.verdict.initial_bands);bands(value.verdict.impact_bands);}else need(Array.isArray(value.verdict.initial_bands)&&!value.verdict.initial_bands.length&&Array.isArray(value.verdict.impact_bands)&&!value.verdict.impact_bands.length,'rejected correction changed allocation');}
 need(Array.isArray(value.history)&&value.history.length<=32&&value.history.every(h=>object(h)&&timestamp(h.at,completed)),'invalid case history');
 return value;
}
function localRecord(row,problem,completed){
 need(exact(row,['record','inheritance','attribution'])&&object(row.record)&&object(row.record.evidence),'invalid local record');
 const r=row.record,e=r.evidence;
 validateOpenRecordOrigin(r,e.id,problem,row.inheritance);
 need(id(e.id)&&['submitted','provisional','challenged','approved','credited','rejected','expired'].includes(r.status)&&safe(e.pr)&&Number(e.pr)>0&&account(String(e.github_author_id))&&amount(String(r.credited_points)),'invalid local record identity');
 need(text(e.claim,4000)&&object(e.provenance)&&['discovery','formalization','extension','integration'].includes(e.provenance.mode)&&Array.isArray(e.provenance.sources)&&e.provenance.sources.length<=8&&e.provenance.sources.every(s=>object(s)&&text(s.reference,2000)),'invalid local provenance');
 if(r.status==='credited'){
  validateFederationAttribution(row.attribution,e.id,completed);
  need(amount(String(r.initial_paid))&&amount(String(r.reserve_returned))&&BigInt(row.attribution.initial_pool)===BigInt(r.initial_paid)+BigInt(r.reserve_returned),'original and current author pool differ');
 }else need(row.attribution===null,'uncredited record has an attribution award');
 return row;
}

const pages=[['sources','external_results','list_external_results','get_external_result',sourceId],['authors','external_authors','list_external_authors','get_external_author',subject],['cases','attribution_cases','list_attribution_cases','get_attribution_case',caseId],['accounts','attribution_accounts','list_attribution_accounts','get_account_attribution',account],['contributions','research_records','list_contributions','get',id]];
const pageSize=(name,total)=>Math.min(Number(total),name==='accounts'?FEDERATION_ACCOUNT_LIMIT:FEDERATION_PAGE_LIMIT);
const rowId=(name,row)=>name==='authors'?row.subject:name==='accounts'?row.github_author_id:name==='contributions'?row.record.evidence.id:row.id;
function validatePage(page,name,total,valid){
 const size=pageSize(name,total),offset=Number(total)-size;
 need(exact(page,['total','offset','rows'])&&safe(page.total)&&Number(page.total)===Number(total)&&page.offset===offset&&Array.isArray(page.rows)&&page.rows.length===size,'bounded '+name+' page required');
 need(unique(page.rows.map(row=>rowId(name,row)),valid),'duplicate or invalid '+name+' IDs');
 return {size,offset};
}
export function validateFederationSnapshot(snapshot,problem,{now=Date.now()}={}){
 enabled(problem);
 need(object(snapshot)&&new TextEncoder().encode(JSON.stringify(snapshot)).length<=FEDERATION_BYTE_LIMIT,'snapshot byte bound');
 need(snapshot.version===1&&snapshot.readMode==='latest-final'&&snapshot.atomic===false&&same(snapshot.identity,openSnapshotIdentity(problem)),'deployment or source pin mismatch');
 const started=Date.parse(snapshot.startedAt),completed=Date.parse(snapshot.completedAt);
 need(Number.isFinite(started)&&completed>=started&&completed-started<=300000&&completed<=now+60000,'invalid capture interval');
 validateSnapshotConfig(snapshot.config,problem);state(snapshot.state);state(snapshot.finalState);
 need(same(snapshot.state,snapshot.finalState),'federation state changed during capture');
 const calls=[['get_config',[]],['get_federation_state',[]]];
 for(const [name,count,list,get,valid] of pages){
  const page=snapshot[name],{size,offset}=validatePage(page,name,snapshot.state[count],valid);
  if(size)calls.push([list,[offset,size]]);
  for(const row of page.rows){
   const key=rowId(name,row);calls.push([get,[key]]);
   if(name==='sources')external(row,key,completed);
   else if(name==='authors')author(row,key,completed);
   else if(name==='cases')attributionCase(row,key,completed);
   else if(name==='accounts')accountPoints(row,key);
   else{localRecord(row,problem,completed);if(row.inheritance.inherited)calls.push(['get_inheritance',[key]]);if(row.record.status==='credited')calls.push(['get_attribution',[key]]);}
  }
 }
 calls.push(['get_federation_state',[]]);
 need(Array.isArray(snapshot.reads)&&snapshot.reads.length===calls.length&&calls.length<=FEDERATION_READ_LIMIT,'read budget mismatch');
 let previous=started;snapshot.reads.forEach((r,index)=>{const at=Date.parse(r.at);need(same(r.call,calls[index])&&at>=previous&&at<=completed,'invalid read provenance');previous=at;});
 const totals={initial_points:0n,impact_points:0n,points:0n,unclaimed_points:0n};
 for(const row of snapshot.accounts.rows)for(const key of Object.keys(totals))totals[key]+=BigInt(row[key]);
 const fields={initial_points:'total_initial_points',impact_points:'total_impact_points',points:'total_points',unclaimed_points:'unclaimed_points'};
 need(Object.entries(fields).every(([key,field])=>totals[key]<=BigInt(snapshot.state[field])),'account rows exceed native totals');
 // Incomplete or unreconciled rows remain inspectable, but cannot be ranked.
 const reconciled=snapshot.accounts.offset===0&&Object.entries(fields).every(([key,field])=>totals[key]===BigInt(snapshot.state[field]));
 need(snapshot.accountsReconciled===reconciled,'account reconciliation label mismatch');
 for(const a of snapshot.authors.rows){const row=snapshot.accounts.rows.find(r=>r.github_author_id===String(a.github_author_id));if(row)need(row.unclaimed_points===a.unclaimed_points,'author unclaimed balance mismatch');}
 for(const s of snapshot.sources.rows){const a=snapshot.authors.rows.find(a=>a.subject===s.subject);if(a)need(a.sources.includes(s.id),'source author link mismatch');}
 for(const c of snapshot.cases.rows)for(const reference of c.request.sources){const s=snapshot.sources.rows.find(s=>s.id===reference.id);if(s)need(s.source_hash===reference.source_hash,'case source hash mismatch');}
 return snapshot;
}

export async function collectFederationSnapshot({problem,read,now=()=>new Date().toISOString()}){
 enabled(problem);const startedAt=now(),reads=[];
 const view=async(method,args=[])=>{need(reads.length<FEDERATION_READ_LIMIT,'read budget exceeded');const result=normalizeOpenRead(await read(method,args)),at=now();need(Date.parse(at)-Date.parse(startedAt)<=300000,'capture interval exceeded');reads.push({call:[method,args],at});return result;};
 const config=validateSnapshotConfig(await view('get_config'),problem),initial=state(await view('get_federation_state'));
 const captured={};
 for(const [name,count,list,get,valid] of pages){
  const total=Number(initial[count]),size=pageSize(name,total),offset=total-size,rows=[];let ids=[];
  if(size){const page=await view(list,[offset,size]);need(exact(page,['items','total','next_offset'])&&safe(page.total)&&Number(page.total)===total&&page.next_offset===null&&unique(page.items,valid)&&page.items.length===size,'native '+name+' page changed or invalid');ids=page.items;}
  for(const key of ids){const value=await view(get,[key]);if(name==='contributions'){const inheritance=await readOpenRecordInheritance(value,key,problem,id=>view('get_inheritance',[id]));rows.push({record:value,inheritance,attribution:value.status==='credited'?await view('get_attribution',[key]):null});}else rows.push(value);}
  captured[name]={total:String(total),offset,rows};
 }
 const finalState=state(await view('get_federation_state'));
 const fields={initial_points:'total_initial_points',impact_points:'total_impact_points',points:'total_points',unclaimed_points:'unclaimed_points'};
 const accountsReconciled=captured.accounts.offset===0&&Object.entries(fields).every(([key,field])=>captured.accounts.rows.reduce((n,r)=>n+BigInt(r[key]),0n)===BigInt(initial[field]));
 return validateFederationSnapshot({version:1,identity:openSnapshotIdentity(problem),readMode:'latest-final',atomic:false,startedAt,completedAt:now(),reads,config,state:initial,finalState,...captured,accountsReconciled},problem);
}

export function federationCoverage(snapshot,researchSnapshot){
 const fields={total_points:'total_awarded',total_initial_points:'total_initial_points',total_impact_points:'total_impact_points',total_award_budgets:'total_award_budgets',total_reserved_points:'total_reserved_points',total_returned_points:'total_returned_points'};
 const sourceMatches=Boolean(researchSnapshot&&same(snapshot.identity,researchSnapshot.identity)&&Number(snapshot.state.research_records)===Number(researchSnapshot.count)&&Object.entries(fields).every(([field,key])=>String(snapshot.state[field])===String(researchSnapshot.points[key])));
 const accountsComplete=snapshot.accounts.offset===0,ranked=sourceMatches&&accountsComplete&&snapshot.accountsReconciled;
 const status=!sourceMatches?'source-changed':!accountsComplete?'partial':!snapshot.accountsReconciled?'unreconciled':'complete';
 const label=status==='source-changed'?'Federation and research views differ; current amounts are dated and no ranks are shown.':status==='partial'?`Showing ${snapshot.accounts.rows.length} of ${snapshot.accounts.total} accounts; no ranks for a partial page.`:status==='unreconciled'?'Account attribution does not reconcile with native totals; no ranks are shown.':'Current attribution reconciles across all GitHub accounts, including explicitly unclaimed credit.';
 return {ranked,sourceMatches,accountsComplete,status,label};
}
export function federationSnapshotLabel(snapshot,{refreshing=false}={}){return `Published federation snapshot from ${snapshot.completedAt}; ${refreshing?'live refresh in progress':'live unavailable'}. Finalized views collected ${snapshot.startedAt}–${snapshot.completedAt}, not atomically. This dated copy cannot authorize a correction, claim, merge or award.`;}
export const chooseFederationView=chooseOpenLedgerView;
