import test from 'node:test';
import assert from 'node:assert/strict';
import {buildResearchView} from '../src/open-research-view.mjs';

const address = digit => '0x' + digit.repeat(40);
function credited(id, owner = address('a'), overrides = {}) {
  return {status: 'credited', digest: id + '-digest', credited_points: '400', award_budget: '400', initial_paid: '320',
    impact_reserve: '80', reserve_returned: '80', reserve_settled: true, verdict: {reason: 'Useful integration of known mathematics.'},
    evidence: {id, wallet: owner, pr: '7', head: 'a'.repeat(40), claim: 'A precise result about the submitted mathematical definitions.',
      context: JSON.stringify({title: 'Result ' + id}), evidence_kind: 'formal', verification: 'verified', formal_statement: 'True',
      research_direction: 'Boolean formula reasoning', dependencies: [], verified_dependencies: [], artifact_hash: id + '-artifact'}, ...overrides};
}
const returned = r => ({downstream: r.evidence.id, source_digest: r.digest, status: 'settled', budget: r.impact_reserve,
  allocations: [], paid_points: '0', returned_points: r.reserve_returned});
const none = r => ({downstream: r.evidence.id, status: 'not-requested'});
function totals({author = '400', impact = '0', reserved = '0', returned = '80', notes = '0'} = {}) {
  return {total_initial_points: author, total_impact_points: impact, total_awarded: String(BigInt(author) + BigInt(impact)),
    total_returned_points: returned, total_note_points: notes, total_reserved_points: reserved,
    total_award_budgets: String(BigInt(author) + BigInt(impact) + BigInt(reserved))};
}
const build = (records, impacts = records.map(returned), points = totals(), count = records.length) => buildResearchView({records, impacts, count, points});
function dependent(upstream, {sameWallet = false, settled = true} = {}) {
  const r = credited('downstream', sameWallet ? upstream.evidence.wallet.toUpperCase().replace('0X', '0x') : address('b'), {
    credited_points: settled ? '374' : '320', reserve_returned: settled ? '54' : '0', reserve_settled: settled,
  });
  r.evidence.dependencies = [upstream.evidence.id];
  r.evidence.verified_dependencies = [{id: upstream.evidence.id, artifact_hash: upstream.evidence.artifact_hash, proof_body_use: true}];
  const impact = {downstream: r.evidence.id, source_digest: r.digest, status: settled ? 'settled' : 'provisional', budget: '80',
    allocations: [{id: upstream.evidence.id, points: '26', band: 1, reason: 'Substantive direct use.'}], paid_points: settled ? '26' : '0', returned_points: settled ? '54' : '0'};
  return {r, impact};
}

test('carried author credit includes returned reserve once, without adding global balances', () => {
  const a = credited('inherited-a');
  a.evidence.contract = address('1'); // Original contract identity remains data.
  const result = build([a]);
  assert.equal(result.leaderboard[0].earnedPoints, '400');
  assert.equal(result.leaderboard[0].returnedPoints, '80');
  assert.equal(result.leaderboard[0].rank, 1);
  assert.equal(result.coverage.ranked, true);
  assert.equal(result.coverage.computed.earnedPoints, '400');
});

test('settled attribution goes to upstream wallet while downstream retains only its own credit', () => {
  const a = credited('a'), {r: b, impact} = dependent(a);
  const view = build([a, b], [returned(a), impact], totals({author: '774', impact: '26', returned: '134'}));
  assert.deepEqual(view.leaderboard.map(row => [row.earnedPoints, row.authorPoints, row.impactPoints, row.rank]), [['426', '400', '26', 1], ['374', '374', '0', 2]]);
  assert.equal(view.graph.edges[0].kind, 'verified');
  assert.equal(view.graph.edges[0].settledPoints, '26');
  assert.equal(view.coverage.computed.earnedPoints, '800');
});

test('different casing and multiple results for one wallet share a single earned total', () => {
  const a = credited('a'), {r: b, impact} = dependent(a, {sameWallet: true});
  const view = build([a, b], [returned(a), impact], totals({author: '774', impact: '26', returned: '134'}));
  assert.equal(view.leaderboard.length, 1);
  assert.equal(view.leaderboard[0].wallet, address('a'));
  assert.equal(view.leaderboard[0].earnedPoints, '800');
  assert.equal(view.leaderboard[0].acceptedContributions, 2);
});

