import {withStudioBatchPacing} from '../github/batch-studio-client.mjs';
import {normalizeOpenRead} from './open-snapshot.mjs';

// Every dashboard collector (including earlier pages) shares this one start
// queue. Expose only finalized reads, never the SDK's transaction methods.
export function createDashboardReaders({client,contract,accountsContract,trackContracts},pacing){
 const paced=withStudioBatchPacing(client,pacing);
 const reader=address=>async(method,args=[])=>normalizeOpenRead(await paced.readContract({
  address,functionName:method,args,transactionHashVariant:'latest-final',
 }));
 const readers = {read:reader(contract),...(accountsContract?{accountRead:reader(accountsContract)}:{})};
 if (trackContracts) readers.trackReads = Object.fromEntries(
  Object.entries(trackContracts).map(([id, address]) => [id, reader(address)]));
 return readers;
}
