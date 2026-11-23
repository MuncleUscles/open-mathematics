// Read-only internal consistency audit. This is deliberately not an importer,
// complete state export, cutoff attestation, or deployment authorization.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validatedCommunitySnapshot} from '../../public/community-snapshot.mjs';

const terminalCases=new Set(['settled','expired','withdrawn']);
const maxUint256=(1n<<256n)-1n;
const address=x=>typeof x==='string'&&/^0x[0-9a-fA-F]{40}$/.test(x)?x.toLowerCase():null;
const hash=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function unsigned(value){
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return BigInt(value);
 if(typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value))return BigInt(value);
 return null;
}
const nativeUint=value=>{const n=unsigned(value);return n!==null&&n<=maxUint256?n:null;};
const add=(map,key,value)=>map.set(key,(map.get(key)||0n)+value);
const total=map=>[...map.values()].reduce((a,b)=>a+b,0n);

export function auditSnapshot(snapshot,deployment){
 const issues=[],requirements=[
  'A published sequential latest-final read bundle is not an atomic or authoritative migration cutoff.',
  'Enumerate all case pages from offset zero; list_cases and list_review_cases expose only the latest 100.',
  'Independently attest exact source code, roles, policy, dispute window, imported snapshot and storage indexes at the chosen cutoff.',
  'Reconcile each reporter active-case counter and all wallet balances, including claimed external authors, against complete source state.',
  'Preserve original record digests, evidence policies, case identities, source identities, histories and successful/failed receipt lineage.',
  'Drain or explicitly transition in-flight proofs, reviews and cases; stop old verifier/executor writes and publish a policy for post-cutoff self-service writes.',
  'Implement a separately reviewed one-time exact v3 importer and post-import equivalence checks; the existing fixed v2 importer is insufficient.',
 ];
 const result={scope:'Internal consistency of a historical display bundle only',readyForMigration:false,consistent:false,issues,unverifiedRequirements:requirements};
 if(!validatedCommunitySnapshot(snapshot,deployment)){issues.push('Snapshot is malformed or does not bind the active v3 deployment.');return result;}
 const records=new Map(snapshot.records.map(r=>[r.evidence.id,r]));
 const authors=new Map(snapshot.authors.map(a=>[a.id,a]));
 const cases=new Map(snapshot.cases.map(c=>[c.id,c]));
 const wallets=new Map((snapshot.walletBalances||[]).map(x=>[address(x.wallet),x.value]));
 const initial=new Map(),impact=new Map(),external=new Map(),historicalByWallet=new Map(),statements=new Set();
 const priorCredited=new Set(),appliedCases=new Set();
 let historical=0n,retained=0n,revoked=0n;
 let outsideNativeRange=false;
 function issue(test,message){if(!test)issues.push(message);}
 function amount(value){
  const parsed=unsigned(value);
  if(parsed===null||parsed>maxUint256)outsideNativeRange=true;
  return parsed??0n;
 }
 for(const r of snapshot.records){
  issue(r.status==='credited',`Contribution ${r.evidence.id} is not settled/credited; a transition policy is needed.`);
  if(r.status!=='credited')continue;
  issue(hash(r.evidence.statement_hash)&&!statements.has(r.evidence.statement_hash),'Credited statement fingerprints are missing or duplicated.');
  statements.add(r.evidence.statement_hash);
  const award=amount(r.credited_points);
  historical+=award;
  add(historicalByWallet,address(r.evidence.wallet),award);
  const dependencies=r.evidence.dependencies;
  issue(new Set(dependencies).size===dependencies.length&&dependencies.every(id=>priorCredited.has(id)),
   `Contribution ${r.evidence.id} has a duplicate dependency or one outside its earlier credited records.`);
  priorCredited.add(r.evidence.id);
 }
 for(const {id,value:p} of snapshot.provenances){
  const r=records.get(id),original=amount(p.original_initial_points),kept=amount(p.current_initial_points),lost=amount(p.revoked_points);
  const assigned=p.external_allocations.reduce((n,a)=>n+amount(a.points),0n);
  issue(original===amount(r.credited_points),`Provenance ${id} changed its original award.`);
  issue(kept+assigned+lost===original,`Provenance ${id} does not conserve its original initial budget.`);
  issue(amount(p.version)===BigInt(p.corrections.length),`Provenance ${id} has inconsistent correction history length.`);
  for(const [index,correction] of p.corrections.entries()){
   const c=cases.get(correction.case);
   issue(c?.kind==='attribution'&&c.target===id&&c.status==='settled'&&c.verdict?.apply===true&&
    !appliedCases.has(c.id)&&nativeUint(c.revision)===BigInt(index)&&nativeUint(correction.version)===BigInt(index+1),
    `Provenance ${id} correction lacks a unique captured settled attribution case for its revision.`);
   if(c)appliedCases.add(c.id);
  }
  add(initial,address(r.evidence.wallet),kept);retained+=kept;revoked+=lost;
  const seen=new Set();
  for(const a of p.external_allocations){
   issue(authors.has(a.author_id)&&!seen.has(a.author_id),`Provenance ${id} contains an unknown or duplicate external author allocation.`);
   seen.add(a.author_id);add(external,a.author_id,amount(a.points));
  }
 }
 issue(snapshot.problem.status==='open'&&!snapshot.problem.resolution,'This draft audit supports an open problem only; resolution allocations require a separate reconciliation.');
 const indexedSolutions=new Set(snapshot.problem.external_solutions);
 issue(indexedSolutions.size===snapshot.problem.external_solutions.length,'Problem contains duplicate external-solution references.');
 for(const id of indexedSolutions)issue(cases.get(id)?.kind==='external-solution',`Problem refers to external case ${id} outside the captured history.`);
 const impactViews=new Map((snapshot.impacts||[]).map(x=>[x.id,x.value]));
 for(const [id,r] of records){
  const v=impactViews.get(id);
  issue(!!v,`Contribution ${id} has no captured impact view.`);
  if(!v||v.status==='not-requested')continue;
  issue(v.status==='settled',`Impact ${id} is in flight and cannot be treated as settled.`);
  if(v.status!=='settled')continue;
  issue(hash(r.digest)&&v.source_digest===r.digest,`Impact ${id} is not bound to its downstream record digest.`);
  const downstreamWallet=address(r.evidence.wallet),downstreamController=nativeUint(r.evidence.github_author_id);
  const eligible=new Map(v.eligible.map(row=>[row.id,row]));
  const expectedEligible=new Map(),seenUses=new Set();
  const verifiedUses=r.evidence.verified_dependencies;
  issue(verifiedUses===undefined||Array.isArray(verifiedUses),`Impact ${id} has a malformed verified dependency list.`);
  for(const use of Array.isArray(verifiedUses)?verifiedUses:[]){
   const previous=records.get(use?.id);
   if(!object(use)||previous?.status!=='credited'||!r.evidence.dependencies.includes(use.id)||seenUses.has(use.id)||
    use.proof_body_use!==true||!hash(previous.evidence.artifact_hash)||use.artifact_hash!==previous.evidence.artifact_hash){
    issues.push(`Impact ${id} has a missing, duplicate or mismatched verified dependency artifact.`);continue;
   }
   seenUses.add(use.id);
   const wallet=address(previous.evidence.wallet);
   if(wallet===downstreamWallet)continue;
   const controllerValue=previous.evidence.github_author_id??previous.migration?.github_author_id;
   const controller=nativeUint(controllerValue);
   const shared=downstreamController!==null&&downstreamController===controller;
   expectedEligible.set(use.id,shared);
   const row=eligible.get(use.id);
   const sameController=controllerValue==null?row?.github_author_id===null:
    controller!==null&&controller>0n&&nativeUint(row?.github_author_id)===controller;
   issue(downstreamController!==null&&downstreamController>0n&&row&&address(row.wallet)===wallet&&sameController&&
    row.shared_github_author===shared&&isDeepStrictEqual(row.use,use),
    `Impact ${id} eligibility does not match the captured verified dependency ${use.id}.`);
  }
  issue(eligible.size===v.eligible.length&&eligible.size===expectedEligible.size,
   `Impact ${id} eligible recipients differ from its verified direct dependencies.`);
  const seen=new Set();let paid=0n,sharedPaid=0n;
  for(const a of v.allocations){
   const previous=records.get(a.id),value=amount(a.band)*100n;
   issue(previous?.status==='credited'&&!seen.has(a.id)&&eligible.has(a.id)&&expectedEligible.has(a.id),
    `Impact ${id} has a missing, duplicate or ineligible recipient.`);
   seen.add(a.id);
   if(previous){
    issue(address(previous.evidence.wallet)!==downstreamWallet,`Impact ${id} pays its own downstream wallet.`);
    add(impact,address(previous.evidence.wallet),value);
   }
   paid+=value;
   if(expectedEligible.get(a.id))sharedPaid+=value;
  }
  const budget=amount(v.budget),award=amount(r.credited_points);
  issue(paid===amount(v.paid_points)&&paid<=budget&&budget===(award<300n?award:300n),
   `Impact ${id} paid amount differs from its bounded allocations.`);
  issue(sharedPaid<=100n,`Impact ${id} exceeds the shared GitHub controller cap.`);
 }
 let unclaimed=0n;
 for(const [id,a] of authors){
  const allocated=external.get(id)||0n;
  if(a.claimed_wallet===null){
   issue(amount(a.unclaimed_points)===allocated,`Author ${id} unclaimed balance differs from captured allocations.`);
   unclaimed+=amount(a.unclaimed_points);
  }else{
   issue(amount(a.unclaimed_points)===0n,`Claimed author ${id} retains an unclaimed balance.`);
   add(initial,address(a.claimed_wallet),allocated);
   const latest=a.claim_history.at(-1),claim=cases.get(latest?.case);
   issue(!!latest&&address(latest.wallet)===address(a.claimed_wallet)&&typeof a.identity_subject==='string'&&
    a.identity_subject.length>0&&latest.identity_subject===a.identity_subject&&a.verified_subject===a.identity_subject&&
    claim?.kind==='authorship'&&claim.target===id&&claim.status==='settled'&&claim.verdict?.approve===true&&
    address(claim.reporter)===address(a.claimed_wallet)&&hash(latest.attestation_hash)&&
    latest.attestation_hash===claim.attestation_hash&&claim.attestation?.identity_subject===a.identity_subject&&
    claim.attestation.authorship_verified===true,`Author ${id} binding is not supported by captured settled claim history.`);
  }
 }
 for(const c of snapshot.cases){
  issue(terminalCases.has(c.status),`Case ${c.id} is in flight and needs an explicit migration transition.`);
  if(c.kind==='attribution'){
   issue(records.get(c.target)?.status==='credited',`Case ${c.id} targets an uncaptured contribution.`);
   if(c.status==='settled'&&c.verdict?.apply===true)issue(appliedCases.has(c.id),`Case ${c.id} has no captured attribution correction.`);
  }
  if(c.kind==='authorship')issue(authors.has(c.target),`Case ${c.id} targets an uncaptured author.`);
  if(c.kind==='external-solution'){
   const admitted=object(c.attestation)&&hash(c.attestation_hash);
   const mustHaveAttestation=['verified','provisional','challenged','settled'].includes(c.status);
   issue(c.target===snapshot.problem.id&&indexedSolutions.has(c.id)===admitted&&(!mustHaveAttestation||admitted),
    `External-solution case ${c.id} disagrees with its problem's admitted history.`);
  }
 }
 for(const a of snapshot.affiliations){
  const last=a.history.at(-1);
  issue(last?.side===a.side&&String(last.at)===String(a.changed_at),'An affiliation disagrees with its latest history entry.');
 }
 const allWallets=new Set([...initial.keys(),...impact.keys(),...wallets.keys()]);
 const laterImpact=total(impact),reconstructed=total(initial)+laterImpact+unclaimed;
 for(const wallet of allWallets){
  const actual=wallets.get(wallet),wantedInitial=initial.get(wallet)||0n,wantedImpact=impact.get(wallet)||0n;
  issue(!!actual,`A contributor or claimed-author wallet is missing its balance view: ${wallet}.`);
  if(!actual)continue;
  issue(amount(actual.initial_points)===wantedInitial&&amount(actual.impact_points)===wantedImpact&&amount(actual.points)===wantedInitial+wantedImpact,`Wallet accounting does not reconcile: ${wallet}.`);
  issue(amount(actual.historical_initial_points)===(historicalByWallet.get(wallet)||0n),`Wallet historical awards do not reconcile: ${wallet}.`);
  issue(amount(actual.total_awarded)===reconstructed&&amount(actual.total_impact_points)===laterImpact&&amount(actual.total_historical_initial_awarded)===historical,'Captured views disagree on conserved global totals.');
 }
 issue(!outsideNativeRange,'A captured amount or revision exceeds the native uint256 range.');
 issue(reconstructed<=1000000n,'Reconstructed points exceed the pilot issuance cap.');
 result.consistent=issues.length===0;
 result.source={contract:snapshot.contract,chainId:snapshot.chainId,codeHash:snapshot.codeHash,policy:snapshot.policy,collectedAt:snapshot.collectedAt};
 result.counts={contributions:records.size,cases:cases.size,authors:authors.size,affiliations:snapshot.affiliations.length,walletViews:wallets.size};
 result.accounting={historicalInitial:String(historical),retainedInitial:String(retained),externalAllocated:String(total(external)),unclaimed:String(unclaimed),revoked:String(revoked),laterImpact:String(laterImpact),total:String(reconstructed)};
 return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const input=path.resolve(process.argv[2]||path.join(root,'public/community-snapshot.json'));
 if(fs.statSync(input).size>8*1024*1024)throw Error('Snapshot exceeds the bounded audit size');
 const bytes=fs.readFileSync(input),snapshot=JSON.parse(bytes),deployment=JSON.parse(fs.readFileSync(path.join(root,'public/deployment.json')));
 const report=auditSnapshot(snapshot,deployment);
 report.inputSha256=createHash('sha256').update(bytes).digest('hex');
 console.log(JSON.stringify(report,null,2));
 process.exitCode=report.consistent?0:1;
}
