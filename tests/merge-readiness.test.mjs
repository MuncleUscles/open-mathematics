import test from 'node:test';
import assert from 'node:assert/strict';
import {GitHub,executeDecision} from '../src/github.mjs';
import {recordOpenFailure} from '../github/open-worker.mjs';
import {FinalizedExecutionError} from '../github/runtime.mjs';

const head='a'.repeat(40),base='b'.repeat(40),merge='c'.repeat(40);
const receiptHash='0x'+'d'.repeat(64);
const finalCheck={id:42,name:'open-mathematics/finalized',head_sha:head,app:{id:123},
  external_id:receiptHash,status:'completed',conclusion:'success'};
const evidenceCheck={id:41,name:'open-mathematics/evidence',head_sha:head,app:{id:456},
  status:'completed',conclusion:'success'};

function fixture(){
  const calls={published:0,merged:0,credited:0,waited:[],journal:[],checks:0,pr:0};
  let elapsed=0;
  const decision={id:'claim',repository:'owned/research',pr:7,head,base,branch:'research',
    authority:'genlayer-finalized',leaderOnly:false,validatorAgreement:true,mode:'live',executionSucceeded:true,
    status:'approved',openChallenges:0,deadline:0,appId:123,verifierAppId:456,receiptHash};
  const policy={rulesDigest:'original',enforce_admins:{enabled:true},required_status_checks:{strict:true,
    checks:[{context:finalCheck.name,app_id:123},{context:evidenceCheck.name,app_id:456}]}};
  const pr=()=>({state:'open',merged:calls.merged>0,head:{sha:head},base:{sha:base,ref:'research'},
    mergeable:true,mergeable_state:'clean',merge_commit_sha:calls.merged?merge:null});
  const github={repository:decision.repository,
    pr:async()=>{calls.pr++;return pr();},branchHead:async()=>base,protection:async()=>structuredClone(policy),
    checks:async(_,name)=>{calls.checks++;return [structuredClone(name===finalCheck.name?finalCheck:evidenceCheck)];},
    merge:async(n,sha)=>{assert.equal(n,7);assert.equal(sha,head);calls.merged++;return {merged:true,sha:merge};},
    commit:async()=>({parents:[{sha:base},{sha:head}]}),canonicalMerge:async()=>true};
  const chain={finalizedDecision:async()=>decision,publishFinalCheck:async()=>{calls.published++;return structuredClone(finalCheck);},
    confirmMerge:async()=>{calls.credited++;}};
  return {id:decision.id,chain,github,evidenceCheck:evidenceCheck.name,
    journal:{finalizedCheck:async check=>calls.journal.push(check),record:async()=>{}},
    wait:async ms=>{calls.waited.push(ms);elapsed+=ms;},now:()=>elapsed,
    advance:ms=>{elapsed+=ms;},calls,pr,policy};
}

test('waits for exact check visibility and rules readiness, publishing only once',async()=>{
  const f=fixture();let attempt=0;
  f.github.checks=async(_,name)=>{
    if(name===finalCheck.name){attempt++;return attempt===1?[]:[finalCheck];}
    return [evidenceCheck];
  };
  f.github.pr=async()=>({...f.pr(),mergeable_state:attempt<2?'blocked':'clean'});
  assert.equal((await executeDecision(f)).status,'credited');
  assert.deepEqual(f.calls.waited,[5000,5000]);
  assert.deepEqual(f.calls.journal,[{id:42,head,receiptHash}]);
  assert.equal(f.calls.published,1);assert.equal(f.calls.merged,1);assert.equal(f.calls.credited,1);
});

test('an unknown mergeability result is polled without attempting a merge',async()=>{
  const f=fixture();let reads=0;
  f.github.pr=async()=>({...f.pr(),mergeable:++reads<3?null:true});
  await executeDecision(f);assert.equal(f.calls.waited.length,1);assert.equal(f.calls.merged,1);
});

test('head, PR base, branch head and protection changes during propagation stop execution',async()=>{
  for(const kind of ['head','base','branch','policy','rules']){
    const f=fixture();let changed=false;
    f.github.checks=async()=>[];
    f.wait=async()=>{changed=true;};
    f.github.pr=async()=>({...f.pr(),head:{sha:changed&&kind==='head'?'e'.repeat(40):head},
      base:{sha:changed&&kind==='base'?'e'.repeat(40):base,ref:'research'}});
    f.github.branchHead=async()=>changed&&kind==='branch'?'e'.repeat(40):base;
    f.github.protection=async()=>changed&&kind==='policy'?{}:
      {...f.policy,rulesDigest:changed&&kind==='rules'?'modified':f.policy.rulesDigest};
    await assert.rejects(executeDecision(f),/changed|advanced|Protected branch/);
    assert.equal(f.calls.merged,0,kind);assert.equal(f.calls.credited,0,kind);
  }
});

