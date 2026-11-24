import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectFederationSnapshot,validateFederationSnapshot,validateFederationDeployment,validateFederationAttribution,federationCoverage,federationSnapshotLabel,chooseFederationView,FEDERATION_READ_LIMIT} from '../src/federation-snapshot.mjs';
import {openSnapshotIdentity,openMigrationHash} from '../src/open-snapshot.mjs';

const address=n=>'0x'+n.repeat(40),hash=n=>n.repeat(64),commit=n=>n.repeat(40);
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(sorted(v))).digest('hex');
const problem={federation:true,deployment:{chainId:61999,contract:address('1'),codeHash:hash('2'),problem:'p-vs-np',repository:'Owner/problem',branch:'research',verifier:address('3'),executor:address('4'),windowSeconds:300,minimumGitHubAccountAgeDays:30,legacyLedgers:[]},policyHash:hash('5'),policy:{objective:'Useful open research toward P versus NP.'},descriptor:{protocol:{commit:commit('6')}}};
const config={version:5,problem:'p-vs-np',repository:'Owner/problem',branch:'research',verifier:address('3'),executor:address('4'),window:300,minimum_account_age_days:30,policy:hash('5'),objective:problem.policy.objective,legacy_ledgers:[]};
const at=Math.floor(Date.now()/1000)-120;
const capabilities={zero_award_source_registration:true,initial_credit_corrections:true,github_author_wallet_claims:true,explicit_future_impact_routes:true,historical_impact_rewrite:false,revocation:false,transferable:false};
function source(index=0){
 const evidence={repository:'Upstream/proofs',repository_id:42,pr:index+1,commit:commit('a'),path:`lean/Result${index}.lean`,blob_sha:commit('b'),content_sha256:hash('c'),theorem:`Upstream.Result${index}`,statement:'An exact mathematical statement from the original source.',license:'Apache-2.0',source_url:`https://github.com/Upstream/proofs/blob/${commit('a')}/lean/Result${index}.lean`,github_author_id:18+index,origin:'formalization',attribution_basis:'The exact upstream PR records its formal contributor; original mathematical discovery is not established.'};
 return {id:'external-'+digest(Object.fromEntries(['repository_id','commit','path','theorem'].map(k=>[k,evidence[k]]))).slice(0,32),source_hash:digest(evidence),evidence,subject:'github:'+evidence.github_author_id,verification:'not-locally-verified',points:'0',registered_at:at};
}
function fixture({empty=false,many=false,override,selectedProblem=problem}={}){
 const sources=empty?[]:Array.from({length:many?80:1},(_,i)=>source(i)),s=sources[0];
 const authors=sources.map(s=>({subject:s.subject,github_author_id:s.evidence.github_author_id,sources:[s.id],claimed_wallet:null,binding_version:0,initial_points:s===sources[0]?'160':'0',impact_points:'0',unclaimed_points:s===sources[0]?'160':'0',claim_history:[]}));
 const request=s?{claim:'The local integration reused this exact upstream formal result and should preserve its source attribution.',sources:[{id:s.id,source_hash:s.source_hash}]}:null;
 const initial_bands=[{subject:'contributor',band:6},{subject:'github:18',band:4}],impact_bands=[{subject:'contributor',band:2},{subject:'github:18',band:8}];
 const before=[{subject:'contributor',points:'400'}],after=[{subject:'contributor',points:'240'},{subject:'github:18',points:'160'}];
 const cases=empty?[]:Array.from({length:many?80:1},(_,i)=>{
  const target='pr-'+i,id='attribution-'+digest({target,revision:0,sources:request.sources}).slice(0,32);
  return {id,target,revision:0,request,request_hash:digest(request),status:'settled',round:0,verdict:{apply:true,initial_bands,impact_bands,reason:'The upstream formal contribution is established while the local integration retains its own portion.'},history:[{event:'review',at},{event:'settled',at}],created_at:at};
 });
 const rows=empty?[]:Array.from({length:many?80:1},(_,i)=>{
  const id='pr-'+i,r={status:'credited',credited_points:'400',initial_paid:'320',reserve_returned:'80',evidence:{id,problem:'p-vs-np',repository:'Owner/problem',branch:'research',policy:hash('5'),contract:address('1'),pr:i+1,github_author_id:17,wallet:address('d'),claim:'A useful local mathematical integration.',provenance:{mode:'integration',sources:[{reference:s.evidence.source_url}],discovery_basis:'No discovery claim.'}}};
  const attribution={contribution:id,revision:1,initial_pool:'400',initial_bands,initial_allocations:after,impact_bands,route_hash:digest({revision:1,bands:impact_bands}),corrections:[{case:cases[i].id,revision:1,before,after,impact_bands,attestation_hash:hash('d'),reason:cases[i].verdict.reason,at}]};
  return {record:r,inheritance: selectedProblem.deployment.predecessor?{inherited:true,predecessor:address('1'),snapshot_hash:hash('e'),record_hash:openMigrationHash(r),original_record_hash:openMigrationHash(r)}:{inherited:false},attribution};
 });
 const accounts=empty?[]:[{github_author_id:'17',initial_points:'240',impact_points:'0',points:'240',unclaimed_points:'0'},{github_author_id:'18',initial_points:'160',impact_points:'0',points:'160',unclaimed_points:'160'},...(many?Array.from({length:78},(_,i)=>({github_author_id:String(19+i),initial_points:'0',impact_points:'0',points:'0',unclaimed_points:'0'})):[])];
 const state={version:1,state_revision:'5',external_results:sources.length,external_authors:authors.length,attribution_cases:cases.length,attribution_accounts:accounts.length,author_claims:0,research_records:rows.length,total_points:empty?'0':'400',wallet_points:empty?'0':'240',unclaimed_points:empty?'0':'160',total_award_budgets:empty?'0':'400',total_reserved_points:'0',total_initial_points:empty?'0':'400',total_impact_points:'0',total_returned_points:empty?'0':'80',limits:{},capabilities};
 const sourceConfig={...config,...(selectedProblem.deployment.predecessor?{predecessor:selectedProblem.deployment.predecessor}:{})};
 const lists={list_external_results:sources.map(r=>r.id),list_external_authors:authors.map(r=>r.subject),list_attribution_cases:cases.map(r=>r.id),list_attribution_accounts:accounts.map(r=>r.github_author_id),list_contributions:rows.map(r=>r.record.evidence.id)};
 const calls=[],read=async(method,args=[])=>{
  calls.push([method,args]);const replaced=override?.(method,args,calls.length,{state,accounts,sources,rows,cases,authors});if(replaced!==undefined)return structuredClone(replaced);
  if(method==='get_config')return structuredClone(sourceConfig);
  if(method==='get_federation_state')return structuredClone(state);
  if(lists[method]){const all=lists[method];return {items:all.slice(args[0],args[0]+args[1]),total:BigInt(all.length),next_offset:null};}
  const all={get_external_result:[sources,'id'],get_external_author:[authors,'subject'],get_attribution_case:[cases,'id'],get_account_attribution:[accounts,'github_author_id']}[method];
  if(all)return structuredClone(all[0].find(row=>row[all[1]]===args[0]));
  const row=rows.find(r=>r.record.evidence.id===args[0]);
  if(method==='get')return structuredClone(row.record);if(method==='get_inheritance')return structuredClone(row.inheritance);if(method==='get_attribution')return structuredClone(row.attribution);
  assert.fail('Unexpected or mutating method: '+method);
 };
 const research={identity:openSnapshotIdentity(selectedProblem),count:String(rows.length),points:{total_awarded:state.total_points,total_initial_points:state.total_initial_points,total_impact_points:state.total_impact_points,total_award_budgets:state.total_award_budgets,total_reserved_points:state.total_reserved_points,total_returned_points:state.total_returned_points}};
 return {read,calls,research,state,accounts,rows,sources,cases,authors};
}

