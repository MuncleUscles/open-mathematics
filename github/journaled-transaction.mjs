import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { abi } from 'genlayer-js';
import { recoverReceipt } from './receipt-recovery.mjs';
import { clean, finalized, FinalizedExecutionError } from './runtime.mjs';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const activeJournals = new WeakMap();
const KNOWN_MATCH = new Set(['STUDIO_MATCH_UNFINALIZED', 'STUDIO_MATCH_UNAVAILABLE', 'STUDIO_MATCH_INVALID']);

function expectedSender(address, intent) {
  return typeof address === 'string' && address.toLowerCase() === intent.sender;
}

function sameIntent(saved, expected) {
  return !!saved && typeof saved === 'object' &&
    Object.keys(saved).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => Object.hasOwn(saved, key) && saved[key] === value);
}

// The caller serializes independent processes and supplies a durable save callback.
// An intent-only stage protects an uncertain broadcast even while Studio history lags.
export async function journaledTransaction({
  client, address, sender, method, args, independent = false, transactions, stage, save, recoverOnly = false,
}) {
  if (typeof address !== 'string' || !ADDRESS.test(address) ||
      typeof sender !== 'string' || !ADDRESS.test(sender) ||
      typeof method !== 'string' || !method || !Array.isArray(args) ||
      typeof independent !== 'boolean' || typeof recoverOnly !== 'boolean' ||
      !transactions || typeof transactions !== 'object' || Array.isArray(transactions) ||
      typeof stage !== 'string' || !stage || typeof save !== 'function') {
    throw Error('An exact transaction and persistent journal stage are required');
  }

  const argsBytes = abi.calldata.encode(args);
  const stableArgs = abi.calldata.decode(argsBytes);
  const expected = { address, sender, method, args: stableArgs, independent };
  const intent = {
    address: address.toLowerCase(),
    sender: sender.toLowerCase(),
    method,
    argsSha256: createHash('sha256').update(argsBytes).digest('hex'),
    independent,
  };

  let active = activeJournals.get(transactions);
  if (!active) {
    active = new Set();
    activeJournals.set(transactions, active);
  }
  if (active.has(stage)) throw Error(`Journal stage ${stage} is already in progress`);
  active.add(stage);

  try {
    let entry = Object.hasOwn(transactions, stage) ? transactions[stage] : undefined;
    if (Object.hasOwn(transactions, stage) && (
      !entry || typeof entry !== 'object' || Array.isArray(entry) ||
      (Object.hasOwn(entry, 'intent') ? !sameIntent(entry.intent, intent) : !entry.hash) ||
      (Object.hasOwn(entry, 'hash') && (typeof entry.hash !== 'string' || !HASH.test(entry.hash))) ||
      ((entry.receipt != null || entry.failedReceipt != null) && !entry.hash)
    )) {
      throw Error(`Journal stage ${stage} does not match its exact transaction intent`);
    }

    function remember(fields) {
      if (!entry) {
        entry = { intent };
        Object.defineProperty(transactions, stage, {
          value: entry, enumerable: true, writable: true, configurable: true,
        });
      }
      Object.assign(entry, fields);
    }

    async function rememberFailure(error) {
      if (!entry?.intent || entry.hash !== error.hash || entry.receipt != null ||
          !isDeepStrictEqual(entry.failedReceipt, error.receipt)) {
        remember({ intent, hash: error.hash, failedReceipt: error.receipt });
        delete entry.receipt;
        await save();
      }
      error.stage = stage;
    }

    if (!entry?.hash) {
      let recovered;
      try {
        recovered = await recoverReceipt(client, expected);
      } catch (error) {
        if (error instanceof FinalizedExecutionError) {
          await rememberFailure(error);
        } else if (KNOWN_MATCH.has(error.code) && typeof error.hash === 'string' && HASH.test(error.hash)) {
          // Preserve a discovered hash even if its exact receipt is not yet verified.
          remember({ hash: error.hash });
          await save();
        } else if (!entry && error.code === 'AMBIGUOUS_STUDIO_HISTORY') {
          remember({});
          await save();
        }
        throw error;
      }

      if (recovered) {
        remember({ hash: recovered.hash, receipt: clean(recovered.receipt) });
        await save();
        return entry;
      }
      if (entry) throw Error(`Ambiguous broadcast for journal stage ${stage}. No matching call is visible yet.`);
      if (recoverOnly) throw Error(`No existing call found for recovery-only journal stage ${stage}`);
      const account = typeof client.account === 'string' ? client.account : client.account?.address;
      if (!expectedSender(account, intent)) throw Error(`Journal stage ${stage} signing client has an unexpected sender`);

      remember({});
      await save();
      const hash = await client.writeContract({ address, functionName: method, args: stableArgs, leaderOnly: false });
      if (typeof hash !== 'string' || !HASH.test(hash)) {
        throw Error(`Broadcast for journal stage ${stage} did not return a valid transaction hash`);
      }
      remember({ hash });
      await save();
    }

    // The journal stores copies of receipts, so resume verifies the native transaction again.
    let receipt;
    try {
      receipt = await finalized(client, entry.hash, expected);
    } catch (error) {
      if (error instanceof FinalizedExecutionError) await rememberFailure(error);
      throw error;
    }
    if (!expectedSender(receipt.from_address, intent)) {
      throw Error(`Journal stage ${stage} receipt has an unexpected sender`);
    }
    if (!entry.intent || entry.failedReceipt != null || !isDeepStrictEqual(entry.receipt, receipt)) {
      remember({ intent, receipt });
      delete entry.failedReceipt;
      await save();
    }
    return entry;
  } finally {
    active.delete(stage);
    if (!active.size) activeJournals.delete(transactions);
  }
}
