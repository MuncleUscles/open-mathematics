// Batch accounting and snapshot jobs have a larger native read fanout.
// Keep their pacing and safe read cooldowns separate from live worker behavior.
import {rpcRateLimit} from '../src/rpc-errors.mjs';

const INTERVAL_MS=3000;
const MAX_ATTEMPTS=3;
const MAX_RETRY_MS=150000;
const ADDRESS=/^0x[0-9a-f]{40}$/i;

function cooldown(error){
 const limit=rpcRateLimit(error),seconds=limit?.retryAfterSeconds;
 if(limit?.window==='hour'||!Number.isSafeInteger(seconds)||seconds<1||seconds>60)return null;
 return seconds*1000;
}

export function withStudioBatchPacing(client,{now=()=>Date.now(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const originals={};
 for(const method of ['readContract','getTransaction','getChainId','request','writeContract']){
  if(typeof client?.[method]!=='function')throw Error('Studio batch client is missing '+method);
  originals[method]=client[method].bind(client);
 }
 let queue=Promise.resolve(),nextStart=0;
 async function paced(operation){
  const slot=queue.then(async()=>{
   // Recheck after waiting: another read may have reported a shared cooldown.
   while(now()<nextStart)await wait(nextStart-now());
   nextStart=now()+INTERVAL_MS;
  });
  queue=slot.catch(()=>{});
  await slot;
  // Release the start queue before calling the original method. Originals use
  // the unmodified client, so internal request calls cannot enter this queue.
  return operation();
 }
 async function read(operation){
  const started=now();let lastError;
  for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){
   try{return await paced(()=>{
    if(lastError&&now()-started>MAX_RETRY_MS)throw lastError;
    return operation();
   });}
   catch(error){
    const delay=cooldown(error);
    if(delay===null||attempt===MAX_ATTEMPTS||now()-started+delay>MAX_RETRY_MS)throw error;
    lastError=error;nextStart=Math.max(nextStart,now()+delay);
   }
  }
 }
 const wrapped={
  readContract:(...args)=>read(()=>originals.readContract(...args)),
  getTransaction:(...args)=>read(()=>originals.getTransaction(...args)),
  getChainId:(...args)=>read(()=>originals.getChainId(...args)),
  request:request=>{
   // This is the only raw RPC used by receipt recovery. Never infer that an
   // arbitrary method (or a batch) is safe to repeat after a transport failure.
   if(!request||request.method!=='sim_getTransactionsForAddress'||!Array.isArray(request.params)||
      request.params.length!==1||typeof request.params[0]!=='string'||!ADDRESS.test(request.params[0])||
      Object.keys(request).some(key=>!['method','params'].includes(key)))
    throw Error('Studio batch client allows only the bounded transaction-history RPC');
   const exact={method:request.method,params:[request.params[0]]};
   return read(()=>originals.request(exact));
  },
  // A rate limit or uncertain broadcast is returned to the existing journal.
  // This wrapper must never attempt a second write or a fresh judgment.
  writeContract:(...args)=>paced(()=>originals.writeContract(...args)),
 };
 return new Proxy(client,{get(target,key){
  if(Object.hasOwn(wrapped,key))return wrapped[key];
  const value=Reflect.get(target,key,target);
  return typeof value==='function'?value.bind(target):value;
 }});
}
