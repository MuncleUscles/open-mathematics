// Public GitHub profile only: https://docs.github.com/en/rest/users/users#get-a-user
// Account age is a basic admission rule, not proof of uniqueness or research merit.
const DAY_MS = 86_400_000;
const MAX_BYTES = 65_536;
const TIMEOUT_MS = 8_000;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const CREATED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

class GitHubIdentityError extends Error { constructor(code, message) { super(message); this.code = code; } }
function reject(code, message) { throw new GitHubIdentityError(code, message); }
function check(ok, code, message) { if (!ok) reject(code, message); }
function strictISO(value, pattern) {
  check(typeof value === 'string' && pattern.test(value), 'IDENTITY_TIMESTAMP', 'Strict UTC identity timestamp required');
  const milliseconds = Date.parse(value);
  check(Number.isSafeInteger(milliseconds) && milliseconds >= 0 &&
    new Date(milliseconds).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z')),
    'IDENTITY_TIMESTAMP', 'Valid UTC identity timestamp required');
  return milliseconds;
}
function settings({at, minimumAgeDays = 30} = {}) {
  check(Number.isSafeInteger(minimumAgeDays) && minimumAgeDays >= 1 && minimumAgeDays <= 3650,
    'IDENTITY_POLICY', 'Minimum GitHub account age must be an integer from 1 to 3650 days');
  const time = typeof at === 'string' ? strictISO(at, AT) : at;
  check(Number.isSafeInteger(time) && time >= 0 && time <= Date.now(), 'IDENTITY_TIMESTAMP',
    'Original claim time or current CLI time must be nonfuture Unix milliseconds or a strict UTC ISO timestamp');
  return {time, minimumAgeDays};
}

export function validateGitHubIdentityEvidence(evidence, options) {
  const {time, minimumAgeDays} = settings(options);
  check(evidence && typeof evidence === 'object' && !Array.isArray(evidence), 'IDENTITY_PROFILE', 'GitHub identity evidence required');
  const created = evidence.github_account_created_at;
  check(Number.isSafeInteger(created) && created >= 0 && created <= Math.floor(time / 1000),
    'IDENTITY_TIMESTAMP', 'GitHub account creation must be nonfuture integer Unix seconds');
  check(evidence.github_account_type === 'User', 'IDENTITY_TYPE', 'A normal GitHub user account is required for this pilot');
  const eligibleAt = created * 1000 + minimumAgeDays * DAY_MS;
  check(time >= eligibleAt, 'IDENTITY_TOO_YOUNG',
    `GitHub account must be at least ${minimumAgeDays} days old at the original claim time; earliest eligibility is ${new Date(eligibleAt).toISOString()}`);
  return {github_account_created_at: created, github_account_type: 'User'};
}

export function validateGitHubIdentity(profile, {authorId, at, minimumAgeDays = 30} = {}) {
  check(Number.isSafeInteger(authorId) && authorId > 0, 'IDENTITY_AUTHOR', 'Immutable GitHub PR author ID required');
  check(profile && typeof profile === 'object' && !Array.isArray(profile) &&
    Number.isSafeInteger(profile.id) && profile.id === authorId,
    'IDENTITY_AUTHOR', 'Public GitHub profile does not match the immutable PR author ID');
  const created = strictISO(profile.created_at, CREATED);
  return validateGitHubIdentityEvidence({github_account_created_at: created / 1000, github_account_type: profile.type}, {at, minimumAgeDays});
}

async function boundedJSON(response, guarded) {
  const declared = response.headers?.get('content-length');
  check(declared === null || declared === undefined || (/^\d+$/.test(declared) && Number(declared) <= MAX_BYTES),
    'IDENTITY_RESPONSE_SIZE', 'GitHub public profile response exceeds the size limit');
  const type = response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase();
  check(type === 'application/json' || type === 'application/vnd.github+json',
    'IDENTITY_RESPONSE', 'GitHub public profile must be JSON');
  check(response.body && typeof response.body.getReader === 'function', 'IDENTITY_RESPONSE', 'Readable GitHub public profile response required');
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  try {
    for (;;) {
      const {done, value} = await guarded(reader.read());
      if (done) break;
      check(value instanceof Uint8Array, 'IDENTITY_RESPONSE', 'Invalid GitHub public profile response');
      total += value.byteLength;
      check(total <= MAX_BYTES, 'IDENTITY_RESPONSE_SIZE', 'GitHub public profile response exceeds the size limit');
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
    catch { reject('IDENTITY_RESPONSE', 'Malformed GitHub public profile JSON'); }
  } finally {
    reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function fetchGitHubIdentity({github, authorId, login, at, minimumAgeDays = 30} = {}) {
  settings({at, minimumAgeDays});
  check(Number.isSafeInteger(authorId) && authorId > 0, 'IDENTITY_AUTHOR', 'Immutable GitHub PR author ID required');
  check(typeof login === 'string' && LOGIN.test(login), 'IDENTITY_LOGIN', 'Valid normal GitHub account login required');
  check(github && typeof github.fetcher === 'function', 'IDENTITY_CLIENT', 'Trusted GitHub client required');
  check(github.token === undefined || github.token === null ||
    (typeof github.token === 'string' && github.token.length <= 8192 && !/[\r\n]/.test(github.token)),
    'IDENTITY_CLIENT', 'Invalid GitHub client configuration');
  const url = `https://api.github.com/users/${encodeURIComponent(login)}`;
  const controller = new AbortController(); let timer;
  const deadline = new Promise((_, rejectTimeout) => {
    timer = setTimeout(() => { controller.abort(); rejectTimeout(new GitHubIdentityError('IDENTITY_TIMEOUT', 'GitHub public identity request timed out')); }, TIMEOUT_MS);
  });
  const guarded = promise => Promise.race([promise, deadline]);
  try {
    const response = await guarded(github.fetcher(url, {method:'GET', redirect:'error', credentials:'omit',
      headers:{Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28',
        ...(github.token ? {Authorization:`Bearer ${github.token}`} : {})}, signal:controller.signal}));
    check(response?.status === 200 && response.redirected !== true && (!response.url || response.url === url),
      'IDENTITY_RESPONSE', 'GitHub public identity lookup failed or redirected');
    const profile = await boundedJSON(response, guarded);
    return validateGitHubIdentity(profile, {authorId, at, minimumAgeDays});
  } catch (error) {
    if (error instanceof GitHubIdentityError) throw error;
    reject(controller.signal.aborted ? 'IDENTITY_TIMEOUT' : 'IDENTITY_NETWORK',
      controller.signal.aborted ? 'GitHub public identity request timed out' : 'GitHub public identity lookup failed');
  } finally { clearTimeout(timer); controller.abort(); }
}
