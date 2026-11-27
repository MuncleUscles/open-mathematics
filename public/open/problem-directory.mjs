import deployments from './wallet-tracks.json' with {type:'json'};
import {validatePoints} from '../../src/open-snapshot.mjs';

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
  return {ledger, count: String(count), earned: String(points.total_awarded),
    upstream: String(points.total_impact_points), checkedAt: new Date().toISOString()};
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
