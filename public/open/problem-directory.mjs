import deployments from './wallet-tracks.json' with {type:'json'};
import {SNAPSHOT_RECORD_LIMIT, validatePoints, validateSnapshotRecord} from '../../src/open-snapshot.mjs';
import {buildResearchView} from '../../src/open-research-view.mjs';

export const trackNames = {
  'p-vs-np': 'P vs NP',
  'yang-mills': 'Yang–Mills',
  'post-quantum-signatures': 'Post-Quantum Cryptography',
};

export const otherTrackContracts = Object.fromEntries(Object.entries(deployments)
  .filter(([id]) => id !== 'p-vs-np').map(([id, track]) => [id, track.ledger]));

export function trackResources(id, ledger = deployments[id].ledger) {
  return {
    contract: 'https://studio.genlayer.com/contracts?import-contract=' + ledger,
    evidence: 'https://github.com/MuncleUscles/' + id + '/tree/evidence',
  };
}

export async function readTrackActivity(id, read) {
  const {ledger, policy} = deployments[id];
  const config = await read('get_config', []);
  if (config.problem !== id || config.repository !== 'MuncleUscles/' + id || config.policy !== policy) {
    throw Error('Ledger configuration mismatch for ' + id);
  }
  const count = await read('count_contributions', []);
  if (!/^(0|[1-9][0-9]*)$/.test(String(count)) || !Number.isSafeInteger(Number(count))) {
    throw Error('Invalid contribution count for ' + id);
  }
  const points = await read('get_points', [config.verifier]);
  validatePoints(points, {deployment: {problem: id}});
  return {ledger, count: String(count), points, earned: String(points.total_awarded),
    upstream: String(points.total_impact_points), checkedAt: new Date().toISOString()};
}

// Fetch a bounded page on its own finalized ledger. Record IDs and point totals
// have meaning only within that ledger.
export async function readTrackPage(id, read, summary, end = Number(summary.count)) {
  const total = Number(summary.count);
  if (!Number.isSafeInteger(end) || end < 0 || end > total) throw Error('Invalid page boundary');
  const size = Math.min(SNAPSHOT_RECORD_LIMIT, end), offset = end - size;
  if (!size) return {offset, rows: []};
  const {items, total: pageTotal} = await read('list_contributions', [offset, size]);
  if (Number(pageTotal) !== total || !Array.isArray(items) || items.length !== size ||
      new Set(items).size !== size || !items.every(key => typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(key))) {
    throw Error('Ledger changed or returned an invalid contribution page');
  }
  const problem = {deployment: {problem: id, repository: 'MuncleUscles/' + id, branch: 'research',
    contract: deployments[id].ledger}, policyHash: deployments[id].policy};
  const records = [], impacts = [];
  for (const key of items) {
    const record = await read('get', [key]), impact = await read('get_impact', [key]);
    validateSnapshotRecord(record, impact, key, problem);
    records.push(record);
    impacts.push(impact);
  }
  const view = buildResearchView({records, impacts, count: summary.count, points: summary.points});
  const rows = view.contributions.map((c, index) => ({
    id: c.id, title: c.title, claim: c.claim, pr: c.pr, status: c.status, stateLabel: c.stateLabel,
    evidenceKind: c.evidenceKind, evidenceLabel: c.evidenceLabel, researchDirection: c.researchDirection,
    wallet: c.wallet, githubAuthorId: c.githubAuthorId, authorPoints: c.authorPoints,
    submittedAt: records[index].evidence.claim_comment_created_at,
  }));
  return {offset, rows};
}

export async function readTrackFeed(id, read) {
  const summary = await readTrackActivity(id, read);
  return {...summary, ...await readTrackPage(id, read, summary)};
}

export function combineTrackFeeds(activity) {
  const covered = [], contributions = [];
  let total = 0n;
  for (const track of Object.keys(trackNames)) {
    const value = activity.get(track);
    if (!Array.isArray(value?.rows)) continue;
    covered.push(track);
    total += BigInt(value.count);
    for (const row of value.rows) contributions.push({...row, track});
  }
  contributions.sort((a,b) => (Date.parse(b.submittedAt) || 0) - (Date.parse(a.submittedAt) || 0) ||
    a.track.localeCompare(b.track) || b.id.localeCompare(a.id));
  return {covered, contributions, total};
}

export function activityLabel({count, earned, upstream}) {
  if (count === '0' && earned === '0') return 'No contributions yet';
  const format = value => BigInt(value).toLocaleString('en-US');
  const parts = [format(count) + (count === '1' ? ' contribution' : ' contributions')];
  if (earned !== '0') parts.push(format(earned) + (earned === '1' ? ' point earned' : ' points earned'));
  if (upstream !== '0') parts.push(format(upstream) + ' attributed upstream');
  return parts.join(' · ');
}
// A native ledger is shown only for a track with a reviewed deployment.
const openIntake = 'Submissions are open. Lean checks formal proofs, and this track’s GenLayer Studio contract awards research credit after an approved contribution merges.';

const tracks = new Map([
  ['yang-mills', {
    title: 'Yang–Mills existence and mass gap',
    question: 'Is there a gap above the vacuum?',
    description: 'In quantum theory, the vacuum is the lowest-energy state. A positive mass gap means every excitation costs at least some fixed amount of energy. OpenAI has published a construction for the existence part of the four-dimensional problem. The positive mass gap remains open. Can a proof give a strictly positive lower bound in the continuum theory?',
    direction: 'A useful partial result might show how a lower bound depends on lattice spacing or volume. State which estimates survive the continuum and infinite-volume limits.',
    sourceLabel: 'Official Clay problem statement',
    intake: openIntake,
    source: 'https://www.claymath.org/millennium/yang-mills-the-maths-gap/',
  }],
  ['post-quantum-signatures', {
    title: 'Post-Quantum Signature Aggregation',
    question: 'Can the apes make quantum-safe signatures cheaper?',
    description: 'Ethereum validators use BLS signatures to combine many attestations into one small signature. A sufficiently powerful quantum computer could break the elliptic-curve assumption behind BLS. With hash-based signatures, one route to aggregation is a succinct proof that every individual signature verifies.',
    direction: 'The first research front is incomparable encodings for hash-chain signatures. Can an encoding make those checks cheaper at the same security level? A contribution can also establish a lower bound on what any encoding in a specified model can achieve.',
    sourceLabel: 'Read the hash-based multisignature paper',
    source: 'https://eprint.iacr.org/2025/055',
    intake: openIntake,
  }],
]);

export function getProblemTrack(id) {
  return tracks.get(id);
}

let displayed;
export function showProblemTrack(id, track) {
  if (displayed === id) return;
  displayed = id;
  const field = name => document.getElementById('track-' + name);
  for (const name of ['title', 'question', 'description', 'direction']) field(name).textContent = track[name];
  field('source').href = track.source;
  field('source').textContent = track.sourceLabel;
  field('intake').textContent = track.intake;
  document.querySelectorAll('[data-track-details]').forEach(node => {
    node.hidden = node.dataset.trackDetails !== id;
  });

  const repository = 'MuncleUscles/' + id;
  const github = 'https://github.com/' + repository;
  field('guide').href = github + '/blob/main/AGENTS.md';
  field('work').href = github + '/pulls?q=is%3Apr+base%3Aresearch';
  field('contract').href = trackResources(id).contract;
}
