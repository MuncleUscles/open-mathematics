// Each address is bound to the matching problem repository's reviewed deployment record.
const tracks = new Map([
  ['yang-mills', {
    title: 'Yang–Mills existence and mass gap',
    question: 'Is there a gap above the vacuum?',
    description: 'In quantum theory, the vacuum is the lowest-energy state. A positive mass gap means every excitation costs at least some fixed amount of energy. OpenAI has published a construction for the existence part of the four-dimensional problem. The positive mass gap remains open. Can a proof give a strictly positive lower bound in the continuum theory?',
    direction: 'A useful partial result might show how a lower bound depends on lattice spacing or volume. State which estimates survive the continuum and infinite-volume limits.',
    source: 'https://www.claymath.org/millennium/yang-mills-the-maths-gap/',
    contract: '0x983d27779dF7D495d4c881Ab0925B42A7bBf76d7',
    policy: '56e3d0e86958d1f5f36976c8eecf234a3f8117557e7c5d6f6f0395d59be6234d',
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
  const repository = 'MuncleUscles/' + id;
  const github = 'https://github.com/' + repository;
  for (const name of ['title', 'question', 'description', 'direction']) field(name).textContent = track[name];
  field('source').href = track.source;
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
