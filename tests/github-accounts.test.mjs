import test from 'node:test';
import assert from 'node:assert/strict';
import {openMigrationHash} from '../src/open-snapshot.mjs';
import {validateGitHubAccountsDeployment,githubAccountsConfig,validateGitHubAccountsConfig,collectGitHubAccountsSnapshot,
 validateGitHubAccountsSnapshot,githubAccountsCoverage,githubAccountsSnapshotLabel,chooseGitHubAccountsView,GITHUB_ACCOUNTS_READ_LIMIT} from '../src/github-accounts.mjs';

const address=n=>'0x'+n.repeat(40),hash=n=>n.repeat(64),commit=n=>n.repeat(40);
const problem={deployment:{chainId:61999,contract:address('1'),codeHash:hash('2'),problem:'p-vs-np',repository:'Owner/problem',branch:'research',
 verifier:address('3'),executor:address('4'),windowSeconds:300,minimumGitHubAccountAgeDays:30,legacyLedgers:[]},
 policyHash:hash('5'),policy:{objective:'Useful open research toward P versus NP.'},descriptor:{protocol:{commit:commit('6')}}};
const sourceConfig={version:5,problem:'p-vs-np',repository:'Owner/problem',branch:'research',verifier:address('3'),executor:address('4'),
 window:300,minimum_account_age_days:30,policy:hash('5'),objective:problem.policy.objective,legacy_ledgers:[]};
const deployment={version:1,chainId:61999,contract:address('7'),codeHash:hash('8'),sourceContract:address('1'),sourceCodeHash:hash('2'),
 sourceConfigHash:openMigrationHash(sourceConfig),problem:'p-vs-np',repository:'Owner/problem',policyHash:hash('5'),implementationCommit:commit('9')};
const config=githubAccountsConfig(deployment),checked=Math.floor(Date.now()/1000)-60;
const account=(id,changes={})=>({github_author_id:id,login:'User'+id,username_checked_at:checked,contribution_count:1,credited_count:1,formal_count:1,wallet_count:1,
 author_points:'400',impact_points:'0',returned_points:'80',note_points:'0',points:'400',...changes});
const fields=['author_points','impact_points','returned_points','note_points','points'];
const sum=rows=>Object.fromEntries(fields.map(key=>[key,String(rows.reduce((total,row)=>total+BigInt(row[key]),0n))]));
const baseAccounts=[account('17',{impact_points:'26',points:'426'}),account('18',{author_points:'374',returned_points:'54',points:'374'})];
function fixture({accounts=baseAccounts,sourceCount=accounts.reduce((n,row)=>n+Number(row.contribution_count),0),sourceTotals=sum(accounts),override}={}){
 const indexed=sum(accounts),indexedCount=accounts.reduce((n,row)=>n+Number(row.contribution_count),0);
 const state={...config,indexed_count:indexedCount,source_count:sourceCount,account_count:accounts.length,source_consistent:true,
  indexed_totals:indexed,source_totals:{...sourceTotals,reserved_points:'0',award_budgets:sourceTotals.points},
  complete:indexedCount===sourceCount&&fields.every(key=>indexed[key]===sourceTotals[key])};
 const calls=[];
 const read=async(method,args)=>{
  calls.push([method,args]);const changed=override?.(method,args,calls.length,state);if(changed!==undefined)return structuredClone(changed);
  if(method==='get_config')return structuredClone(config);
  if(method==='get_state')return structuredClone(state);
  if(method==='count_accounts')return BigInt(accounts.length);
  if(method==='list_accounts')return {items:accounts.slice(args[0],args[0]+args[1]).map(row=>row.github_author_id),total:BigInt(accounts.length),next_offset:null};
  if(method==='get_account')return structuredClone(accounts.find(row=>row.github_author_id===args[0]));
  assert.fail('Unexpected or mutating method: '+method);
 };
 const research={identity:{contract:problem.deployment.contract,chainId:61999,codeHash:problem.deployment.codeHash,policy:problem.policyHash,
  problem:'p-vs-np',repository:'Owner/problem',branch:'research',protocolCommit:problem.descriptor.protocol.commit},config:sourceConfig,count:String(sourceCount),
  points:{transferable:false,total_initial_points:sourceTotals.author_points,total_impact_points:sourceTotals.impact_points,total_returned_points:sourceTotals.returned_points,
   total_note_points:sourceTotals.note_points,total_awarded:sourceTotals.points,total_reserved_points:'0',total_award_budgets:sourceTotals.points}};
 return {accounts,state,read,calls,research};
}