test('pending reserve and proposed allocations are not earned points', () => {
  const a = credited('a'), {r: b, impact} = dependent(a, {settled: false});
  const view = build([a, b], [returned(a), impact], totals({author: '720', reserved: '80'}));
  assert.equal(view.coverage.ranked, true);
  assert.deepEqual(view.leaderboard.map(row => row.earnedPoints), ['400', '320']);
  assert.equal(view.graph.edges[0].settledPoints, '0');
  assert.equal(view.graph.edges[0].proposedPoints, '26');
  assert.equal(view.contributions[1].reservePoints, '80');
});

test('a partial newest page cannot rank even if its visible totals happen to match', () => {
  const a = credited('a');
  const view = build([a], [returned(a)], totals(), '13');
  assert.equal(view.coverage.status, 'partial');
  assert.equal(view.coverage.ranked, false);
  assert.equal(view.leaderboard[0].rank, null);
  assert.match(view.coverage.label, /1 of 13/);
});

test('unloaded upstream wallet stays unknown and never receives guessed allocation credit', () => {
  const a = credited('a'), {r: b, impact} = dependent(a);
  const view = build([b], [impact], totals({author: '774', impact: '26', returned: '134'}), 2);
  assert.deepEqual(view.coverage.missingDependencies, ['a']);
  assert.equal(view.graph.edges[0].recipientWallet, null);
  assert.equal(view.graph.nodes.find(node => node.id === 'a').loaded, false);
  assert.equal(view.leaderboard[0].earnedPoints, '374');
  assert.equal(view.leaderboard[0].rank, null);
  assert.throws(() => build([b], [impact], totals({author: '374', impact: '26', returned: '54'})), /missing a dependency wallet/);
});

test('complete but temporally inconsistent totals suppress rankings instead of fabricating reconciliation', () => {
  const a = credited('a');
  const view = build([a], [returned(a)], totals({author: '800', returned: '160'}));
  assert.equal(view.coverage.complete, true);
  assert.equal(view.coverage.reconciled, false);
  assert.equal(view.coverage.status, 'unreconciled');
  assert.ok(view.coverage.mismatches.includes('earnedPoints'));
  assert.equal(view.leaderboard[0].rank, null);
});

test('giant native integers and tied ranks are exact and remain JSON-safe', () => {
  const huge = '900719925474099312345';
  const note = id => credited(id, id === 'a' ? address('a') : address('b'), {credited_points: huge, award_budget: huge,
    initial_paid: huge, impact_reserve: '0', reserve_returned: '0', evidence: {...credited(id).evidence, id, wallet: id === 'a' ? address('a') : address('b'), evidence_kind: 'research-note', verification: 'not-formal', formal_statement: ''}});
  const a = note('a'), b = note('b'), sum = String(BigInt(huge) * 2n);
  const view = build([a, b], [none(a), none(b)], totals({author: sum, returned: '0', notes: sum}));
  assert.deepEqual(view.leaderboard.map(row => [row.earnedPoints, row.rank]), [[huge, 1], [huge, 1]]);
  assert.doesNotThrow(() => JSON.stringify(view));
  assert.throws(() => build([a], [none(a)], {...totals(), total_awarded: Number.MAX_SAFE_INTEGER + 1}), /invalid integer/);
});

test('rejected, unresolved and withdrawn records have no points or rank and retain accurate labels', () => {
  const records = ['rejected', 'submitted', 'expired'].map((status, index) => {
    const r = credited('zero-' + index, address(String(index + 1)), {status, credited_points: '0', verdict: null});
    for (const field of ['award_budget', 'initial_paid', 'impact_reserve', 'reserve_returned', 'reserve_settled']) delete r[field];
    return r;
  });
  const view = build(records, records.map(none), totals({author: '0', returned: '0'}));
  assert.ok(view.leaderboard.every(row => row.earnedPoints === '0' && row.rank === null));
  assert.equal(view.contributions[1].stateLabel, 'Awaiting an agreed verdict');
  assert.equal(view.contributions[2].stateLabel, 'Closed without credit');
  assert.match(view.contributions[2].reason, /Closed without a merit verdict or points/);
  assert.throws(() => build([{...records[0], credited_points: '1'}], [none(records[0])], totals({author: '0', returned: '0'})), /uncredited contribution/);
});

