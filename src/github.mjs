import {canonical,digest} from './security.mjs';

async function boundedJSON(response, maximum) {
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maximum)){
    response.body?.cancel().catch(()=>{});
    throw Error('GitHub response exceeds the byte limit');
  }
  if(!response.body?.getReader)throw Error('Readable GitHub response required');
  const reader=response.body.getReader(),chunks=[];let total=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      if(!(value instanceof Uint8Array))throw Error('Invalid GitHub response bytes');
      total+=value.byteLength;
      if(total>maximum)throw Error('GitHub response exceeds the byte limit');
      chunks.push(value);
    }
    const bytes=new Uint8Array(total);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
  }finally{reader.cancel().catch(()=>{});reader.releaseLock();}
}

export class GitHub {
  constructor({repository,token,fetcher=fetch}){if(!/^[\w.-]+\/[\w.-]+$/.test(repository))throw Error('Repository enrollment required');this.repository=repository;this.token=token;this.fetcher=fetcher;}
  async request(path,{method='GET',body,maxResponseBytes}={}){
    if(maxResponseBytes!==undefined&&(!Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<1))throw Error('Positive GitHub response byte limit required');
    const r=await this.fetcher(`https://api.github.com/repos/${this.repository}${path}`,{method,headers:{Accept:'application/vnd.github+json',...(this.token?{Authorization:`Bearer ${this.token}`}:{ }),'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),...(maxResponseBytes===undefined?{}:{redirect:'error'})});
    if(!r.ok)throw Error(`GitHub ${r.status}`);
    return r.status===204?null:maxResponseBytes===undefined?r.json():boundedJSON(r,maxResponseBytes);
  }
  pr(n){if(!Number.isSafeInteger(n)||n<1)throw Error('Invalid PR');return this.request(`/pulls/${n}`);}
  async bindAuthor({claim,signature},{commentId,createdAt}={}){
    if(!Number.isSafeInteger(commentId)||commentId<1||typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt)))
      throw Error('Selected claim comment ID and original creation time required');
    if(claim.repository!==this.repository)throw Error('Claim repository mismatch');
    const [pr,comment]=await Promise.all([this.pr(claim.pr),this.request(`/issues/comments/${commentId}`)]);
    if(pr?.number!==claim.pr||pr.base?.repo?.full_name!==this.repository||pr.head?.sha!==claim.head)throw Error('Stale claim');
    if(comment?.id!==commentId||comment.issue_url!==`https://api.github.com/repos/${this.repository}/issues/${claim.pr}`||
       !Number.isSafeInteger(pr.user?.id)||pr.user.id<1||comment.user?.id!==pr.user.id)
      throw Error('Selected comment does not belong to this PR author');
    if(comment.created_at!==createdAt||comment.updated_at!==createdAt||typeof comment.body!=='string'||comment.body.length>20000)
      throw Error('Selected claim comment was edited or its original creation time does not match');
    const match=comment.body.match(/^Open-Mathematics-Claim: ([a-f0-9]{64})\n```json\n([\s\S]+)\n```\s*$/);
    if(!match||match[1]!==digest(claim))throw Error('Selected comment must contain the original signed claim');
    let envelope;
    try{envelope=JSON.parse(match[2]);}catch{throw Error('Selected comment has malformed signed claim JSON');}
    if(!envelope||Object.keys(envelope).length!==2||!Object.hasOwn(envelope,'claim')||!Object.hasOwn(envelope,'signature')||
       typeof signature!=='string'||envelope.signature!==signature||canonical(envelope.claim)!==canonical(claim))
      throw Error('Selected comment signed claim has changed');
    return pr;
  }
  async protection(branch){
    // Ruleset reads need only metadata permission; no administration token in CI.
    const rules=await this.request(`/rules/branches/${encodeURIComponent(branch)}?per_page=100`);
    if(rules.length===100)throw Error('Too many branch rules to audit');
    const sets=await Promise.all([...new Set(rules.map(r=>r.ruleset_id))].map(id=>this.request(`/rulesets/${id}`)));
    if(sets.some(s=>s.enforcement!=='active'||s.bypass_actors?.length))throw Error('Active rules without bypass required');
    if(!rules.some(r=>r.type==='deletion')||!rules.some(r=>r.type==='non_fast_forward')||!rules.some(r=>r.type==='pull_request'))throw Error('PR-only protected branch required');
    const checks=rules.filter(r=>r.type==='required_status_checks');
    return {rulesDigest:digest({rules,sets}),enforce_admins:{enabled:sets.length>0},required_status_checks:{strict:checks.some(r=>r.parameters.strict_required_status_checks_policy),checks:checks.flatMap(r=>r.parameters.required_status_checks.map(c=>({context:c.context,app_id:c.integration_id})))}};
  }
  async checks(head,name){
    if(!/^[a-f0-9]{40}$/.test(head))throw Error('Invalid check head');
    const result=await this.request(`/commits/${head}/check-runs?check_name=${encodeURIComponent(name)}&filter=latest&per_page=100`);
    if(!Number.isSafeInteger(result.total_count)||result.total_count<0||result.total_count>100||
       !Array.isArray(result.check_runs)||result.check_runs.length!==result.total_count)throw Error('Complete check-run snapshot required');
    return result.check_runs;
  }
  async branchHead(branch){const ref=await this.request(`/git/ref/heads/${encodeURIComponent(branch)}`);if(ref.object?.type!=='commit'||!/^[a-f0-9]{40}$/.test(ref.object.sha))throw Error('Canonical commit ref required');return ref.object.sha;}
  commit(sha){if(!/^[a-f0-9]{40}$/.test(sha))throw Error('Invalid merge commit');return this.request(`/git/commits/${sha}`);}
  async canonicalMerge(branch,merge){const c=await this.request(`/compare/${merge}...${encodeURIComponent(branch)}`);return ['ahead','identical'].includes(c.status)&&c.merge_base_commit?.sha===merge;}
  merge(n,head){return this.request(`/pulls/${n}/merge`,{method:'PUT',body:{sha:head,merge_method:'merge'}});}
}

function requireMergePolicy(policy,d,evidenceCheck){
  if(policy.enforce_admins?.enabled!==true||!policy.required_status_checks?.strict||!policy.required_status_checks.checks?.some(c=>c.context==='open-mathematics/finalized'&&c.app_id===d.appId)||!policy.required_status_checks.checks?.some(c=>c.context===evidenceCheck&&c.app_id===d.verifierAppId))throw Error('Protected branch and app-bound checks required');
}

function successfulCheck(check,{head,name,appId}){
  return check?.head_sha===head&&check.name===name&&check.app?.id===appId&&check.status==='completed'&&check.conclusion==='success';
}

function latestCheck(checks,{head,name,appId}){
  const matching=checks.filter(check=>check.head_sha===head&&check.name===name&&check.app?.id===appId);
  if(matching.some(check=>!Number.isSafeInteger(check.id)||check.id<1))throw Error('Invalid check-run identity');
  return matching.reduce((latest,check)=>!latest||check.id>latest.id?check:latest,null);
}

async function waitForMerge({d,github,policy,finalCheck,evidenceCheck,wait,now}){
  const deadline=now()+60000;
  const timeout=()=>{throw Error('GitHub merge readiness timed out; finalized approval remains valid for this exact head');};
  async function snapshot(){
    const current=await github.pr(d.pr);
    if(current.head.sha!==d.head||current.base.ref!==d.branch||(!current.merged&&current.base.sha!==d.base))throw Error('PR changed before merge');
    if(!current.merged&&await github.branchHead(d.branch)!==d.base)throw Error('Canonical branch advanced before merge');
    const currentPolicy=await github.protection(d.branch);
    requireMergePolicy(currentPolicy,d,evidenceCheck);
    if(canonical(currentPolicy)!==canonical(policy))throw Error('Branch protection changed before merge');
    if(!current.merged&&(current.state!=='open'||current.draft===true||current.mergeable===false))throw Error('PR not mechanically mergeable');
    return current;
  }
  // GitHub's check store and rules engine can lag the successful POST. Only
  // observe here: never replace a native decision or bypass repository rules.
  for(let attempt=0;attempt<13;attempt++){
    if(attempt)await wait(Math.min(5000,Math.max(0,deadline-now())));
    if(now()>=deadline)timeout();
    const current=await snapshot();
    if(current.merged)return current;
    const [finalChecks,evidenceChecks]=await Promise.all([
      github.checks(d.head,'open-mathematics/finalized'),github.checks(d.head,evidenceCheck),
    ]);
    const finalBinding={head:d.head,name:'open-mathematics/finalized',appId:d.appId};
    const evidenceBinding={head:d.head,name:evidenceCheck,appId:d.verifierAppId};
    const observed=latestCheck(finalChecks,finalBinding);
    const visible=observed?.id===finalCheck.id&&observed.external_id===d.receiptHash&&successfulCheck(observed,finalBinding);
    const verified=successfulCheck(latestCheck(evidenceChecks,evidenceBinding),evidenceBinding);
    if(now()>=deadline)timeout();
    if(visible&&verified&&current.mergeable===true&&current.mergeable_state==='clean'){
      const ready=await snapshot();
      if(now()>=deadline)timeout();
      if(ready.merged||(ready.mergeable===true&&ready.mergeable_state==='clean'))return ready;
    }
  }
  timeout();
}
// The caller supplies a chain adapter, never a user-provided verdict. The chain
// adapter must verify successful FINALIZED execution and the exact transaction.
export async function executeDecision({id,chain,github,journal,evidenceCheck='open-mathematics/lean',wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}){
  const d=await chain.finalizedDecision(id);
  if(d.authority!=='genlayer-finalized'||d.leaderOnly!==false||!d.validatorAgreement||d.mode!=='live'||!d.executionSucceeded)throw Error('Finalized independent GenLayer judgment required');
  if(d.repository!==github.repository||d.id!==id)throw Error('Decision identity mismatch');
  if(d.status==='rejected')return {status:'rejected',reason:d.reason};
  if(d.status!=='approved'||d.openChallenges!==0||Date.now()<d.deadline)throw Error('Decision is not executable');
  const pr=await github.pr(d.pr);
  if(pr.head.sha!==d.head||(!pr.merged&&pr.base.sha!==d.base)||pr.base.ref!==d.branch)throw Error('Stale head or base: reverify and readjudicate');
  if(!pr.merged&&await github.branchHead(d.branch)!==d.base)throw Error('Canonical branch advanced: rebase, reverify and sign again');
  const policy=await github.protection(d.branch);
  requireMergePolicy(policy,d,evidenceCheck);
  // checkPublisher owns only this contract's check and must bind its external_id
  // to the receipt hash. It cannot publish the independent verifier's check.
  const finalCheck=await chain.publishFinalCheck(d);
  if(!Number.isSafeInteger(finalCheck?.id)||finalCheck.id<1||typeof d.receiptHash!=='string'||!d.receiptHash||
     finalCheck.external_id!==d.receiptHash||!successfulCheck(finalCheck,{head:d.head,name:'open-mathematics/finalized',appId:d.appId}))
    throw Error('Finalized check does not bind the approved head and receipt');
  await journal.finalizedCheck?.({id:finalCheck.id,head:d.head,receiptHash:d.receiptHash});
  const current=await waitForMerge({d,github,policy,finalCheck,evidenceCheck,wait,now});
  let merged;
  if(current.merged){merged={merged:true,sha:current.merge_commit_sha};}
  else {if(current.state!=='open'||current.mergeable!==true)throw Error('PR not mechanically mergeable');merged=await github.merge(d.pr,d.head);}
  if(!merged.merged||!merged.sha)throw Error('Merge not confirmed');
  const commit=await github.commit(merged.sha);
  if(commit.parents?.length!==2||commit.parents[0].sha!==d.base||commit.parents[1].sha!==d.head)throw Error('Merge commit does not bind approved base and head');
  const confirmed=await github.pr(d.pr);
  if(!confirmed.merged||confirmed.base.ref!==d.branch||confirmed.head.sha!==d.head||confirmed.merge_commit_sha!==merged.sha||!await github.canonicalMerge(d.branch,merged.sha))throw Error('Merge is not confirmed on the canonical branch');
  await journal.record(id,merged.sha);
  // Persisted journal + on-contract idempotency recover a crash after merge.
  await chain.confirmMerge(id,d.head,merged.sha);
  return {status:'credited',mergeCommit:merged.sha};
}
