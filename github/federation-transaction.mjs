import {journaledTransaction} from './journaled-transaction.mjs';

// Fresh-begin authority belongs to this invocation, never to a recovered hash.
// Keep the shared receipt verifier and historical checker fingerprints intact.
export async function journaledFederationTransaction({client,onBroadcast,...options}){
 if(onBroadcast===undefined)return journaledTransaction({client,...options});
 if(typeof onBroadcast!=='function')throw Error('A broadcast notification must be a function');
 let broadcast=false;
 const tracked={
  account:client.account,
  request:(...args)=>client.request(...args),
  getTransaction:(...args)=>client.getTransaction(...args),
  writeContract:async(...args)=>{
   const hash=await client.writeContract(...args);
   broadcast=true;
   return hash;
  },
 };
 const entry=await journaledTransaction({client:tracked,...options});
 // A successful return proves durable intent/hash saving and exact finalized
 // receipt verification. Recovered calls and failed writes never notify.
 if(broadcast)await onBroadcast(entry.hash);
 return entry;
}