test('revalidates exact PR and protection after check reads immediately before merge',async()=>{
  for(const kind of ['head','base','branch','rules']){
    const f=fixture();let checksRead=false;
    f.github.checks=async(_,name)=>{checksRead=true;return [name===finalCheck.name?finalCheck:evidenceCheck];};
    f.github.pr=async()=>({...f.pr(),head:{sha:checksRead&&kind==='head'?'e'.repeat(40):head},
      base:{sha:checksRead&&kind==='base'?'e'.repeat(40):base,ref:'research'}});
    f.github.branchHead=async()=>checksRead&&kind==='branch'?'e'.repeat(40):base;
    f.github.protection=async()=>({...f.policy,rulesDigest:checksRead&&kind==='rules'?'changed':'original'});
    await assert.rejects(executeDecision(f),/changed|advanced/);assert.equal(f.calls.merged,0);
  }
});

test('wrong published check identity cannot enter the journal or merge',async()=>{
  for(const edit of [{id:0},{app:{id:999}},{head_sha:base},{external_id:'other'},
    {name:'unrelated'},{status:'in_progress'},{conclusion:'failure'}]){
    const f=fixture();f.chain.publishFinalCheck=async()=>({...finalCheck,...edit});
    await assert.rejects(executeDecision(f),/does not bind/);
    assert.equal(f.calls.journal.length,0);assert.equal(f.calls.merged,0);
  }
});

test('old, wrong-app, wrong-head, wrong-receipt or superseded checks cannot satisfy readiness',async()=>{
  const cases=[
    {final:[{...finalCheck,id:40}]},{final:[{...finalCheck,app:{id:999}}]},
    {final:[{...finalCheck,head_sha:base}]},{final:[{...finalCheck,external_id:'other'}]},
    {final:[finalCheck,{...finalCheck,id:43,conclusion:'failure'}]},
    {evidence:[{...evidenceCheck,app:{id:999}}]},
    {evidence:[evidenceCheck,{...evidenceCheck,id:43,conclusion:'failure'}]},
  ];
  for(const edited of cases){
    const f=fixture();f.github.checks=async(_,name)=>name===finalCheck.name?(edited.final||[finalCheck]):(edited.evidence||[evidenceCheck]);
    await assert.rejects(executeDecision(f),/timed out/);
    assert.equal(f.calls.merged,0);assert.equal(f.calls.credited,0);assert.equal(f.calls.published,1);
    assert.equal(f.calls.waited.reduce((sum,n)=>sum+n,0),60000);
  }
});

test('elapsed deadline stops even a clean snapshot after slow check reads',async()=>{
  const f=fixture();f.github.checks=async(_,name)=>{f.advance(31000);return [name===finalCheck.name?finalCheck:evidenceCheck];};
  await assert.rejects(executeDecision(f),/timed out/);assert.equal(f.calls.merged,0);
});

test('poll count remains bounded when an injected clock does not advance',async()=>{
  const f=fixture();f.now=()=>0;f.github.checks=async()=>[];
  await assert.rejects(executeDecision(f),/timed out/);assert.equal(f.calls.waited.length,12);assert.equal(f.calls.merged,0);
});

test('closed, draft and conflicting PRs fail immediately after publication',async()=>{
  for(const edit of [{state:'closed'},{draft:true},{mergeable:false}]){
    const f=fixture();f.github.pr=async()=>({...f.pr(),...edit});
    await assert.rejects(executeDecision(f),/mechanically mergeable/);assert.equal(f.calls.waited.length,0);assert.equal(f.calls.merged,0);
  }
});

test('a GitHub merge rejection is never retried or credited',async()=>{
  const f=fixture();let attempts=0;f.github.merge=async()=>{attempts++;throw Error('GitHub 405');};
  await assert.rejects(executeDecision(f),/GitHub 405/);assert.equal(attempts,1);assert.equal(f.calls.credited,0);
});

test('an already-merged exact PR recovers without waiting for check visibility',async()=>{
  const f=fixture();f.github.pr=async()=>({...f.pr(),merged:true,state:'closed',merge_commit_sha:merge,
    base:{sha:merge,ref:'research'},mergeable:null,mergeable_state:'unknown'});
  f.github.checks=async()=>{throw Error('Readiness is irrelevant after merge');};
  assert.equal((await executeDecision(f)).status,'credited');
  assert.equal(f.calls.merged,0);assert.equal(f.calls.credited,1);assert.deepEqual(f.calls.waited,[]);
});

