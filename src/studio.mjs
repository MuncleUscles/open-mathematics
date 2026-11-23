import {digest,canonical} from './security.mjs';
import {abi} from 'genlayer-js';
export const normalize=x=>x instanceof Map?Object.fromEntries([...x].map(([k,v])=>[k,normalize(v)])):Array.isArray(x)?x.map(normalize):typeof x==='bigint'?String(x):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,normalize(v)])):x;
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export function verifyFinalizedOutcome(r,{execution='SUCCESS'}={}){
  const invalid=()=>{throw Object.assign(Error('Invalid finalized consensus outcome or execution receipt'),{code:'STUDIO_FINALIZED_OUTCOME_INVALID'});};
  if(!r||typeof r!=='object'||Array.isArray(r))invalid();
  const statuses=['status_name','statusName','status'].filter(k=>Object.hasOwn(r,k));
  const names=['result_name','resultName'].filter(k=>Object.hasOwn(r,k));
  const leaders=r.consensus_data?.leader_receipt,leader=Array.isArray(leaders)?leaders[0]:leaders;
  if(!['SUCCESS','ERROR'].includes(execution)||!statuses.length||
    statuses.some(k=>r[k]!=='FINALIZED'&&!(k==='status'&&r[k]===7))||
    !names.length||names.some(k=>r[k]!=='MAJORITY_AGREE')||
    r.leader_only!==false||leader?.execution_result!==execution)invalid();
  // SDK 0.18.9 / historical Studio used result=6 for MAJORITY_AGREE.
  // Accept that exact legacy shape only, never infer it from missing fields.
  const modern=['lifecycle','txExecutionResult','txExecutionResultName'].some(k=>Object.hasOwn(r,k));
  if(r.result===6&&!modern)return true;
  // SDK 2.0 / Studio v0.123 uses result=1. A successful leader return alone
  // is insufficient: C returned normally while consensus finalized undetermined.
  if(r.result!==1||r.txExecutionResult!==(execution==='SUCCESS'?1:2)||
    r.txExecutionResultName!==(execution==='SUCCESS'?'FINISHED_WITH_RETURN':'FINISHED_WITH_ERROR'))invalid();
  if(Object.hasOwn(r,'lifecycle')&&(r.lifecycle?.state!=='finalized'||r.lifecycle?.outcome!=='accepted'))invalid();
  return true;
}
export function verifyReceiptCall(r,{hash,address,method,id,args}){
  if(!eq(r.hash,hash)||!eq(r.to_address,address))throw Error('Invalid finalized execution receipt');
  let call,decoded;try{decoded=abi.calldata.decode(Uint8Array.from(r.data?.calldata?.raw||[]));call=normalize(decoded);}catch{throw Error('Invalid calldata');}
  if((call.method??call[''])!==method||(args?!Buffer.from(abi.calldata.encode(decoded instanceof Map?decoded.get('args'):decoded.args)).equals(Buffer.from(abi.calldata.encode(args))):call.args?.[0]!==id))throw Error('Wrong contract method or contribution');
}
export function verifyReceipt(r,{independent=false,...expected}){
  verifyFinalizedOutcome(r);
  verifyReceiptCall(r,expected);
  if(independent&&!r.consensus_data?.validators?.some(v=>v.mode==='validator'&&v.vote==='agree'&&v.execution_result==='SUCCESS'))throw Error('Independent adjudication required');
  return true;
}
export class StudioAuthority {
  constructor({client,contract,chainId,policy,registry,github,appId,verifierAppId,branch='main'}){Object.assign(this,{client,contract,chainId,policy,registry,github,appId,verifierAppId,branch});}
  async finalizedDecision(id){
    if(await this.client.getChainId()!==this.chainId)throw Error('Wrong chain');
    const binding=this.registry.get(id);if(!binding||binding.mode!=='live')throw Error('Live evidence enrollment required');
    const r=normalize(await this.client.readContract({address:this.contract,functionName:'get',args:[id],transactionHashVariant:'latest-final'}));
    if(r.evidence.policy!==this.policy||r.digest!==binding.evidenceDigest||digest(binding.evidenceJSON)!==r.digest)throw Error('Evidence commitment mismatch');
    const [a,f]=await Promise.all([this.client.getTransaction({hash:binding.adjudicationTx}),this.client.getTransaction({hash:binding.finalizeTx})]);
    verifyReceipt(a,{hash:binding.adjudicationTx,address:this.contract,method:'adjudicate',args:[id,Number(binding.round)],independent:true});
    verifyReceipt(f,{hash:binding.finalizeTx,address:this.contract,method:'finalize',args:[id,Number(binding.round)]});
    if(Number(binding.round)!==Number(r.round))throw Error('Adjudication receipt predates challenge round');
    // Registry is populated by the trusted receipt indexer, never a webhook payload.
    return {id,authority:'genlayer-finalized',executionSucceeded:true,leaderOnly:false,validatorAgreement:true,mode:'live',repository:r.evidence.repository,pr:Number(r.evidence.pr),head:r.evidence.head,base:r.evidence.base,branch:this.branch,status:r.status==='credited'?'approved':r.status,deadline:r.deadline*1000,openChallenges:r.status==='challenged'?1:0,reason:r.verdict.reason,appId:this.appId,verifierAppId:this.verifierAppId,receiptHash:binding.finalizeTx};
  }
  async publishFinalCheck(d){const result=await this.github.request('/check-runs',{method:'POST',body:{name:'open-mathematics/finalized',head_sha:d.head,status:'completed',conclusion:'success',external_id:d.receiptHash,output:{title:'Final GenLayer decision: accept',summary:d.reason}}});if(result.app?.id!==this.appId)throw Error('Wrong finalized-check publisher');return result;}
  async confirmMerge(id,head,merge){const hash=await this.client.writeContract({address:this.contract,functionName:'confirm_merge',args:[id,head,merge],leaderOnly:false});const r=await this.client.waitForTransactionReceipt({hash,status:'FINALIZED',retries:120});verifyReceipt(r,{hash,address:this.contract,method:'confirm_merge',args:[id,head,merge]});return hash;}
}
