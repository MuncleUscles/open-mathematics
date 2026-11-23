// A bounded, dated read model. This module never signs or authorizes a mutation.
export const SNAPSHOT_RECORD_LIMIT = 12;
export const SNAPSHOT_READ_LIMIT = 28;
export const SNAPSHOT_BYTE_LIMIT = 4 * 1024 * 1024;
const need = (ok, message) => { if (!ok) throw Error('Open ledger snapshot: ' + message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const commit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const address = value => typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
const integer = value => typeof value === 'number' ? Number.isSafeInteger(value) && value >= 0 : typeof value === 'string' && value.length <= 78 && /^(0|[1-9][0-9]*)$/.test(value);
const text = (value, maximum) => typeof value === 'string' && value.length <= maximum;
const same = (left, right) => canonical(left) === canonical(right);
const canonical = value => JSON.stringify(sort(value));
const sort = value => Array.isArray(value) ? value.map(sort) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : typeof value === 'number' ? String(value) : value;
export const normalizeOpenRead = value => value instanceof Map ? Object.fromEntries([...value].map(([key, item]) => [key, normalizeOpenRead(item)])) : Array.isArray(value) ? value.map(normalizeOpenRead) : typeof value === 'bigint' ? String(value) : object(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeOpenRead(item)])) : value;

export function openSnapshotIdentity(problem) {
  const d = problem.deployment;
  return {contract: d.contract, chainId: d.chainId, codeHash: d.codeHash, policy: problem.policyHash,
    protocolCommit: problem.descriptor.protocol.commit, problem: d.problem, repository: d.repository, branch: d.branch};
}

export function validateSnapshotConfig(config, problem) {
  const d = problem.deployment;
  const expected = {version: 5, problem: d.problem, repository: d.repository, branch: d.branch,
    verifier: d.verifier, executor: d.executor, window: d.windowSeconds,
    minimum_account_age_days: d.minimumGitHubAccountAgeDays, policy: problem.policyHash,
    objective: problem.policy.objective, legacy_ledgers: d.legacyLedgers};
  // Native address casing is immaterial; all other constructor fields must match.
  const addresses = value => ({...value, verifier: value?.verifier?.toLowerCase(), executor: value?.executor?.toLowerCase(),
    legacy_ledgers: value?.legacy_ledgers?.map(item => ({...item, address: item.address?.toLowerCase()}))});
  need(object(config) && same(addresses(config), addresses(expected)), 'native configuration mismatch');
  return config;
}

function validatePoints(points, problem) {
  need(object(points) && points.problem === problem.deployment.problem && points.transferable === false, 'point scope mismatch');
  for (const key of ['total_awarded', 'total_initial_points', 'total_impact_points', 'total_note_points', 'total_returned_points', 'total_award_budgets', 'total_reserved_points']) need(integer(points[key]), 'invalid point totals');
  need(BigInt(points.total_awarded) + BigInt(points.total_reserved_points) === BigInt(points.total_award_budgets), 'award budget mismatch');
  need(BigInt(points.total_initial_points) + BigInt(points.total_impact_points) === BigInt(points.total_awarded), 'issued point mismatch');
  need(BigInt(points.total_note_points) <= BigInt(points.total_initial_points) && BigInt(points.total_returned_points) <= BigInt(points.total_initial_points), 'point subset mismatch');
}

export function validateSnapshotRecord(record, impact, contributionId, problem) {
  const e = record?.evidence, d = problem.deployment;
  need(object(record) && object(e) && e.id === contributionId && e.problem === d.problem && e.repository === d.repository && e.branch === d.branch && e.policy === problem.policyHash && typeof e.contract === 'string' && e.contract.toLowerCase() === d.contract.toLowerCase(), 'record scope mismatch');
  need(['submitted', 'provisional', 'challenged', 'approved', 'credited', 'rejected', 'expired'].includes(record.status) && integer(record.credited_points) && hash(record.digest), 'invalid native record');
  need(['head', 'base', 'protocol_commit', 'worker_commit'].every(key => commit(e[key])) && e.protocol_commit === e.worker_commit, 'invalid original record source pins');
  need(address(e.wallet) && integer(e.pr) && Number.isSafeInteger(Number(e.pr)) && Number(e.pr) > 0, 'invalid contributor reference');
  need(text(e.claim, 4000) && text(e.context, 12000) && text(e.research_direction, 160) && text(e.formal_statement, 4000), 'invalid display evidence');
  need(e.evidence_kind === 'formal' && e.verification === 'verified' || e.evidence_kind === 'research-note' && e.verification === 'not-formal' && e.formal_statement === '', 'formal evidence label mismatch');
  need(Array.isArray(e.dependencies) && e.dependencies.length <= 8 && e.dependencies.every(id) && new Set(e.dependencies).size === e.dependencies.length, 'invalid dependencies');
  need(Array.isArray(e.verified_dependencies) && e.verified_dependencies.length <= 8 && e.verified_dependencies.every(use => object(use) && e.dependencies.includes(use.id) && use.proof_body_use === true && hash(use.artifact_hash)), 'invalid direct proof use');
  need(record.verdict === null || object(record.verdict) && text(record.verdict.reason, 4000), 'invalid verdict');
  for (const key of ['award_budget', 'initial_paid', 'impact_reserve', 'reserve_returned']) if (record[key] !== undefined) need(integer(record[key]), 'invalid record points');
  need(object(impact) && impact.downstream === contributionId && ['not-requested', 'provisional', 'challenged', 'settled'].includes(impact.status), 'impact scope mismatch');
  if (impact.status !== 'not-requested') {
    need(Array.isArray(impact.allocations) && impact.allocations.length <= 8 && impact.allocations.every(allocation => object(allocation) && id(allocation.id) && integer(allocation.points) && text(allocation.reason, 4000)), 'invalid impact allocations');
    need(text(impact.reason, 4000), 'invalid impact reason');
    for (const key of ['budget', 'paid_points', 'returned_points']) if (impact[key] !== undefined) need(integer(impact[key]), 'invalid impact points');
  }
  return record;
}

