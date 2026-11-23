// Presentation only: callers must first authenticate records, impacts and their
// deployment with open-snapshot.mjs. Nothing here authorizes a merge or award.
const need = (condition, message) => { if (!condition) throw Error('Research view: ' + message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value);
const amount = (value, name) => {
  need(typeof value === 'bigint' && value >= 0n || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ||
    typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 78, 'invalid integer: ' + name);
  return BigInt(value);
};
const wallet = value => {
  need(typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value), 'invalid recipient wallet');
  return value.toLowerCase();
};
// Strings remain plain text, including any angle brackets; consumers must use
// textContent, never innerHTML. Only selected context fields enter this model.
const plain = (value, maximum = 4000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, maximum) : '';
const contextOf = record => {
  let context = {};
  try { const parsed = JSON.parse(record.evidence.context); if (object(parsed)) context = parsed; } catch {}
  return {title: plain(context.title, 160) || plain(record.evidence.claim, 160) || record.evidence.id,
    novelty: plain(context.novelty), attribution: plain(context.attribution), limitations: plain(context.limitations)};
};
const states = {
  submitted: 'Awaiting an agreed verdict', provisional: 'Decision in challenge window', challenged: 'Under challenge',
  approved: 'Approved · merge pending', credited: 'Accepted · credited', rejected: 'Rejected', expired: 'Closed without credit',
};
const totalFields = {
  authorPoints: 'total_initial_points', impactPoints: 'total_impact_points', earnedPoints: 'total_awarded',
  returnedPoints: 'total_returned_points', notePoints: 'total_note_points', awardBudgets: 'total_award_budgets', reservedPoints: 'total_reserved_points',
};
const zeroTotals = () => Object.fromEntries(Object.keys(totalFields).map(key => [key, 0n]));
const strings = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'bigint' ? String(item) : item]));

/**
 * Build a read-only, JSON-safe view from already validated native reads.
 * records/impacts cover the same unique IDs; count is the whole registry size;
 * points is get_points(...), whose total_* fields are global, not that wallet's.
 * Decimal amount strings use BigInt arithmetic internally. graph edges point
 * from a contribution to its prerequisite; kind is verified or reference.
 * leaderboard[].rank is null unless coverage.ranked is true (full registry,
 * complete dependencies, reconciled totals). Partial totals never imply rank.
 */
