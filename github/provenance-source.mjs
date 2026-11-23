import { createHash } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { Agent, request as httpsRequest } from 'node:https';
import { BlockList, isIPv4 } from 'node:net';
import { checkServerIdentity } from 'node:tls';

const MAX_BYTES = 256 * 1024;
const MAX_TIME_MS = 8000;
const blocked = new BlockList();
// Conservative: exclude all IANA special-purpose allocations, including their
// globally reachable exceptions, plus multicast. Do not use this for IPv6.
// https://www.iana.org/assignments/iana-ipv4-special-registry/
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.31.196.0', 24],
  ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(address, prefix, 'ipv4');

export function isPublicIPv4(address) {
  return typeof address === 'string' && isIPv4(address) && !blocked.check(address, 'ipv4');
}

export function sourceURL(reference) {
  if (typeof reference !== 'string' || reference.length > 1000 || /[\s\\#\u0000-\u001f\u007f]/u.test(reference)) {
    throw Error('Source must be an HTTPS URL without whitespace, backslashes or fragments');
  }
  let url;
  try { url = new URL(reference); } catch { throw Error('Invalid source URL'); }
  const authority = reference.match(/^https:\/\/([^/?#]*)/i)?.[1];
  if (url.protocol !== 'https:' || !authority || authority.includes('@') || url.username || url.password || (url.port && url.port !== '443')) {
    throw Error('Source requires HTTPS on port 443 without credentials');
  }
  if (!url.hostname || url.hostname.startsWith('[')) throw Error('Source requires public IPv4 resolution');
  if (isIPv4(url.hostname) && !isPublicIPv4(url.hostname)) throw Error('Source address is not public IPv4');
  return url;
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function responseHeaders(response) {
  const raw = response.rawHeaders;
  if (!Array.isArray(raw) || raw.length % 2 || raw.length > 128) throw Error('Invalid or excessive source headers');
  const headers = new Map();
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i].toLowerCase();
    if (!['content-type', 'content-length', 'content-encoding', 'transfer-encoding'].includes(name)) continue;
    if (headers.has(name)) throw Error('Ambiguous source headers');
    headers.set(name, raw[i + 1]);
  }
  const contentType = headers.get('content-type') || '';
  const [mime, ...parameters] = contentType.toLowerCase().split(';').map(part => part.trim());
  if (!/^(?:text\/[a-z0-9!#$&^_.+-]+|application\/(?:json|xml|[a-z0-9!#$&^_.+-]+\+(?:json|xml)))$/.test(mime) || mime === 'text/pdf') {
    throw Error('Source must have a text, JSON, HTML or XML content type; PDF is unsupported');
  }
  const charset = parameters.filter(part => /^charset\s*=/i.test(part));
  if (charset.length > 1 || (charset.length && !/^charset\s*=\s*(?:utf-8|us-ascii|"utf-8"|"us-ascii")$/i.test(charset[0]))) {
    throw Error('Source must use UTF-8 or ASCII encoding');
  }
  const encoding = headers.get('content-encoding');
  if (encoding && encoding.trim().toLowerCase() !== 'identity') throw Error('Compressed source responses are unsupported');
  const length = headers.get('content-length');
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw Error('Source exceeds 256 KiB or has an invalid length');
  const transfer = headers.get('transfer-encoding');
  if (transfer && (transfer.trim().toLowerCase() !== 'chunked' || length !== undefined)) throw Error('Ambiguous source transfer encoding');
  return length === undefined ? undefined : Number(length);
}

function readResponse(options, request, signal) {
  return new Promise((resolve, reject) => {
    let req, response, finished = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const fail = error => {
      if (finished) return;
      finished = true;
      cleanup();
      response?.destroy();
      req?.destroy();
      reject(error);
    };
    const abort = () => fail(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
      req = request(options, incoming => {
        response = incoming;
        response.on('error', fail);
        if (finished) { response.destroy(); return; }
        response.on('aborted', () => fail(Error('Source response was interrupted')));
        response.on('close', () => { if (!response.complete) fail(Error('Source response was incomplete')); });
        let declaredLength;
        try {
          if (response.statusCode >= 300 && response.statusCode < 400) throw Error('Source redirects are forbidden');
          if (response.statusCode !== 200) throw Error('Source requires a complete HTTP 200 response');
          declaredLength = responseHeaders(response);
        } catch (error) { fail(error); return; }
        let size = 0;
        const chunks = [];
        response.on('data', chunk => {
          if (finished) return;
          if (!Buffer.isBuffer(chunk)) { fail(Error('Source response must contain raw bytes')); return; }
          size += chunk.length;
          if (size > MAX_BYTES) { fail(Error('Source exceeds 256 KiB')); return; }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (finished) return;
          if (!response.complete || (declaredLength !== undefined && declaredLength !== size)) { fail(Error('Source response was incomplete')); return; }
          finished = true;
          cleanup();
          resolve(Buffer.concat(chunks, size));
        });
      });
      req.on('error', fail);
      req.end();
    } catch (error) { fail(error); }
  });
}

/**
 * Retrieve documentary bytes for an operator-reviewed exact quote. The returned
 * excerpt is untrusted data, not instructions or verified authorship/priority.
 * No HTML rendering, XML parsing, script execution or metadata inference occurs.
 *
 * The second argument is trusted dependency injection for tests only. Never load
 * resolver/request/clock hooks or quote-selection code from a PR or source page.
 * timeoutMs may shorten, never extend, the production eight-second deadline.
 */
export async function retrieveProvenanceSource({ reference, quote }, {
  resolver, request = httpsRequest, now = Date.now, timeoutMs = MAX_TIME_MS,
} = {}) {
  const url = sourceURL(reference);
  if (typeof quote !== 'string' || quote.length > 2400 || [...quote].length < 30 || [...quote].length > 1200 || !quote.trim()) {
    throw Error('An operator-reviewed exact quote of 30 to 1200 characters is required');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIME_MS) throw Error('Source deadline must be at most eight seconds');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(Error('Source retrieval deadline exceeded')), timeoutMs);
  const dns = resolver ? null : new Resolver();
  // A fresh agent has no shared connections, TLS sessions, cookies, credentials,
  // or environment proxy. The request uses only the validated address below.
  const agent = new Agent({ keepAlive: false, maxCachedSessions: 0, proxyEnv: {} });
  try {
    const addresses = isIPv4(url.hostname) ? [url.hostname] : await abortable(
      Promise.resolve().then(() => resolver ? resolver(url.hostname) : dns.resolve4(url.hostname)), controller.signal,
    );
    if (!Array.isArray(addresses) || !addresses.length || addresses.length > 64 || addresses.some(address => !isPublicIPv4(address))) {
      throw Error('Every resolved source address must be public IPv4');
    }
    const address = addresses[0];
    const bytes = await readResponse({
      protocol: 'https:', hostname: url.hostname, port: 443,
      method: 'GET', path: url.pathname + url.search,
      agent, family: 4, autoSelectFamily: false,
      servername: isIPv4(url.hostname) ? '' : url.hostname,
      rejectUnauthorized: true, minVersion: 'TLSv1.2',
      checkServerIdentity: (_servername, certificate) => checkServerIdentity(url.hostname, certificate),
      lookup: (hostname, options, callback) => {
        if (typeof options === 'function') { callback = options; options = {}; }
        if (hostname !== url.hostname) { callback(Error('Pinned source hostname mismatch')); return; }
        if (options?.all) callback(null, [{ address, family: 4 }]);
        else callback(null, address, 4);
      },
      maxHeaderSize: 16384,
      headers: {
        Accept: 'text/plain, text/html, application/json, application/xml, text/xml',
        'Accept-Encoding': 'identity',
        'User-Agent': 'OpenMathematics-Provenance/1',
      },
    }, request, controller.signal);
    if (bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw Error('PDF source bodies are unsupported');
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!decoded.includes(quote)) throw Error('Reviewed quote does not literally occur in the retrieved source');
    const retrievedAt = Math.floor(now() / 1000);
    if (!Number.isSafeInteger(retrievedAt) || retrievedAt < 0) throw Error('Invalid retrieval clock');
    return {
      reference,
      content_hash: createHash('sha256').update(bytes).digest('hex'),
      retrieved_at: retrievedAt,
      excerpt: quote,
    };
  } finally {
    clearTimeout(timer);
    dns?.cancel();
    agent.destroy();
  }
}