test('only an exact federation marker matching the reviewed native source enables capture',async()=>{
 const marker={version:1,sourceContract:address('1'),sourceCodeHash:hash('2')};
 assert.equal(validateFederationDeployment(marker,problem),marker);
 for(const changed of [{...marker,version:'1'},{...marker,sourceContract:address('a')},{...marker,sourceCodeHash:hash('a')},{...marker,extra:true}])assert.throws(()=>validateFederationDeployment(changed,problem),/Federation snapshot/);
 await assert.rejects(collectFederationSnapshot({problem:{...problem,federation:false},read:()=>assert.fail('Must not read')}),/not enabled/);
});

test('capture keeps zero-award documentary sources separate from corrected local awards and unclaimed identity',async()=>{
 const f=fixture(),s=await collectFederationSnapshot({problem,read:f.read});
 assert.equal(s.sources.rows[0].verification,'not-locally-verified');assert.equal(s.sources.rows[0].points,'0');
 assert.equal(s.authors.rows[0].claimed_wallet,null);assert.equal(s.authors.rows[0].unclaimed_points,'160');
 assert.equal(s.contributions.rows[0].record.credited_points,'400');assert.equal(s.contributions.rows[0].attribution.initial_allocations[0].points,'240');
 assert.deepEqual(s.contributions.rows[0].attribution.impact_bands,[{subject:'contributor',band:2},{subject:'github:18',band:8}]);
 assert.equal(s.accountsReconciled,true);assert.equal(federationCoverage(s,f.research).ranked,true);assert.equal(validateFederationSnapshot(s,problem),s);
 assert.equal(f.calls.filter(([m])=>m==='get_federation_state').length,2);assert.equal(s.atomic,false);assert.equal(s.readMode,'latest-final');
});