test('the protection fingerprint includes review rules beyond the required check pair',async()=>{
  const github=new GitHub({repository:'owned/research'});let reviews=0;
  const rules=[...['deletion','non_fast_forward','pull_request'].map(type=>({type,ruleset_id:5})),
    {type:'required_status_checks',ruleset_id:5,parameters:{strict_required_status_checks_policy:true,
      required_status_checks:[{context:finalCheck.name,integration_id:123},{context:evidenceCheck.name,integration_id:456}]}}];
  github.request=async path=>path.startsWith('/rules/branches/')?rules:
    {enforcement:'active',bypass_actors:[],rules:[{type:'pull_request',parameters:{required_approving_review_count:reviews}}]};
  const before=await github.protection('research');reviews=1;const after=await github.protection('research');
  assert.deepEqual(before.required_status_checks,after.required_status_checks);
  assert.notEqual(before.rulesDigest,after.rulesDigest);
});

test('check snapshots require the complete bounded response and exact query',async()=>{
  const github=new GitHub({repository:'owned/research',fetcher:async url=>{
    assert.equal(url,`https://api.github.com/repos/owned/research/commits/${head}/check-runs?check_name=open-mathematics%2Ffinalized&filter=latest&per_page=100`);
    return new Response(JSON.stringify({total_count:1,check_runs:[finalCheck]}));
  }});
  assert.deepEqual(await github.checks(head,finalCheck.name),[finalCheck]);
  for(const result of [{total_count:101,check_runs:[]},{total_count:1,check_runs:[]},{check_runs:[]},{total_count:0,check_runs:null}]){
    github.request=async()=>result;await assert.rejects(github.checks(head,finalCheck.name),/Complete check-run snapshot/);
  }
});

test('post-approval GitHub errors preserve finalized success and append operational evidence',async()=>{
  const report={id:'claim',transactions:{},attestation:{},record:{status:'approved'}};
  const checks=[];let saved=0;const marker={id:42,head,receiptHash};
  const run=()=>recordOpenFailure({report,error:Error('GitHub 405'),finalizedCheck:marker,
    save:async()=>{saved++;},check:async(...args)=>checks.push(args)});
  await run();await run();
  assert.equal(report.status,'approved');assert.equal(report.error,'GitHub 405');
  assert.equal(report.blockedConsensus,false);assert.equal(report.operationalErrors.length,2);
  assert.deepEqual(report.operationalErrors[0].finalizedCheck,marker);assert.equal(saved,2);assert.deepEqual(checks,[]);
});

test('a saved check alone or expired native record does not suppress failure publication',async()=>{
  for(const status of ['approved','expired']){
    const marker={id:42,head,receiptHash};
    const report={id:'claim',transactions:{},attestation:{},record:{status},finalizedCheck:marker};
    const checks=[];
    await recordOpenFailure({report,error:Error('processing stopped'),
      ...(status==='expired'?{finalizedCheck:marker}:{}),save:async()=>{},check:async(...args)=>checks.push(args)});
    assert.equal(checks.length,1);assert.equal(checks[0][1],'failure');assert.equal(report.operationalErrors,undefined);
  }
});

test('a save failure immediately after publishing cannot replace the valid native check',async()=>{
  const f=fixture(),report={id:'claim',transactions:{},attestation:{},record:{status:'approved'}};
  let marker;
  f.journal.finalizedCheck=async check=>{marker=check;throw Error('GitHub 503');};
  let failure;try{await executeDecision(f);}catch(error){failure=error;}
  assert.equal(failure.message,'GitHub 503');
  const checks=[];
  await recordOpenFailure({report,error:failure,finalizedCheck:marker,save:async()=>{},check:async(...args)=>checks.push(args)});
  assert.equal(f.calls.published,1);assert.equal(f.calls.merged,0);assert.deepEqual(checks,[]);
  assert.equal(report.operationalErrors[0].message,'GitHub 503');
});

test('finalized native registration rejection still publishes its specific failure',async()=>{
  const error=new FinalizedExecutionError({hash:receiptHash,method:'register',statusName:'FINALIZED'},'duplicate');
  error.stage='register';
  const report={id:'claim',transactions:{register:{hash:receiptHash,failedReceipt:{hash:receiptHash}}},attestation:{}};
  const checks=[];
  await recordOpenFailure({report,error,save:async()=>{},check:async(...args)=>checks.push(args)});
  assert.equal(report.status,'rejected');assert.ok(report.completedAt);
  assert.deepEqual(checks,[['open-mathematics/finalized','failure','GenLayer registration rejected','duplicate',receiptHash]]);
  assert.equal(report.operationalErrors,undefined);
});