export function buildResearchView({records, impacts, count, points}) {
  need(Array.isArray(records) && Array.isArray(impacts) && records.length === impacts.length, 'matching record and impact pages required');
  const total = amount(count, 'registered count'), complete = BigInt(records.length) === total;
  need(BigInt(records.length) <= total, 'more records than registered contributions');
  need(object(points), 'global point totals required');
  const global = Object.fromEntries(Object.entries(totalFields).map(([key, field]) => [key, amount(points[field], field)]));
  need(global.authorPoints + global.impactPoints === global.earnedPoints && global.earnedPoints + global.reservedPoints === global.awardBudgets &&
    global.returnedPoints <= global.authorPoints && global.notePoints <= global.authorPoints, 'inconsistent global point totals');
  const byId = new Map(), impactById = new Map(), accounts = new Map(), unresolved = new Set(), nodes = new Map(), edges = [], contributions = [], computed = zeroTotals();
  const account = address => {
    const key = wallet(address);
    if (!accounts.has(key)) accounts.set(key, {wallet: key, authorPoints: 0n, impactPoints: 0n, earnedPoints: 0n, returnedPoints: 0n,
      notePoints: 0n, acceptedContributions: 0, formalContributions: 0, contributionIds: [], rank: null});
    return accounts.get(key);
  };
  for (const record of records) {
    const e = record?.evidence;
    need(object(record) && object(e) && validId(e.id) && Object.hasOwn(states, record.status), 'invalid contribution');
    need(!byId.has(e.id), 'duplicate contribution ID');
    wallet(e.wallet); byId.set(e.id, record);
    nodes.set(e.id, {id: e.id, title: contextOf(record).title, status: record.status, wallet: wallet(e.wallet), loaded: true,
      eligibleDependency: record.status === 'credited' && e.evidence_kind === 'formal' && e.verification === 'verified'});
  }
  for (const impact of impacts) {
    need(object(impact) && byId.has(impact.downstream) && !impactById.has(impact.downstream) &&
      ['not-requested', 'provisional', 'challenged', 'settled'].includes(impact.status), 'duplicate or mismatched impact record');
    impactById.set(impact.downstream, impact);
  }
  for (const record of records) {
    const e = record.evidence, impact = impactById.get(e.id), owner = account(e.wallet), context = contextOf(record);
    const credited = record.status === 'credited', formal = e.evidence_kind === 'formal';
    need(formal && e.verification === 'verified' || e.evidence_kind === 'research-note' && e.verification === 'not-formal', 'invalid evidence label');
    need(Array.isArray(e.dependencies) && e.dependencies.every(validId) && new Set(e.dependencies).size === e.dependencies.length &&
      !e.dependencies.includes(e.id) && Array.isArray(e.verified_dependencies), 'invalid dependency references');
    const verified = new Map();
    for (const use of e.verified_dependencies) {
      need(object(use) && e.dependencies.includes(use.id) && !verified.has(use.id) && use.proof_body_use === true && formal, 'invalid verified dependency');
      verified.set(use.id, use);
    }
    const dependencyEdges = new Map();
    for (const id of e.dependencies) {
      const prior = byId.get(id), use = verified.get(id);
      if (prior) {
        need(prior.status === 'credited', 'dependency is not credited');
        if (use) need(prior.evidence.evidence_kind === 'formal' && prior.evidence.verification === 'verified' &&
          use.artifact_hash === prior.evidence.artifact_hash, 'verified dependency artifact mismatch');
      } else {
        unresolved.add(id);
        if (!nodes.has(id)) nodes.set(id, {id, title: id, status: 'unloaded', wallet: null, loaded: false, eligibleDependency: false});
      }
      const edge = {source: e.id, target: id, kind: use ? 'verified' : 'reference', loaded: Boolean(prior),
        recipientWallet: prior ? wallet(prior.evidence.wallet) : null, settledPoints: '0', proposedPoints: '0'};
      dependencyEdges.set(id, edge); edges.push(edge);
    }
    const authorPoints = amount(record.credited_points, 'author points');
    need(credited || authorPoints === 0n, 'uncredited contribution has points');
    let budget = 0n, reserve = 0n, returned = 0n, outstanding = 0n, settledImpact = 0n;
    if (credited) {
      budget = amount(record.award_budget, 'award budget'); reserve = amount(record.impact_reserve, 'impact reserve');
      returned = amount(record.reserve_returned, 'returned reserve');
      const initial = amount(record.initial_paid, 'initial payment');
      need(typeof record.reserve_settled === 'boolean' && initial + reserve === budget && initial + returned === authorPoints && returned <= reserve,
        'contribution budget mismatch');
      need(formal || reserve === 0n, 'research note cannot have an attribution reserve');
      need(record.reserve_settled || returned === 0n, 'unsettled reserve was returned');
      outstanding = record.reserve_settled ? 0n : reserve;
      owner.acceptedContributions++; if (formal) owner.formalContributions++;
      owner.authorPoints += authorPoints; owner.returnedPoints += returned;
      if (!formal) owner.notePoints += authorPoints;
      computed.authorPoints += authorPoints; computed.returnedPoints += returned;
      computed.notePoints += formal ? 0n : authorPoints; computed.awardBudgets += budget; computed.reservedPoints += outstanding;
    }
    owner.contributionIds.push(e.id);
    if (impact.status !== 'not-requested') {
      need(credited && impact.source_digest === record.digest && amount(impact.budget, 'impact budget') === reserve &&
        Array.isArray(impact.allocations), 'impact source or budget mismatch');
      const seen = new Set(); let allocated = 0n;
      for (const allocation of impact.allocations) {
        need(object(allocation) && verified.has(allocation.id) && !seen.has(allocation.id), 'duplicate or ineligible impact recipient');
        seen.add(allocation.id);
        const allocationPoints = amount(allocation.points, 'allocation points'), edge = dependencyEdges.get(allocation.id);
        allocated += allocationPoints;
        if (impact.status === 'settled') {
          edge.settledPoints = String(allocationPoints);
          if (edge.recipientWallet) account(edge.recipientWallet).impactPoints += allocationPoints;
        } else edge.proposedPoints = String(allocationPoints);
      }
      need(allocated <= reserve, 'impact allocations exceed reserve');
      const paid = amount(impact.paid_points, 'paid impact'), impactReturned = amount(impact.returned_points, 'impact returned reserve');
      if (impact.status === 'settled') {
        need(record.reserve_settled && paid === allocated && impactReturned === returned && paid + returned === reserve, 'settled impact accounting mismatch');
        settledImpact = paid; computed.impactPoints += paid;
      } else need(!record.reserve_settled && paid === 0n && impactReturned === 0n, 'unsettled impact has paid points');
    } else {
      need(!impact.allocations?.length, 'unrequested impact has allocations');
      need(!credited || reserve === 0n || !record.reserve_settled, 'settled reserve is missing its impact record');
    }
    contributions.push({id: e.id, title: context.title, context, status: record.status, stateLabel: states[record.status],
      evidenceKind: e.evidence_kind, evidenceLabel: formal ? 'Lean-checked statement' : 'Research note · not formally verified',
      wallet: wallet(e.wallet), pr: String(e.pr), head: e.head, claim: plain(e.claim), formalStatement: plain(e.formal_statement),
      researchDirection: plain(e.research_direction, 160),
      reason: plain(record.status === 'expired' ? record.expiration_reason : record.verdict?.reason) ||
        (record.status === 'expired' ? 'Closed without a merit verdict or points. Unresolved work cannot receive another judgment.' : 'No agreed merit verdict is recorded yet.'),
      authorPoints: String(authorPoints), awardBudget: credited ? String(budget) : null, returnedPoints: String(returned),
      reservePoints: String(outstanding), settledImpactPoints: String(settledImpact), dependencyIds: [...e.dependencies]});
  }
  need(!complete || unresolved.size === 0, 'complete registry is missing a dependency wallet');
  computed.earnedPoints = computed.authorPoints + computed.impactPoints;
  const mismatches = Object.keys(totalFields).filter(key => computed[key] !== global[key]);
  const reconciled = complete && unresolved.size === 0 && mismatches.length === 0, ranked = reconciled;
  const leaderboard = [...accounts.values()];
  for (const row of leaderboard) row.earnedPoints = row.authorPoints + row.impactPoints;
  leaderboard.sort((left, right) => ranked && left.earnedPoints !== right.earnedPoints ? (left.earnedPoints > right.earnedPoints ? -1 : 1) : left.wallet.localeCompare(right.wallet));
  let previous, rank = 0;
  leaderboard.forEach((row, index) => {
    if (ranked && row.earnedPoints > 0n) { if (row.earnedPoints !== previous) rank = index + 1; row.rank = rank; previous = row.earnedPoints; }
  });
  return {contributions, graph: {nodes: [...nodes.values()], edges}, leaderboard: leaderboard.map(strings),
    coverage: {loaded: records.length, total: String(total), complete, reconciled, ranked,
      status: ranked ? 'ranked' : complete ? 'unreconciled' : 'partial', missingDependencies: [...unresolved], mismatches,
      computed: strings(computed), global: strings(global),
      label: ranked ? 'Complete ledger; earned points reconciled.' : complete ? 'Point totals do not reconcile; rankings are unavailable.' :
        `Partial ledger: ${records.length} of ${total} contributions loaded. Earned totals are incomplete; no rankings.`}};
}
