import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {abi,createAccount} from 'genlayer-js';
import {createStudioClient} from '../src/studio-client.mjs';
import {rpcRateLimit,STUDIO_RATE_LIMIT_CODE} from '../src/rpc-errors.mjs';
import {digest} from '../src/security.mjs';
import {normalize,verifyReceipt,verifyReceiptCall,verifyFinalizedOutcome} from '../src/studio.mjs';
export const clean=x=>JSON.parse(JSON.stringify(normalize(x)),(k,v)=>['node_config','contract_state','execution_stats'].includes(k)?undefined:v);
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const clientFor=key=>createStudioClient(key?{account:createAccount(key)}:{});
export async function retry(fn,{wait=sleep}={}){
 for(let attempt=1;attempt<=5;attempt++){
  try{return await fn();}
  catch(error){
   const limit=rpcRateLimit(error);
   if(limit){
    const {retryAfterSeconds,...data}=limit;
    const guidance=retryAfterSeconds===undefined?'':` Retry after ${retryAfterSeconds} seconds.`;
    if(retryAfterSeconds!==undefined)data.retry_after_seconds=retryAfterSeconds;
    throw Object.assign(Error(`Studio RPC rate limit reached (${STUDIO_RATE_LIMIT_CODE}).${guidance}`),{code:STUDIO_RATE_LIMIT_CODE,data});
   }
   if(attempt===5)throw error;
   await wait(1500*attempt);
  }
 }
}
const knownRegistrationErrors=new Set([
 'statement already reserved or credited',
 'duplicate or invalid contribution id',
 'MVP evidence or registry capacity exceeded',
 'legacy import required before registration',
 'statement or artifact already reserved credited or historical',
 'signed claim already registered',
 'verified normal GitHub account and valid creation time required',
 'GitHub account below minimum age at original signed claim',
 'one active contribution per GitHub account; finish or expire the existing claim',
 'three registrations per GitHub account in rolling 24 hours', // Historical deployments: retain receipt recovery.
 'content has unresolved adjudication; same-content resubmission is fenced',
 'previously rejected content cannot receive a fresh adjudication',
 'same content already has an active or settled claim',
]);
const leaderReceipt=r=>Array.isArray(r?.consensus_data?.leader_receipt)?r.consensus_data.leader_receipt[0]:r?.consensus_data?.leader_receipt;
const transactionStatuses=['UNINITIALIZED','PENDING','PROPOSING','COMMITTING','REVEALING','ACCEPTED',
 'UNDETERMINED','FINALIZED','CANCELED','APPEAL_REVEALING','APPEAL_COMMITTING','VALIDATORS_TIMEOUT','LEADER_TIMEOUT','LEADER_REVEALING'];
export function studioTransactionStatus(receipt){
 const invalid=()=>{throw Object.assign(Error('Missing, conflicting or unknown Studio transaction status'),{code:'STUDIO_FINALIZED_OUTCOME_INVALID'});};
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))invalid();
 const values=['status_name','statusName','status'].filter(k=>Object.hasOwn(receipt,k)).map(k=>{
  const value=k==='status'&&Number.isInteger(receipt[k])?transactionStatuses[receipt[k]]:receipt[k];
  return value==='ACTIVATED'?'PENDING':value;
 });
 if(!values.length||!transactionStatuses.includes(values[0])||values.some(v=>v!==values[0]))invalid();
 return values[0];
}

export class FinalizedExecutionError extends Error {
 constructor(receipt,reason){
  super(`Finalized execution failed: ${receipt.hash}${reason?` (${reason})`:''}`);
  this.name='FinalizedExecutionError';
  this.code='STUDIO_FINALIZED_EXECUTION_ERROR';
  this.hash=receipt.hash;
  this.status=receipt.statusName;
  this.receipt=receipt;
  this.reason=reason;
 }
}

export function finalizedExecutionFailure(receipt,expected){
 const leader=leaderReceipt(receipt);
 if((receipt?.status_name||receipt?.statusName||receipt?.status)!=='FINALIZED'||receipt.leader_only!==false||leader?.execution_result!=='ERROR'||!Array.isArray(expected?.args))return null;
 verifyFinalizedOutcome(receipt,{execution:'ERROR'});
 verifyReceiptCall(receipt,expected);
 if(expected.sender&&(typeof receipt.from_address!=='string'||receipt.from_address.toLowerCase()!==expected.sender.toLowerCase()))throw Error('Finalized execution receipt has an unexpected sender');
 const result=leader.result;
 const payload=typeof result?.payload==='string'&&result.payload.length<=500?result.payload.trim().replace(/^UserError: /,''):'';
 const reason=expected.method==='register'&&['contract_error','rollback'].includes(result?.status)&&knownRegistrationErrors.has(payload)?payload:undefined;
 // Never publish the raw failure payload or caller-controlled calldata twice.
 const evidence={hash:receipt.hash,from_address:receipt.from_address,to_address:receipt.to_address,statusName:'FINALIZED',leader_only:false,
  ...Object.fromEntries(['result','result_name','resultName','lifecycle','txExecutionResult','txExecutionResultName'].filter(k=>Object.hasOwn(receipt,k)).map(k=>[k,receipt[k]])),
  method:expected.method,argsSha256:digest(abi.calldata.encode(expected.args)),
  consensus_data:{leader_receipt:[{execution_result:'ERROR',...(reason?{result:{status:result.status,payload:reason}}:{})}]}};
 return new FinalizedExecutionError(evidence,reason);
}

export async function finalized(client,hash,expected){
 for(let n=0;n<240;n++){
  const r=await retry(()=>client.getTransaction({hash}));
  const status=studioTransactionStatus(r);
  if(status==='FINALIZED'){
   if(leaderReceipt(r)?.execution_result!=='SUCCESS'||r.leader_only!==false){
    const failure=finalizedExecutionFailure(r,expected&&{...expected,hash});
    throw failure??Error('Finalized execution failed: '+hash);
   }
   verifyFinalizedOutcome(r);
   if(expected)verifyReceipt(r,{hash,...expected});return clean(r);
  }
  if(['UNDETERMINED','CANCELED','LEADER_TIMEOUT','VALIDATORS_TIMEOUT'].includes(status))throw Error('Transaction '+status+': '+hash);
  await sleep(2500);
 }
 throw Error('Finality timeout: '+hash);
}
export const read=async(client,address,method,args)=>normalize(await retry(()=>client.readContract({address,functionName:method,args,transactionHashVariant:'latest-final'})));
export function saveJSON(file,value){
 const target=path.resolve(file),temporary=target+'.'+randomBytes(8).toString('hex')+'.tmp';
 let fd;
 try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(clean(value),null,2)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,target);const directory=fs.openSync(path.dirname(target),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
 finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
}
