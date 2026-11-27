import {journaledTransaction} from './journaled-transaction.mjs';
import {sleep,studioTransactionStatus} from './runtime.mjs';
import {verifyReceiptCall} from '../src/studio.mjs';

const hashPattern = /^0x[a-f0-9]{64}$/;
const appealableFailures = new Set(['UNDETERMINED','LEADER_TIMEOUT','VALIDATORS_TIMEOUT']);

const running = new WeakSet();
export async function journaledReview(options) {
  if (running.has(options.transactions)) throw Error('A review for this claim is already in progress');
  running.add(options.transactions);
  try { return await processReview(options); }
  finally { running.delete(options.transactions); }
}

async function processReview(options) {
  const {client,address,sender,method,args,transactions,stage,retryHash,save} = options;
  if (method !== 'adjudicate' || options.independent !== true) throw Error('An independent merit review is required');
  const entry = transactions[stage];
  const previous = entry?.undeterminedAttempts ?? [];
  if (!Array.isArray(previous) || previous.some(h => !hashPattern.test(h)) || new Set(previous).size !== previous.length)
    throw Error('Invalid review attempt history');

  const rotate = retryHash !== undefined && retryHash === entry?.hash;
  if (retryHash !== undefined && (!hashPattern.test(retryHash) || options.recoverOnly || (!rotate && !previous.includes(retryHash))))
    throw Error('Retry must name the original review transaction');
  if (rotate && (entry.receipt || entry.failedReceipt)) throw Error('A settled execution cannot be retried');
  const excluded = rotate ? [...previous,retryHash] : previous;
  if (rotate || !entry?.hash) {
    for (const hash of excluded) {
      const r = await client.getTransaction({hash});
      if (studioTransactionStatus(r) !== 'FINALIZED' || r.from_address?.toLowerCase() !== sender.toLowerCase() ||
          r.leader_only !== false || r.lifecycle?.state !== 'finalized' || r.lifecycle?.outcome !== 'undetermined' ||
          r.result !== 2 || (r.result_name ?? r.resultName) !== 'MAJORITY_DISAGREE' ||
          (r.resultName !== undefined && r.resultName !== 'MAJORITY_DISAGREE'))
        throw Error('Retry requires a finalized UNDETERMINED review on this exact claim and round');
      verifyReceiptCall(r,{hash,address,method,args});
    }
  }

  // Keep the original journal until the ordinary write-ahead path saves its
  // replacement. A resumed intent with no hash can only recover an existing call.
  const active = rotate ? {} : transactions;
  const reader = Object.create(client);
  reader.request = async request => {
    const result = await client.request(request);
    if (request.method !== 'sim_getTransactionsForAddress' || !excluded.length || !Array.isArray(result)) return result;
    return result.filter(row => !excluded.includes(row?.hash?.toLowerCase()));
  };
  reader.getTransaction = async query => {
    let receipt = await client.getTransaction(query);
    // Keep following the original hash through its appeal window and any new
    // proposal round. A provisional disagreement is not a terminal failure.
    for (let poll=0; poll<120 && appealableFailures.has(studioTransactionStatus(receipt)); poll++) {
      await sleep(2500);
      receipt = await client.getTransaction(query);
    }
    return receipt;
  };
  return journaledTransaction({...options,client:reader,transactions:active,save:async()=>{
    if (rotate) {
      active[stage].undeterminedAttempts = excluded;
      transactions[stage] = active[stage];
    }
    await save();
  }});
}