test('titles and selected context stay plain bounded text; malformed context has a useful fallback', () => {
  const a = credited('a');
  a.evidence.context = JSON.stringify({title: '<img src=x onerror=alert(1)>', novelty: ['not text'], attribution: 'Author\u0000', ignored: '<script>attack</script>'});
  const view = build([a]);
  assert.equal(view.contributions[0].title, '<img src=x onerror=alert(1)>');
  assert.equal(view.contributions[0].context.novelty, '');
  assert.equal(view.contributions[0].context.attribution, 'Author');
  assert.equal(Object.hasOwn(view.contributions[0].context, 'ignored'), false);
  a.evidence.context = 'invalid json';
  assert.equal(build([a]).contributions[0].title, a.evidence.claim);
});

test('references remain references and cannot become paid impact edges', () => {
  const a = credited('a'), {r: b, impact} = dependent(a);
  b.evidence.verified_dependencies = [];
  assert.throws(() => build([a, b], [returned(a), impact], totals({author: '774', impact: '26', returned: '134'})), /ineligible impact recipient/);
  b.credited_points = '400'; b.reserve_returned = '80';
  const view = build([a, b], [returned(a), returned(b)], totals({author: '800', returned: '160'}));
  assert.equal(view.graph.edges[0].kind, 'reference');
  assert.equal(view.graph.edges[0].settledPoints, '0');
});

test('duplicate identities, mismatched records and inconsistent allocations fail closed', () => {
  const a = credited('a'), {r: b, impact} = dependent(a);
  assert.throws(() => build([a, a]), /duplicate contribution ID/);
  assert.throws(() => build([a, b], [returned(a), returned(a)]), /mismatched impact/);
  assert.throws(() => build([a], [{...returned(a), source_digest: 'different'}]), /impact source/);
  assert.throws(() => build([a, b], [returned(a), {...impact, paid_points: '27'}]), /accounting mismatch/);
  assert.throws(() => build([a, b], [returned(a), {...impact, allocations: [...impact.allocations, ...impact.allocations]}]), /duplicate or ineligible/);
  b.evidence.verified_dependencies[0].artifact_hash = 'different';
  assert.throws(() => build([a, b], [returned(a), impact]), /artifact mismatch/);
});

test('an empty authenticated ledger has complete zero totals and no invented winners', () => {
  const view = build([], [], totals({author: '0', returned: '0'}));
  assert.equal(view.coverage.reconciled, true);
  assert.deepEqual(view.leaderboard, []);
  assert.deepEqual(view.graph, {nodes: [], edges: []});
});

test('one GitHub account consolidates multiple wallets without changing wallet accounting', () => {
  const a = credited('a', address('a')), b = credited('b', address('b'));
  a.evidence.github_author_id = 2372232; b.evidence.github_author_id = '2372232';
  const view = build([a, b], [returned(a), returned(b)], totals({author: '800', returned: '160'}));
  assert.deepEqual(view.leaderboard.map(row => [row.wallet, row.earnedPoints, row.rank]), [[address('a'), '400', 1], [address('b'), '400', 1]]);
  assert.equal(view.contributorLeaderboard.length, 1);
  assert.deepEqual(view.contributorLeaderboard[0], {contributorKey: 'github:2372232', githubAuthorId: '2372232',
    wallets: [address('a'), address('b')], authorPoints: '800', impactPoints: '0', earnedPoints: '800', returnedPoints: '160',
    notePoints: '0', acceptedContributions: 2, formalContributions: 2, contributionIds: ['a', 'b'], rank: 1});
  assert.ok(view.contributions.every(row => row.githubAuthorId === '2372232'));
  assert.equal(view.coverage.contributorRanked, true);
});

test('a shared wallet does not merge different attested GitHub accounts', () => {
  const a = credited('a'), b = credited('b', address('A'));
  a.evidence.github_author_id = 17; b.evidence.github_author_id = 18n;
  const view = build([a, b], [returned(a), returned(b)], totals({author: '800', returned: '160'}));
  assert.equal(view.leaderboard.length, 1); assert.equal(view.leaderboard[0].earnedPoints, '800');
  assert.deepEqual(view.contributorLeaderboard.map(row => [row.githubAuthorId, row.wallets, row.earnedPoints, row.rank]),
    [['17', [address('a')], '400', 1], ['18', [address('a')], '400', 1]]);
});

