// Read-only retries. Never use this helper to broadcast a transaction.
import {rpcRateLimit} from '../src/rpc-errors.mjs';
export function createNativeReader(operation,{now=Date.now,...options}={}){
 let blockedUntil=0,rateLimitError;
 return async(...args)=>{
  if(now()<blockedUntil)throw rateLimitError;
  try{return await readWithRetry(()=>operation(...args),options);}
  catch(error){
   const limit=rpcRateLimit(error);
   if(limit){rateLimitError=error;blockedUntil=Math.max(blockedUntil,now()+(limit.retryAfterSeconds??60)*1000);}
   throw error;
  }
 };
}
export async function readWithRetry(operation,{timeoutMs=8000,retryDelayMs=400}={}){
 let error;
 for(let attempt=0;attempt<2;attempt++){
  let timer;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native read timed out')),timeoutMs);})]);}
  catch(e){if(rpcRateLimit(e))throw e;error=e;}
  finally{clearTimeout(timer);}
  if(attempt===0)await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
 }
 throw error;
}

// A current record never makes an unavailable balance/impact read current.
// Keep each missing field null; the caller may label an entirely archived view
// only when the primary record read itself fails.
export async function readCurrentContribution(read,address,id,{withProvenance=false}={}){
 const record=await read(address,'get',[id]);
 const [impact,points,provenance]=await Promise.all([
  read(address,'get_impact',[id]).catch(()=>null),
  read(address,'get_points',[record.evidence.wallet]).catch(()=>null),
  withProvenance?read(address,'get_provenance',[id]).catch(()=>null):Promise.resolve(null),
 ]);
 return {record,impact,points,provenance};
}