test('deployment and native configuration bind the unchanged research source and implementation',()=>{
 assert.equal(validateGitHubAccountsDeployment(deployment,problem),deployment);
 assert.deepEqual(validateGitHubAccountsConfig({...config,version:1n},deployment),{...config,version:'1'});
 for(const change of [{version:2},{chainId:1},{contract:address('0')},{contract:deployment.sourceContract},{codeHash:'bad'},
  {sourceContract:address('a')},{sourceCodeHash:hash('a')},{sourceConfigHash:hash('a')},{problem:'another-problem'},
  {repository:'Other/problem'},{policyHash:hash('a')},{implementationCommit:'main'},{extra:true}]){
  assert.throws(()=>validateGitHubAccountsDeployment({...deployment,...change},problem),/GitHub account ledger:/);
 }
 for(const change of [{source_contract:address('a')},{source_config_hash:hash('a')},{policy:hash('a')},{repository:'Other/problem'},{extra:true}]){
  assert.throws(()=>validateGitHubAccountsConfig({...config,...change},deployment),/native configuration/);
 }
});

test('source configuration commitments include inherited source history',()=>{
 const predecessor={address:address('b'),snapshot_hash:hash('c')};
 const inherited={...problem,deployment:{...problem.deployment,predecessor}};
 const pin={...deployment,sourceConfigHash:openMigrationHash({...sourceConfig,predecessor})};
 assert.equal(validateGitHubAccountsDeployment(pin,inherited),pin);
 assert.throws(()=>validateGitHubAccountsDeployment(deployment,inherited),/configuration commitment/);
});

test('bounded native capture exports only on-chain profiles and reconciles source and account credit',async()=>{
 const f=fixture(),snapshot=await collectGitHubAccountsSnapshot({deployment,read:f.read});
 assert.equal(snapshot.readMode,'latest-final');assert.equal(snapshot.atomic,false);
 assert.equal(snapshot.count,'2');assert.equal(snapshot.accounts[0].login,'User17');
 assert.equal(snapshot.accounts[0].username_checked_at,checked);
 assert.deepEqual(f.calls.map(([method])=>method),['get_config','get_state','count_accounts','list_accounts','get_account','get_account','get_state']);
 assert.deepEqual(githubAccountsCoverage(snapshot,f.research),{complete:true,ranked:true,sourceMatches:true,accountsComplete:true,status:'complete',
  label:'Complete on-chain GitHub account credit reconciles with the research ledger. Profiles show their last on-chain username check.'});
 assert.match(githubAccountsSnapshotLabel(snapshot),/Published account snapshot from/);
 assert.match(githubAccountsSnapshotLabel(snapshot),/not atomically/);
 assert.match(githubAccountsSnapshotLabel(snapshot),/cannot authorize identities, merges or points/);
});

test('unsynchronized account credit remains visible but cannot rank',async()=>{
 const f=fixture({accounts:[account('17')],sourceCount:2,sourceTotals:sum(baseAccounts)}),snapshot=await collectGitHubAccountsSnapshot({deployment,read:f.read});
 const coverage=githubAccountsCoverage(snapshot,f.research);
 assert.equal(coverage.sourceMatches,true);assert.equal(coverage.accountsComplete,true);
 assert.equal(coverage.complete,false);assert.equal(coverage.ranked,false);assert.equal(coverage.status,'sync-pending');
});

test('incoming impact may create an account before its own source contribution is indexed',async()=>{
 const recipient=account('17',{contribution_count:0,credited_count:0,formal_count:0,author_points:'0',impact_points:'26',returned_points:'0',points:'26'});
 const f=fixture({accounts:[recipient,baseAccounts[1]],sourceCount:2,sourceTotals:sum(baseAccounts)});
 const snapshot=await collectGitHubAccountsSnapshot({deployment,read:f.read});
 assert.equal(snapshot.accounts[0].points,'26');assert.equal(snapshot.state.indexed_count,1);
 assert.equal(githubAccountsCoverage(snapshot,f.research).status,'sync-pending');
});

test('newest account page is bounded and complete native synchronization does not rank a partial list',async()=>{
 const accounts=Array.from({length:1000},(_,index)=>account(String(index+1)));
 const f=fixture({accounts}),snapshot=await collectGitHubAccountsSnapshot({deployment,read:f.read});
 assert.equal(f.calls.length,GITHUB_ACCOUNTS_READ_LIMIT);assert.equal(snapshot.accounts.length,64);assert.equal(snapshot.offset,936);
 assert.deepEqual(f.calls[3],['list_accounts',[936,64]]);assert.equal(snapshot.accounts[0].github_author_id,'937');
 assert.equal(snapshot.state.complete,true);assert.equal(githubAccountsCoverage(snapshot,f.research).status,'partial');
 assert.equal(githubAccountsCoverage(snapshot,f.research).ranked,false);
});

test('empty account ledger has four unsigned reads and no invented identity',async()=>{
 const f=fixture({accounts:[]}),snapshot=await collectGitHubAccountsSnapshot({deployment,read:f.read});
 assert.equal(f.calls.length,4);assert.deepEqual(snapshot.accounts,[]);assert.equal(githubAccountsCoverage(snapshot,f.research).complete,true);
});