test('empty native state stays empty and requires only three unsigned views',async()=>{
 const f=fixture({empty:true}),s=await collectFederationSnapshot({problem,read:f.read});
 assert.equal(f.calls.length,3);assert.deepEqual(s.sources.rows,[]);assert.deepEqual(s.accounts.rows,[]);assert.equal(s.accountsReconciled,true);
});

test('newest pages and inherited record provenance are hard bounded; partial accounts never rank',async()=>{
 const inherited={...problem,deployment:{...problem.deployment,contract:address('f'),predecessor:{address:address('1'),snapshot_hash:hash('e')}}};
 const f=fixture({many:true,selectedProblem:inherited}),s=await collectFederationSnapshot({problem:inherited,read:f.read});
 assert.equal(f.calls.length,FEDERATION_READ_LIMIT);assert.equal(s.sources.rows.length,8);assert.equal(s.contributions.rows.length,8);assert.equal(s.accounts.rows.length,32);
 assert.equal(s.sources.offset,72);assert.equal(s.accounts.offset,48);assert.equal(s.accountsReconciled,false);assert.equal(federationCoverage(s,f.research).ranked,false);assert.equal(federationCoverage(s,f.research).status,'partial');
 assert.ok(s.contributions.rows.every(r=>r.inheritance.inherited));assert.ok(f.calls.every(([m])=>/^(get$|get_|list_)/.test(m)));
});

test('same-total reallocation during capture is rejected by the native state revision',async()=>{
 let states=0;const f=fixture({override:(method,args,index,{state})=>method==='get_federation_state'?{...state,state_revision:++states===1?'5':'6'}:undefined});
 await assert.rejects(collectFederationSnapshot({problem,read:f.read}),/state changed/);
});

test('an incomplete attribution index remains visible with no ranking even when the page is complete',async()=>{
 const f=fixture({override:(method,args,index,{accounts})=>method==='get_account_attribution'&&args[0]==='17'?{...accounts[0],initial_points:'200',points:'200'}:undefined});
 const s=await collectFederationSnapshot({problem,read:f.read});assert.equal(s.accountsReconciled,false);assert.equal(federationCoverage(s,f.research).status,'unreconciled');assert.equal(federationCoverage(s,f.research).ranked,false);
 const changed=structuredClone(f.research);changed.points.total_awarded='401';assert.equal(federationCoverage(s,changed).status,'source-changed');
});

