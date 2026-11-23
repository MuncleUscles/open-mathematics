import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createClient,createAccount} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {rpcRateLimit,STUDIO_RATE_LIMIT_CODE} from '../src/rpc-errors.mjs';
import {normalize,verifyReceipt} from '../src/studio.mjs';
export const clean=x=>JSON.parse(JSON.stringify(normalize(x)),(k,v)=>['node_config','contract_state','execution_stats'].includes(k)?undefined:v);
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const clientFor=key=>createClient({chain:studionet,...(key?{account:createAccount(key)}:{})});
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
export async function finalized(client,hash,expected){
 for(let n=0;n<240;n++){
  const r=await retry(()=>client.getTransaction({hash}));const status=r.status_name||r.statusName||r.status;
  if(status==='FINALIZED'){
   const l=r.consensus_data?.leader_receipt;const leader=Array.isArray(l)?l[0]:l;
   if(leader?.execution_result!=='SUCCESS'||r.leader_only!==false)throw Error('Finalized execution failed: '+hash);
   if(expected)verifyReceipt(r,{hash,...expected});return clean(r);
  }
  if(['UNDETERMINED','CANCELED','LEADER_TIMEOUT'].includes(status))throw Error('Transaction '+status+': '+hash);
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
