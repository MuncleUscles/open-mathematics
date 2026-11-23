import {canonical,digest} from './security.mjs';
export class GitHub {
  constructor({repository,token,fetcher=fetch}){if(!/^[\w.-]+\/[\w.-]+$/.test(repository))throw Error('Repository enrollment required');this.repository=repository;this.token=token;this.fetcher=fetcher;}
  async request(path,{method='GET',body}={}){const r=await this.fetcher(`https://api.github.com/repos/${this.repository}${path}`,{method,headers:{Accept:'application/vnd.github+json',...(this.token?{Authorization:`Bearer ${this.token}`}:{ }),'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`GitHub ${r.status}`);return r.status===204?null:r.json();}
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
    return {enforce_admins:{enabled:sets.length>0},required_status_checks:{strict:checks.some(r=>r.parameters.strict_required_status_checks_policy),checks:checks.flatMap(r=>r.parameters.required_status_checks.map(c=>({context:c.context,app_id:c.integration_id})))}};
  }
  async branchHead(branch){const ref=await this.request(`/git/ref/heads/${encodeURIComponent(branch)}`);if(ref.object?.type!=='commit'||!/^[a-f0-9]{40}$/.test(ref.object.sha))throw Error('Canonical commit ref required');return ref.object.sha;}
  commit(sha){if(!/^[a-f0-9]{40}$/.test(sha))throw Error('Invalid merge commit');return this.request(`/git/commits/${sha}`);}
  async canonicalMerge(branch,merge){const c=await this.request(`/compare/${merge}...${encodeURIComponent(branch)}`);return ['ahead','identical'].includes(c.status)&&c.merge_base_commit?.sha===merge;}
  merge(n,head){return this.request(`/pulls/${n}/merge`,{method:'PUT',body:{sha:head,merge_method:'merge'}});}
}
// The caller supplies a chain adapter, never a user-provided verdict. The chain
// adapter must verify successful FINALIZED execution and the exact transaction.
export async function executeDecision({id,chain,github,journal}){
  const d=await chain.finalizedDecision(id);
  if(d.authority!=='genlayer-finalized'||d.leaderOnly!==false||!d.validatorAgreement||d.mode!=='live'||!d.executionSucceeded)throw Error('Finalized independent GenLayer judgment required');
  if(d.repository!==github.repository||d.id!==id)throw Error('Decision identity mismatch');
  if(d.status==='rejected')return {status:'rejected',reason:d.reason};
  if(d.status!=='approved'||d.openChallenges!==0||Date.now()<d.deadline)throw Error('Decision is not executable');
  const pr=await github.pr(d.pr);
  if(pr.head.sha!==d.head||(!pr.merged&&pr.base.sha!==d.base)||pr.base.ref!==d.branch)throw Error('Stale head or base: reverify and readjudicate');
  if(!pr.merged&&await github.branchHead(d.branch)!==d.base)throw Error('Canonical branch advanced: rebase, reverify and sign again');
  const policy=await github.protection(d.branch);
  if(policy.enforce_admins?.enabled!==true||!policy.required_status_checks?.strict||!policy.required_status_checks.checks?.some(c=>c.context==='open-mathematics/finalized'&&c.app_id===d.appId)||!policy.required_status_checks.checks?.some(c=>c.context==='open-mathematics/lean'&&c.app_id===d.verifierAppId))throw Error('Protected branch and app-bound checks required');
  // checkPublisher owns only this contract's check and must bind its external_id
  // to the receipt hash. It cannot publish the independent verifier's check.
  await chain.publishFinalCheck(d);
  const current=await github.pr(d.pr);
  if(current.head.sha!==d.head||current.base.ref!==d.branch||(!current.merged&&current.base.sha!==d.base))throw Error('PR changed before merge');
  if(!current.merged&&await github.branchHead(d.branch)!==d.base)throw Error('Canonical branch advanced before merge');
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
