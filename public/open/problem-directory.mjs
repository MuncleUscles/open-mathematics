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
    contract: '0x983d27779dF7D495d4c881Ab0925B42A7bBf76d7',
    policy: '56e3d0e86958d1f5f36976c8eecf234a3f8117557e7c5d6f6f0395d59be6234d',
  }],
  ['post-quantum-signatures', {
    title: 'Post-Quantum Signature Aggregation',
    question: 'Can the apes make quantum-safe signatures cheaper?',
    description: 'Ethereum validators use BLS signatures to combine many attestations into one small signature. A sufficiently powerful quantum computer could break the elliptic-curve assumption behind BLS. With hash-based signatures, one route to aggregation is a succinct proof that every individual signature verifies.',
    direction: 'The first research front is incomparable encodings for hash-chain signatures. Can an encoding make those checks cheaper at the same security level? A contribution can also establish a lower bound on what any encoding in a specified model can achieve.',
    sourceLabel: 'Read the hash-based multisignature paper',
    source: 'https://eprint.iacr.org/2025/055',
    intake: openIntake,
    contract: '0xEC885d69e74De9509938aAa732d1675161299E58',
    policy: '735cd5c67fbc660ca8dab7589222d409c8bc805662612eff10a0ab96309e6ed6',
  }],
]);

export function getProblemTrack(id) {
  return tracks.get(id);
}

let displayed;
export function showProblemTrack(id, track, getReader, preview) {
  const state = id + '/' + String(preview);
  if (displayed === state) return;
  displayed = state;
  const field = name => document.getElementById('track-' + name);
  for (const name of ['title', 'question', 'description', 'direction']) field(name).textContent = track[name];
  field('source').href = track.source;
  field('source').textContent = track.sourceLabel;
  field('intake').textContent = track.intake;
  document.querySelectorAll('[data-track-details]').forEach(node => {
    node.hidden = node.dataset.trackDetails !== id;
  });
  field('ledger').hidden = !track.contract;
  if (!track.contract) return;

  const repository = 'MuncleUscles/' + id;
  const github = 'https://github.com/' + repository;
  field('guide').href = github + '/blob/main/AGENTS.md';
  field('work').href = github + '/pulls?q=is%3Apr+base%3Aresearch';
  field('contract').href = 'https://studio.genlayer.com/contracts?import-contract=' + track.contract;
  const status = field('status');
  if (preview !== false) {
    status.textContent = preview ? 'Local preview.' : 'Loading the dashboard configuration…';
    return;
  }
  status.textContent = 'Reading this problem’s ledger…';
  const load = async () => {
    try {
      const read = getReader(track.contract);
      const config = await read('get_config', []);
      if (config.problem !== id || config.repository !== repository || config.policy !== track.policy) {
        throw Error('Ledger configuration mismatch');
      }
      const page = await read('list_contributions', [0, 1]);
      const count = String(page.total);
      if (!/^(0|[1-9][0-9]*)$/.test(count)) throw Error('Invalid contribution count');
      if (displayed === state) status.textContent = count === '0'
        ? 'No contributions registered yet.'
        : count + (count === '1' ? ' registered contribution.' : ' registered contributions.');
    } catch {
      if (displayed === state) status.textContent = 'Live count unavailable. You can inspect the contract directly.';
    }
  };
  void load();
}
