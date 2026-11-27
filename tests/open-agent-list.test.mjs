import test from 'node:test';import assert from 'node:assert/strict';
import {listOpenContributions,readOpenContributionStatus,isUnknownContribution} from '../scripts/open-agent.mjs';
import {openMigrationHash} from '../src/open-research.mjs';

const contract='0x'+'1'.repeat(40),problem={descriptor:{protocol:{commit:'a'.repeat(40)}},deployment:{problem:'p-vs-np',repository:'owner/problem',branch:'research',chainId:61999,contract}};
const record=(id,changes={})=>({status:'credited',credited_points:'260',award_budget:'300',impact_reserve:'60',reserve_settled:true,evidence:{...problem.deployment,id,context:JSON.stringify({title:'A useful contribution '+id}),claim:'Precisely stated scope',formal_statement:'∀ n : Nat, n = n',evidence_kind:'formal',verification:'verified',research_direction:'A chosen direction',bundle_hash:'b'.repeat(64)},...changes});

test('list discovers a bounded native page with reusable IDs, scope and actual points',async()=>{
 const calls=[],native=async(method,args)=>{calls.push([method,args]);return method==='list_contributions'?{items:['pr-2','pr-3'],total:'7',next_offset:'3'}:record(args[0],args[0]==='pr-3'?{status:'provisional',credited_points:'0',award_budget:undefined,reserve_settled:undefined}:{});};
 const page=await listOpenContributions({native,problem,offset:1,limit:2});
 assert.deepEqual(calls,[['list_contributions',[1,2]],['get',['pr-2']],['get',['pr-3']]]);
 assert.equal(page.total,7);assert.equal(page.next_offset,3);assert.equal(page.next,'pnp list 3 2');assert.equal(page.contract,contract);assert.equal(page.protocolCommit,problem.descriptor.protocol.commit);
 assert.deepEqual(page.items.map(x=>x.id),['pr-2','pr-3']);assert.equal(page.items[0].title,'A useful contribution pr-2');assert.equal(page.items[0].scope.formal_statement,'∀ n : Nat, n = n');assert.equal(page.items[0].bundle_hash,'b'.repeat(64));
 assert.deepEqual(page.items[0].points,{author_credited:'260',award_budget:'300',reserve:'60',reserve_settled:true});assert.equal(page.items[0].eligible_dependency,true);assert.equal(page.items[1].eligible_dependency,false);assert.equal(page.items[1].points.award_budget,null);
});

test('list bounds record requests to four at once and never silently walks the ledger',async()=>{
 const ids=Array.from({length:11},(_,i)=>'pr-'+i),calls=[];let active=0,maximum=0;
 const native=async(method,args)=>{calls.push([method,args]);if(method==='list_contributions')return {items:ids,total:50,next_offset:11};active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return record(args[0]);};
 const page=await listOpenContributions({native,problem,limit:11});assert.equal(maximum,4);assert.equal(calls.length,12);assert.equal(calls.filter(([m])=>m==='list_contributions').length,1);assert.deepEqual(page.items.map(x=>x.id),ids);
});

test('list handles an empty ledger and refuses malformed or excessive pages',async()=>{
 const empty=await listOpenContributions({native:async()=>({items:[],total:'0',next_offset:null}),problem});assert.deepEqual(empty.items,[]);assert.equal(empty.next,null);
 for(const args of [{offset:-1},{offset:0.5},{limit:0},{limit:51},{limit:NaN},{offset:'0'}])await assert.rejects(listOpenContributions({native:async()=>assert.fail('invalid bounds must not read'),problem,...args}),/Usage/);
 for(const page of [{items:['pr-1','pr-1'],total:2,next_offset:null},{items:['pr-1'],total:2,next_offset:null},{items:[],total:0},{items:['bad id'],total:1,next_offset:null},{items:[],total:'9007199254740992',next_offset:null}])await assert.rejects(listOpenContributions({native:async()=>page,problem}),/Malformed bounded/);
});