test('upstream impact follows the original contribution author even when wallets are shared', () => {
  const a = credited('a'), {r: b, impact} = dependent(a, {sameWallet: true});
  a.evidence.github_author_id = '17'; b.evidence.github_author_id = '18';
  // Process downstream first to exclude any dependency on insertion order or
  // a last-seen account for this shared wallet.
  const view = build([b, a], [impact, returned(a)], totals({author: '774', impact: '26', returned: '134'}));
  assert.deepEqual(view.contributorLeaderboard.map(row => [row.githubAuthorId, row.authorPoints, row.impactPoints, row.earnedPoints, row.rank]),
    [['17', '400', '26', '426', 1], ['18', '374', '0', '374', 2]]);
  assert.equal(view.leaderboard[0].earnedPoints, '800');
  assert.deepEqual(view.contributorLeaderboard[0].contributionIds, ['a']);
});

test('same-account cross-wallet attribution remains within the result budgets', () => {
  const a = credited('a'), {r: b, impact} = dependent(a);
  a.evidence.github_author_id = 17; b.evidence.github_author_id = 17;
  const view = build([a, b], [returned(a), impact], totals({author: '774', impact: '26', returned: '134'}));
  assert.deepEqual(view.contributorLeaderboard.map(row => [row.authorPoints, row.impactPoints, row.earnedPoints]), [['774', '26', '800']]);
  assert.equal(view.coverage.global.earnedPoints, '800');
});

test('missing and malformed GitHub IDs get separate fallback rows and disable contributor ranks', () => {
  for (const invalid of [undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, true, {}, '', '0', '01', '-2', '1e2', ' 17 ', '9'.repeat(79)]) {
    const a = credited('a'), b = credited('b');
    a.evidence.github_author_id = 17; b.evidence.github_author_id = invalid;
    const view = build([a, b], [returned(a), returned(b)], totals({author: '800', returned: '160'}));
    assert.equal(view.coverage.ranked, true); // Native wallet accounting is still complete.
    assert.equal(view.coverage.contributorRanked, false);
    assert.equal(view.coverage.contributorStatus, 'unidentified');
    assert.deepEqual(view.coverage.missingAuthorIds, ['b']);
    assert.ok(view.contributorLeaderboard.every(row => row.rank === null));
    const fallback = view.contributorLeaderboard.find(row => row.githubAuthorId === null);
    assert.equal(fallback.contributorKey, 'contribution:b');
    assert.equal(fallback.earnedPoints, '400');
    assert.deepEqual(fallback.wallets, [address('a')]);
    assert.equal(view.contributions[1].githubAuthorId, null);
  }
  const a = credited('a'), b = credited('b');
  const unknown = build([a, b], [returned(a), returned(b)], totals({author: '800', returned: '160'}));
  assert.deepEqual(unknown.contributorLeaderboard.map(row => row.contributorKey), ['contribution:a', 'contribution:b']);
});

test('attribution to an unidentified upstream record is retained without guessing its account', () => {
  const a = credited('a'), {r: b, impact} = dependent(a, {sameWallet: true});
  b.evidence.github_author_id = 18;
  const view = build([a, b], [returned(a), impact], totals({author: '774', impact: '26', returned: '134'}));
  const fallback = view.contributorLeaderboard.find(row => row.githubAuthorId === null);
  assert.equal(fallback.earnedPoints, '426'); assert.equal(fallback.impactPoints, '26');
  assert.equal(view.contributorLeaderboard.find(row => row.githubAuthorId === '18').earnedPoints, '374');
  assert.ok(view.contributorLeaderboard.every(row => row.rank === null));
});

test('contributor ranks obey the same complete-ledger and reconciliation gates', () => {
  const a = credited('a'); a.evidence.github_author_id = '900719925474099312345';
  const partial = build([a], [returned(a)], totals(), 2);
  assert.equal(partial.contributorLeaderboard[0].githubAuthorId, '900719925474099312345');
  assert.equal(partial.contributorLeaderboard[0].rank, null);
  assert.equal(partial.coverage.contributorStatus, 'partial');
  const changed = build([a], [returned(a)], totals({author: '800', returned: '160'}));
  assert.equal(changed.contributorLeaderboard[0].rank, null);
  assert.equal(changed.coverage.contributorStatus, 'unreconciled');
  assert.doesNotThrow(() => JSON.stringify(changed));
});