export function validateOpenSnapshot(snapshot, problem, {now = Date.now()} = {}) {
  need(object(snapshot) && new TextEncoder().encode(JSON.stringify(snapshot)).length <= SNAPSHOT_BYTE_LIMIT, 'snapshot exceeds size limit');
  need(snapshot.version === 1 && snapshot.readMode === 'latest-final' && snapshot.atomic === false && same(snapshot.identity, openSnapshotIdentity(problem)), 'deployment or source pin mismatch');
  const started = Date.parse(snapshot.startedAt), completed = Date.parse(snapshot.completedAt);
  need(Number.isFinite(started) && completed >= started && completed - started <= 300000 && completed <= now + 60000, 'invalid capture interval');
  validateSnapshotConfig(snapshot.config, problem);
  validatePoints(snapshot.points, problem);
  need(integer(snapshot.count) && Number.isSafeInteger(Number(snapshot.count)), 'invalid contribution count');
  const count = Number(snapshot.count), size = Math.min(SNAPSHOT_RECORD_LIMIT, count), offset = count - size;
  need(snapshot.offset === offset && Array.isArray(snapshot.records) && snapshot.records.length === size && Array.isArray(snapshot.impacts) && snapshot.impacts.length === size, 'bounded newest page required');
  const ids = snapshot.records.map(record => record?.evidence?.id);
  need(ids.every(id) && new Set(ids).size === size, 'duplicate or invalid record IDs');
  for (let i = 0; i < size; i++) validateSnapshotRecord(snapshot.records[i], snapshot.impacts[i], ids[i], problem);
  const calls = [['get_config', []], ['count_contributions', []], ['get_points', [problem.deployment.verifier]]];
  if (size) calls.push(['list_contributions', [offset, size]]);
  for (const contributionId of ids) calls.push(['get', [contributionId]], ['get_impact', [contributionId]]);
  need(Array.isArray(snapshot.reads) && snapshot.reads.length === calls.length && calls.length <= SNAPSHOT_READ_LIMIT, 'read budget mismatch');
  let previous = started;
  snapshot.reads.forEach((read, index) => {
    const at = Date.parse(read.at);
    need(same(read.call, calls[index]) && at >= previous && at <= completed, 'invalid read provenance');
    previous = at;
  });
  return snapshot;
}

export async function collectOpenSnapshot({problem, read, now = () => new Date().toISOString()}) {
  const startedAt = now(), reads = [];
  const view = async (method, args = []) => {
    need(reads.length < SNAPSHOT_READ_LIMIT, 'read budget exceeded');
    const value = normalizeOpenRead(await read(method, args));
    const at = now();
    need(Date.parse(at) - Date.parse(startedAt) <= 300000, 'capture interval exceeded');
    reads.push({call: [method, args], at});
    return value;
  };
  const config = validateSnapshotConfig(await view('get_config'), problem);
  const count = await view('count_contributions');
  need(integer(count) && Number.isSafeInteger(Number(count)), 'invalid contribution count');
  const points = await view('get_points', [problem.deployment.verifier]);
  validatePoints(points, problem);
  const size = Math.min(SNAPSHOT_RECORD_LIMIT, Number(count)), offset = Number(count) - size;
  let ids = [];
  if (size) {
    const page = await view('list_contributions', [offset, size]);
    need(object(page) && Number(page.total) === Number(count) && page.next_offset === null && Array.isArray(page.items) && page.items.length === size && page.items.every(id) && new Set(page.items).size === size, 'ledger page changed or is malformed');
    ids = page.items;
  }
  const records = [], impacts = [];
  for (const contributionId of ids) {
    const record = await view('get', [contributionId]), impact = await view('get_impact', [contributionId]);
    validateSnapshotRecord(record, impact, contributionId, problem);
    records.push(record); impacts.push(impact);
  }
  return validateOpenSnapshot({version: 1, identity: openSnapshotIdentity(problem), readMode: 'latest-final', atomic: false,
    startedAt, completedAt: now(), reads, config, count: String(count), points, offset, records, impacts}, problem);
}

export function openSnapshotLabel(snapshot) {
  return `Published snapshot from ${snapshot.completedAt}; live unavailable. Finalized views collected ${snapshot.startedAt}–${snapshot.completedAt}, not an atomic snapshot. Showing ${snapshot.records.length} newest contributions. This read-only copy cannot authorize merges or points.`;
}

export async function chooseOpenLedgerView({loadLive, loadPublished, current = null}) {
  try { return {mode: 'live', snapshot: await loadLive(), changed: true}; }
  catch (error) {
    // Do not replace a newer successful live view with an older published copy.
    if (current?.mode === 'live') return {...current, changed: false, unavailable: true, error};
    try { return {mode: 'published', snapshot: await loadPublished(), changed: true, unavailable: true, error}; }
    catch (snapshotError) { return current ? {...current, changed: false, unavailable: true, error, snapshotError} : {mode: 'unavailable', changed: false, error, snapshotError}; }
  }
}