test('list refuses substituted records and never labels notes as reusable formal dependencies',async()=>{
 const read=r=>async method=>method==='list_contributions'?{items:['pr-1'],total:1,next_offset:null}:r;
 for(const change of [{id:'pr-other'},{contract:'0x'+'2'.repeat(40)},{repository:'other/problem'},{problem:'other'},{branch:'main'}]){const r=record('pr-1');Object.assign(r.evidence,change);await assert.rejects(listOpenContributions({native:read(r),problem}),/scope mismatch/);}
 const note=record('pr-1');Object.assign(note.evidence,{evidence_kind:'research-note',verification:'not-formal',formal_statement:''});const page=await listOpenContributions({native:read(note),problem});assert.equal(page.items[0].eligible_dependency,false);assert.equal(page.items[0].scope.verification,'not-formal');
});

test('list discovers inherited credited work only through successor-authenticated provenance',async()=>{
 const predecessor={address:contract,snapshot_hash:'c'.repeat(64)},successor={...problem,deployment:{...problem.deployment,contract:'0x'+'2'.repeat(40),predecessor}};
 const r=record('pr-1'),provenance={inherited:true,predecessor:contract,snapshot_hash:predecessor.snapshot_hash,record_hash:openMigrationHash(r),original_record_hash:openMigrationHash(r)},calls=[];
 const native=async(method,args)=>{calls.push([method,args]);if(method==='list_contributions')return {items:['pr-1'],total:1,next_offset:null};if(method==='get')return r;if(method==='get_inheritance')return provenance;assert.fail(method);};
 const page=await listOpenContributions({native,problem:successor});
 assert.equal(page.items[0].eligible_dependency,true);assert.deepEqual(page.items[0].inheritance,provenance);
 assert.deepEqual(calls.at(-1),['get_inheritance',['pr-1']]);assert.equal(r.evidence.contract,contract);
 await assert.rejects(listOpenContributions({problem:successor,native:async(method,args)=>method==='get_inheritance'?{...provenance,record_hash:'f'.repeat(64)}:native(method,args)}),/inheritance commitment/);
 await assert.rejects(listOpenContributions({problem:successor,native:async(method,args)=>method==='get_inheritance'?{inherited:false}:native(method,args)}),/inheritance commitment/);
});

test('status prefers the current ledger and authenticates a predecessor archive before displaying it',async()=>{
 const predecessor={address:contract,snapshot_hash:'c'.repeat(64)},successor={...problem,deployment:{...problem.deployment,contract:'0x'+'2'.repeat(40),predecessor}};
 const old=record('pr-1');old.evidence.pr=7;
 const current=record('pr-2');Object.assign(current.evidence,{pr:7,contract:successor.deployment.contract});
 const archived={id:'pr-1',pr:7,contract,chainId:61999,repository:problem.deployment.repository,status:'credited'},recent={...archived,id:'pr-2',contract:successor.deployment.contract};
 const inheritance={inherited:true,predecessor:contract,snapshot_hash:predecessor.snapshot_hash,record_hash:openMigrationHash(old),original_record_hash:openMigrationHash(old)};
 const calls=[],native=async(method,args)=>{calls.push([method,args]);if(method==='get')return args[0]==='pr-1'?old:current;if(method==='get_inheritance')return inheritance;assert.fail(method);};
 const active=await readOpenContributionStatus({index:{entries:[archived,recent]},number:7,problem:successor,native});
 assert.equal(active.archived,recent);assert.equal(active.sourceContract,successor.deployment.contract);assert.deepEqual(calls,[['get',['pr-2']]]);
 const carried=await readOpenContributionStatus({index:{entries:[archived]},number:7,problem:successor,native});
 assert.equal(carried.archived,archived);assert.equal(carried.contract,successor.deployment.contract);assert.equal(carried.sourceContract,contract);assert.deepEqual(carried.inheritance,inheritance);
 assert.equal(archived.contract,contract);
 for(const altered of [{inherited:false},{...inheritance,predecessor:'0x'+'f'.repeat(40)},{...inheritance,snapshot_hash:'f'.repeat(64)},{...inheritance,record_hash:'f'.repeat(64)}]){
  await assert.rejects(readOpenContributionStatus({index:{entries:[archived]},number:7,problem:successor,native:async(method,args)=>method==='get_inheritance'?altered:native(method,args)}),/inheritance commitment/);
 }
 const wrongPR=structuredClone(old);wrongPR.evidence.pr=8;
 await assert.rejects(readOpenContributionStatus({index:{entries:[archived]},number:7,problem:successor,native:async(method)=>method==='get'?wrongPR:{...inheritance,record_hash:openMigrationHash(wrongPR)}}),/native contribution identity/);
 await assert.rejects(readOpenContributionStatus({index:{entries:[{...archived,id:'pr-wrong'}]},number:7,problem:successor,native:async()=>old}),/scope mismatch/);
 for(const change of [{contract:'0x'+'f'.repeat(40)},{repository:'foreign/problem'},{chainId:1}]){
  assert.equal(await readOpenContributionStatus({index:{entries:[{...archived,...change}]},number:7,problem:successor,native:async()=>assert.fail('Foreign archives cannot trigger native reads')}),null);
 }
});