test('research changes across capture intervals suppress ranking while wrong source scope is rejected',async()=>{
 const f=fixture(),snapshot=await collectGitHubAccountsSnapshot({deployment,read:f.read});
 const newer={...f.research,count:'3'};
 assert.equal(githubAccountsCoverage(snapshot,newer).status,'source-changed');
 const higher=structuredClone(f.research);higher.points.total_initial_points='1174';higher.points.total_awarded='1200';higher.points.total_award_budgets='1200';
 assert.equal(githubAccountsCoverage(snapshot,higher).ranked,false);
 for(const key of ['contract','codeHash','policy','repository']){
  const other=structuredClone(f.research);other.identity[key]=key==='contract'?address('a'):'wrong';
  assert.throws(()=>githubAccountsCoverage(snapshot,other),/research snapshot scope/);
 }
 const changed=structuredClone(f.research);changed.config.window=301;
 assert.throws(()=>githubAccountsCoverage(snapshot,changed),/research snapshot scope/);
});

test('profile, page, accounting and provenance substitutions fail closed',async()=>{
 const f=fixture(),snapshot=await collectGitHubAccountsSnapshot({deployment,read:f.read});
 for(const mutate of [
  s=>{s.identity.contract=address('a');},s=>{s.identity.sourceConfigHash=hash('a');},s=>{s.config.source_contract=address('a');},
  s=>{s.accounts[0].github_author_id=s.accounts[1].github_author_id;},s=>{s.accounts[0].login='javascript:alert(1)';},
  s=>{s.accounts[0].login='invalid--name';},
  s=>{s.accounts[0].github_author_id=String(2n**256n);},
  s=>{s.accounts[0].login=null;},s=>{s.accounts[0].username_checked_at=0;},s=>{s.accounts[0].username_checked_at=Math.floor(Date.now()/1000)+3600;},
  s=>{s.accounts[0].points='427';},s=>{s.accounts[0].returned_points='999';},s=>{s.accounts[0].formal_count=2;},
  s=>{s.accounts[0].wallet_count=0;},s=>{s.accounts[0].offchain_name='name';},s=>{s.count='3';},s=>{s.offset=1;},
  s=>{s.reads[4].call=['refresh_username',['17','0']];},s=>{s.reads[4].at='invalid';},s=>{s.completedAt=new Date(Date.now()+3600000).toISOString();},
  s=>{s.state.complete=false;},s=>{s.finalState.source_consistent=false;s.finalState.complete=false;},
 ]){const changed=structuredClone(snapshot);mutate(changed);assert.throws(()=>validateGitHubAccountsSnapshot(changed,deployment));}
 const unchecked=structuredClone(snapshot);unchecked.accounts[0].login=null;unchecked.accounts[0].username_checked_at=0;
 assert.equal(validateGitHubAccountsSnapshot(unchecked,deployment),unchecked);
});

test('capture detects changing source/account state and stops on provider failures without retry',async()=>{
 const changing=fixture({override:(method,args,index,state)=>method==='get_state'&&index>2?{...state,source_consistent:false,complete:false}:undefined});
 await assert.rejects(collectGitHubAccountsSnapshot({deployment,read:changing.read}),/state changed during capture/);
 const failing=fixture({override:method=>{if(method==='get_account')throw Error('provider unavailable');}});
 await assert.rejects(collectGitHubAccountsSnapshot({deployment,read:failing.read}),/provider unavailable/);
 assert.equal(failing.calls.length,5);
 const wrongPage=fixture({override:method=>method==='list_accounts'?{items:['17','17'],total:'2',next_offset:null}:undefined});
 await assert.rejects(collectGitHubAccountsSnapshot({deployment,read:wrongPage.read}),/account page changed/);
});

test('published fallback remains dated and never replaces the last successful live view',async()=>{
 const f=fixture(),snapshot=await collectGitHubAccountsSnapshot({deployment,read:f.read});
 const unavailable=async()=>{throw Error('offline');};
 const published=await chooseGitHubAccountsView({loadLive:unavailable,loadPublished:async()=>snapshot});
 assert.equal(published.mode,'published');assert.equal(published.unavailable,true);
 const live={mode:'live',snapshot};let fetched=false;
 const retained=await chooseGitHubAccountsView({loadLive:unavailable,loadPublished:async()=>{fetched=true;return snapshot;},current:live});
 assert.equal(fetched,false);assert.equal(retained.changed,false);assert.equal(retained.snapshot,snapshot);
 const none=await chooseGitHubAccountsView({loadLive:unavailable,loadPublished:unavailable});assert.equal(none.mode,'unavailable');
});
