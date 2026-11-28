import { abi } from 'genlayer-js';
import { verifyReceipt } from '../src/studio.mjs';
import { FinalizedExecutionError, finalizedExecutionFailure, studioTransactionStatus } from './runtime.mjs';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const MAX_HISTORY_ROWS = 1000;

function matchesAddress(value, expected) {
  return typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
}

function readHistoryCall(row) {
  const calldata = row.data?.calldata;
  if (typeof calldata !== 'string') throw Error('Malformed operator calldata in Studio history');
  const bytes = Buffer.from(calldata, 'base64');
  if (!bytes.length || bytes.toString('base64') !== calldata) {
    throw Error('Malformed operator calldata in Studio history');
  }
  try {
    const call = abi.calldata.decode(bytes);
    const get = key => call instanceof Map ? call.get(key) : call?.[key];
    const method = get('method') ?? get('');
    const args = get('args');
    if (!Array.isArray(args) || (method !== undefined && typeof method !== 'string')) {
      throw Error('Invalid ABI call envelope');
    }
    return { method, args };
  } catch (cause) {
    throw Error('Malformed operator calldata in Studio history', { cause });
  }
}

// Look up a previously broadcast call whose hash did not reach the worker's journal.
// Null is an absence from this Studio history snapshot, which can lag a new broadcast.
export async function recoverReceipt(client, { address, sender, method, args, independent = false }) {
  if (typeof address !== 'string' || !ADDRESS.test(address) ||
      typeof sender !== 'string' || !ADDRESS.test(sender) ||
      typeof method !== 'string' || !method || !Array.isArray(args) || typeof independent !== 'boolean') {
    throw Error('Receipt recovery requires the exact contract, sender, method and typed arguments');
  }
  const expectedArgs = Buffer.from(abi.calldata.encode(args));
  const history = await client.request({ method: 'sim_getTransactionsForAddress', params: [address] });
  if (!Array.isArray(history)) {
    throw Error('Complete Studio transaction history must be an array with at most 1,000 rows from the enrolled sender');
  }

  const matching = new Set();
  let operatorRows = 0;
  for (const row of history) {
    if (row?.to_address === null) continue;
    const own = matchesAddress(row?.from_address, sender);
    if (own && (typeof row?.to_address !== 'string' || !ADDRESS.test(row.to_address))) {
      throw Error('Malformed destination in Studio transaction history');
    }
    if (!matchesAddress(row?.to_address, address) || row.type === 0 || row.type === 1) continue;
    // Studio records an in-place code upgrade in this same history, with no caller or call data.
    if (row.type === 3) {
      if (row.from_address !== null || !HASH.test(row.hash ?? '') ||
          typeof row.data?.new_code !== 'string' || !row.data.new_code || Object.hasOwn(row.data, 'calldata')) {
        throw Error('Malformed contract upgrade in Studio transaction history');
      }
      continue;
    }
    if (typeof row.from_address !== 'string' || !ADDRESS.test(row.from_address)) {
      throw Error('Malformed sender in Studio transaction history');
    }
    if (!own) continue;
    if (++operatorRows > MAX_HISTORY_ROWS) {
      throw Error('Complete Studio transaction history must contain at most 1,000 rows from the enrolled sender');
    }
    const call = readHistoryCall(row);
    if (call.method !== method || !Buffer.from(abi.calldata.encode(call.args)).equals(expectedArgs)) continue;
    if (typeof row.hash !== 'string' || !HASH.test(row.hash)) {
      throw Error('Matching Studio transaction has a malformed hash');
    }
    matching.add(row.hash.toLowerCase());
  }

  if (!matching.size) return null;
  if (matching.size !== 1) {
    throw Object.assign(Error('Ambiguous Studio history contains multiple matching transactions'), {
      code: 'AMBIGUOUS_STUDIO_HISTORY',
    });
  }
  const [hash] = matching;
  let receipt;
  try {
    receipt = await client.getTransaction({ hash });
  } catch (cause) {
    throw Object.assign(Error(`Matching Studio transaction ${hash} could not be read`, { cause }), {
      code: 'STUDIO_MATCH_UNAVAILABLE', hash,
    });
  }
  if (!receipt || !matchesAddress(receipt.from_address, sender)) {
    throw Object.assign(Error(`Matching Studio transaction ${hash} is unavailable or has an unexpected sender`), {
      code: 'STUDIO_MATCH_UNAVAILABLE', hash,
    });
  }
  let status;
  try { status = studioTransactionStatus(receipt); }
  catch (cause) {
    throw Object.assign(Error(`Matching Studio transaction ${hash} failed receipt verification: ${cause.message}`, { cause }), {
      code: 'STUDIO_MATCH_INVALID', hash,
    });
  }
  if (status !== 'FINALIZED') {
    throw Object.assign(Error(`Matching Studio transaction ${hash} has not finalized (${status ?? 'unknown status'})`), {
      code: 'STUDIO_MATCH_UNFINALIZED', hash, status,
    });
  }
  try {
    const failure = finalizedExecutionFailure(receipt, { hash, address, sender, method, args });
    if (failure) throw failure;
    verifyReceipt(receipt, { hash, address, method, args, independent });
  } catch (cause) {
    if (cause instanceof FinalizedExecutionError) throw cause;
    throw Object.assign(Error(`Matching Studio transaction ${hash} failed receipt verification: ${cause.message}`, { cause }), {
      code: 'STUDIO_MATCH_INVALID', hash, status,
    });
  }
  return { hash, receipt };
}
