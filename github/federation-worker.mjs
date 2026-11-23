// Trusted, resumable federation operations. Source registration is documentary;
// this worker cannot decide mathematical merit, allocate points, or merge a PR.
import {canonical,digest} from '../src/security.mjs';

const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const uint=x=>Number.isSafeInteger(Number(x))&&Number(x)>=0&&/^(0|[1-9][0-9]*)$/.test(String(x));
export function federationJournalFile(contract,name){
 if(!/^0x[a-fA-F0-9]{40}$/.test(contract)||!(/^[a-f0-9]{64}\.json$/).test(name))throw Error('Exact federation journal identity required');
 return 'reports/federation-'+contract.slice(2).toLowerCase()+'-'+name;
}
export function authorClaimPreflight(claim,{operation,windowSeconds,hasIntent=false,now=Date.now()}){
 if(!claim||!uint(claim.expiry)||!uint(claim.deadline)||!['verify','settle'].includes(operation)||!uint(windowSeconds))throw Error('Exact native identity state required');
 if(hasIntent)return {recoverOnly:claim.status==='settled'};
 if(operation==='verify'){
  if(claim.status!=='submitted'||Number(claim.expiry)*1000<=now+(Number(windowSeconds)+10)*1000)throw Error('Submitted author claim with time for the full challenge window required');
  return {recoverOnly:false};
 }
 if(claim.status==='settled')return {recoverOnly:true};
 if(claim.status!=='provisional'||Number(claim.expiry)*1000<=now+10000)throw Error('Unexpired provisional author claim required for settlement');
 if(now<(Number(claim.deadline)+2)*1000)return {wait:true,resumeAfter:new Date((Number(claim.deadline)+2)*1000).toISOString()};
 return {recoverOnly:false};
}
export function nativeExternalEvidence(e){
 const result={...e};
 for(const key of ['repository_id','pr','github_author_id']){
  if(!uint(result[key])||Number(result[key])===0)throw Error('Safe positive GitHub identifier required');
  result[key]=Number(result[key]);
 }
 return result;
}
export function federationCaseAttestation(c,sources){
 if(!c||c.status!=='submitted'||!uint(c.revision)||!hash(c.request_hash)||!Array.isArray(c.request?.sources)||c.request.sources.length<1||c.request.sources.length>4)throw Error('Submitted attribution case required');
 if(sources.length!==c.request.sources.length)throw Error('Exact registered sources required');
 for(const [i,source]of sources.entries())if(source.id!==c.request.sources[i].id||source.source_hash!==c.request.sources[i].source_hash||digest(nativeExternalEvidence(source.evidence))!==source.source_hash)throw Error('Attribution source commitment mismatch');
 // No operator opinion, priority claim, or proposed allocation enters the admission.
 return {case_id:c.id,revision:Number(c.revision),request_hash:c.request_hash,sources:c.request.sources,
  basis:'The exact immutable GitHub sources were retrieved again and their blob bytes, repository identities, PR heads, source hashes and numeric PR submitter accounts match the registered evidence. The target declares these exact source URLs. This attests documentary associations only: neither original mathematical discovery, local proof validity, wallet ownership nor a credit allocation is asserted.'};
}

export async function processAttribution({id,read,tx,collect,save=async()=>{},now=()=>Date.now()}){
 let c=await read('get_attribution_case',[id]);
 if(c.id!==id)throw Error('Wrong native attribution case');
 if(c.status==='submitted'){
  const sources=[];
  for(const reference of c.request.sources){
   const registered=await read('get_external_result',[reference.id]),e=nativeExternalEvidence(registered.evidence);
   const fetched=await collect({repository:e.repository,pr:Number(e.pr),commit:e.commit,path:e.path,theorem:e.theorem,statement:e.statement,origin:e.origin,attributionBasis:e.attribution_basis});
   if(fetched.source_hash!==registered.source_hash||canonical(fetched.evidence)!==canonical(e))throw Error('GitHub source changed or registry cannot be independently reproduced');
   sources.push({...registered,evidence:fetched.evidence});
   await save('source-'+reference.id,fetched);
  }
  const attestation=federationCaseAttestation(c,sources);
  await tx('verifier','attest-r0','attest_attribution',[id,0,JSON.stringify(attestation)]);
  c=await read('get_attribution_case',[id]);
 }
 if(['verified','challenged'].includes(c.status)){
  const round=Number(c.round);
  if(!uint(c.round)||!hash(c.attestation_hash))throw Error('Exact round and admitted source hash required');
  await tx('executor',`begin-r${round}`,'begin_attribution_review',[id,round,c.attestation_hash]);
  await tx('executor',`review-r${round}`,'review_attribution',[id,round,c.attestation_hash]);
  c=await read('get_attribution_case',[id]);
 }
 if(['provisional','settled'].includes(c.status)){
  const round=Number(c.round);
  // Recover and verify the exact native review receipt even on resume. Never
  // make another model call merely because the first one was undetermined.
  await tx('executor',`review-r${round}`,'review_attribution',[id,round,c.attestation_hash],true);
  if(c.status==='provisional'&&(Number(c.deadline)+2)*1000>now())return {status:'challenge-window',case:c,resumeAfter:new Date((Number(c.deadline)+2)*1000).toISOString()};
  await tx('executor',`settle-r${round}`,'settle_attribution',[id,round,c.attestation_hash],c.status==='settled');
  c=await read('get_attribution_case',[id]);
 }
 if(c.status!=='settled')throw Error('Unresolved attribution case: '+c.status);
 return {status:'settled',case:c,attribution:await read('get_attribution',[c.target])};
}

export function routedImpactCall(id,impact){
 if(!uint(impact.round))throw Error('Exact impact round required');
 const round=Number(impact.round),revision=impact.routing_revision===undefined?0:Number(impact.routing_revision);
 if(!uint(revision))throw Error('Exact impact routing revision required');
 if(revision===0)return {stage:`settle-impact-r${round}`,method:'settle_impact',args:[id,round]};
 if(!hash(impact.route_commitments_hash))throw Error('Exact reconciled impact route commitment required');
 return {stage:`settle-impact-r${round}-route${revision}-${impact.route_commitments_hash}`,method:'settle_impact_routed',args:[id,round,revision,impact.route_commitments_hash]};
}
