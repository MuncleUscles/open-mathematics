import fs from 'node:fs';
import {createClient,createAccount} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {normalize,verifyReceipt} from '../src/studio.mjs';
export const clean=x=>JSON.parse(JSON.stringify(normalize(x)),(k,v)=>['node_config','contract_state','execution_stats'].includes(k)?undefined:v);
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const clientFor=key=>createClient({chain:studionet,...(key?{account:createAccount(key)}:{})});
export async function retry(fn){let e;for(let n=0;n<5;n++){try{return await fn();}catch(err){e=err;await sleep(1500*(n+1));}}throw e;}
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
export function saveJSON(file,value){fs.writeFileSync(file,JSON.stringify(clean(value),null,2)+'\n');}
