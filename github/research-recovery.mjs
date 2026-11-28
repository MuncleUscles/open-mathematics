// Recovery re-enters the worker at the original signed comment. Transaction
// writes remain behind the exact-call journal, including uncertain broadcasts.
import {setTimeout as delay} from 'node:timers/promises';
import {rpcRateLimit} from '../src/rpc-errors.mjs';

export function temporaryResearchFailure(error) {
 if (rpcRateLimit(error)) return true;
 for (let depth = 0; error && depth < 6; depth++, error = error.cause) {
  if (['STUDIO_MATCH_UNAVAILABLE','STUDIO_MATCH_UNFINALIZED','RESEARCH_NETWORK',
       'ECONNRESET','ETIMEDOUT','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(error.code)) return true;
  // An intent already exists; re-entering can only recover its exact receipt.
  if (/^Ambiguous broadcast for journal stage [a-z0-9-]+\. No matching call is visible yet\.$/.test(error.message)) return true;
  if (error.name === 'TimeoutError' || (error instanceof TypeError && error.message === 'fetch failed') ||
      /^GitHub (408|429|500|502|503|504)$/.test(error.message)) return true;
 }
 return false;
}

export async function recoverResearchOperation(operation, {wait = delay, warn = console.warn} = {}) {
 const delays = [15000, 45000];
 for (let attempt = 0; ; attempt++) {
  try { return await operation(); }
  catch (error) {
   if (attempt === delays.length || !temporaryResearchFailure(error)) throw error;
   const seconds = rpcRateLimit(error)?.retryAfterSeconds;
   const backoff = Math.max(delays[attempt], (seconds ?? 0) * 1000);
   if (backoff > 90000) throw error; // The periodic sweep will pick this up later.
   warn(`Temporary research service failure. Resuming from saved evidence in ${backoff / 1000}s.`);
   await wait(backoff);
  }
 }
}