test('source substitutions, invented wallets, rewritten history, provenance and inflation fail closed',async()=>{
 const f=fixture(),s=await collectFederationSnapshot({problem,read:f.read});
 const mutations=[
  s=>s.identity.contract=address('e'),s=>s.identity.codeHash=hash('e'),s=>s.config.policy=hash('e'),s=>s.sources.rows[0].verification='verified',s=>s.sources.rows[0].points='20',
  s=>s.sources.rows[0].evidence.source_url='javascript:alert(1)',s=>s.sources.rows[0].evidence.theorem='Substituted',s=>s.sources.rows[0].source_hash=hash('f'),
  s=>s.authors.rows[0].claimed_wallet=address('d'),s=>s.authors.rows[0].unclaimed_points='0',s=>s.accounts.rows[0].points='999',
  s=>s.contributions.rows[0].attribution.route_hash=hash('f'),s=>s.contributions.rows[0].attribution.corrections[0].after[0].points='239',
  s=>s.contributions.rows[0].attribution.corrections[0].revision=2,s=>s.contributions.rows[0].record.evidence.contract=address('f'),
  s=>s.cases.rows[0].request.sources[0].source_hash=hash('f'),s=>s.cases.rows[0].status='accepted',s=>s.reads.pop(),s=>s.reads[0].call[0]='settle_attribution',
  s=>s.completedAt=new Date(Date.now()+120000).toISOString(),s=>s.accountsReconciled=false,s=>s.sources.offset=2,
 ];
 for(const change of mutations){const bad=structuredClone(s);change(bad);assert.throws(()=>validateFederationSnapshot(bad,problem),/Federation snapshot|Open ledger snapshot/);}
});

test('changed pages, failed native views and excessive capture intervals stop without retries',async()=>{
 const badPage=fixture({override:method=>method==='list_external_results'?{items:[],total:1,next_offset:1}:undefined});
 await assert.rejects(collectFederationSnapshot({problem,read:badPage.read}),/page changed/);assert.equal(badPage.calls.length,3);
 const fail=fixture({override:method=>{if(method==='get_external_result')throw Error('Provider rate limit');}});
 await assert.rejects(collectFederationSnapshot({problem,read:fail.read}),/Provider rate limit/);assert.equal(fail.calls.length,4);
 let now=Date.now();const slow=fixture();await assert.rejects(collectFederationSnapshot({problem,read:slow.read,now:()=>{const time=new Date(now).toISOString();now+=301000;return time;}}),/capture interval exceeded/);assert.equal(slow.calls.length,1);
});

test('dated published fallback never replaces a successful live view and cannot authorize claims',async()=>{
 const f=fixture(),snapshot=await collectFederationSnapshot({problem,read:f.read}),fail=async()=>{throw Error('Unavailable');};
 const live=await chooseFederationView({loadLive:async()=>snapshot,loadPublished:()=>assert.fail('Unexpected fallback')});
 const retained=await chooseFederationView({loadLive:fail,loadPublished:()=>assert.fail('Do not overwrite live'),current:live});assert.equal(retained.changed,false);assert.equal(retained.snapshot,snapshot);
 const published=await chooseFederationView({loadLive:fail,loadPublished:async()=>snapshot});assert.equal(published.mode,'published');
 assert.match(federationSnapshotLabel(snapshot),/Published federation snapshot from.*live unavailable/);assert.match(federationSnapshotLabel(snapshot),/not atomically/);assert.match(federationSnapshotLabel(snapshot),/cannot authorize a correction, claim, merge or award/);
 assert.equal(validateFederationAttribution(snapshot.contributions.rows[0].attribution,'pr-0').initial_pool,'400');
});

test('expired attribution is visible only with elapsed native deadline and terminal history',async()=>{
 const f=fixture();const c=f.cases[0];c.status='expired';c.review_deadline=at;c.history.push({event:'expired',round:0,at});
 const snap=await collectFederationSnapshot({problem,read:f.read});
 assert.equal(validateFederationSnapshot(snap,problem).cases.rows[0].status,'expired');
 for(const mutate of [v=>delete v.review_deadline,v=>v.review_deadline=at+1000,v=>v.history.pop(),v=>v.history.at(-1).round=1]){
  const copy=structuredClone(snap);mutate(copy.cases.rows[0]);assert.throws(()=>validateFederationSnapshot(copy,problem),/expired case/);
 }
});