const absent=()=>Object.assign(Error('RPC execution failed'),{cause:{data:{receipt:{execution_result:'ERROR',result:'AXVua25vd24gY29udHJpYnV0aW9u'}}}});
test('status explains a pre-registration failure without inventing a native verdict or points',async()=>{
 const entry={id:'pr-18',pr:18,contract,chainId:61999,repository:problem.deployment.repository,head:'a'.repeat(40),report:'reports/pr-18.json',status:'invalid'};
 const report={...entry,error:'Kernel rejected serialized proof',updatedAt:'2026-11-23T20:00:00Z'};
 const result=await readOpenContributionStatus({index:{entries:[entry]},number:18,problem,native:async()=>{throw absent();},readReport:async file=>{assert.equal(file,entry.report);return report;}});
 assert.equal(result.native,null);assert.equal(result.nativeState,'not-registered-at-read');assert.equal(result.worker.error,report.error);
 assert.equal(Object.hasOwn(result,'points'),false);assert.match(result.next,/not a native merit decision/);assert.match(result.next,/transaction may still be pending/);
 for(const status of ['verifying','registration-pending','submitted','credited']){
  const pending=await readOpenContributionStatus({index:{entries:[entry]},number:18,problem,native:async()=>{throw absent();},readReport:async()=>({...report,status})});
  assert.equal(pending.native,null);assert.equal(pending.worker.status,status);assert.equal(Object.hasOwn(pending,'points'),false);
 }
 for(const patch of [{id:'different'},{pr:19},{repository:'foreign/repo'},{contract:'0x'+'2'.repeat(40)},{chainId:1},{head:'b'.repeat(40)},{status:'invented'}])
  await assert.rejects(readOpenContributionStatus({index:{entries:[entry]},number:18,problem,native:async()=>{throw absent();},readReport:async()=>({...report,...patch})}),/scope/);
 await assert.rejects(readOpenContributionStatus({index:{entries:[{...entry,report:'reports/other.json'}]},number:18,problem,native:async()=>{throw absent();},readReport:async()=>assert.fail('wrong report must not load')}),/report path/);
});

test('status never turns rate limits, generic failures or forged error text into an absent native record',async()=>{
 assert.equal(isUnknownContribution(absent()),true);
 for(const error of [Error('unknown contribution'),Object.assign(Error('rate limit'),{code:429}),Object.assign(Error('execution failed'),{data:{receipt:{execution_result:'SUCCESS',result:'AXVua25vd24gY29udHJpYnV0aW9u'}}})]){
  assert.equal(isUnknownContribution(error),false);
  const entry={id:'pr-1',pr:1,contract,chainId:61999,repository:problem.deployment.repository};
  await assert.rejects(readOpenContributionStatus({index:{entries:[entry]},number:1,problem,native:async()=>{throw error;},readReport:async()=>assert.fail('RPC failure cannot authorize archive fallback')}),e=>e===error);
 }
});
