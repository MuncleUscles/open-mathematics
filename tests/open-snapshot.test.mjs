import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {collectOpenSnapshot, validateOpenSnapshot, openSnapshotLabel, chooseOpenLedgerView, openMigrationHash, SNAPSHOT_READ_LIMIT} from '../src/open-snapshot.mjs';
import {writeOpenSnapshot} from '../scripts/capture-open-ledger.mjs';

const address = digit => '0x' + digit.repeat(40), hash = digit => digit.repeat(64), commit = digit => digit.repeat(40);
const problem = {deployment: {contract: address('1'), chainId: 61999, codeHash: hash('2'), problem: 'p-vs-np', repository: 'Owner/problem', branch: 'research',
  verifier: address('3'), executor: address('4'), windowSeconds: 300, minimumGitHubAccountAgeDays: 30, legacyLedgers: []},
  policyHash: hash('5'), descriptor: {protocol: {commit: commit('6')}}, policy: {objective: 'Useful open research toward P versus NP.'}};
const config = {version: '5', problem: 'p-vs-np', repository: 'Owner/problem', branch: 'research', verifier: address('3'), executor: address('4'), window: '300',
  minimum_account_age_days: '30', policy: hash('5'), objective: problem.policy.objective, legacy_ledgers: []};
const points = {problem: 'p-vs-np', transferable: false, total_awarded: '400', total_initial_points: '380', total_impact_points: '20', total_note_points: '0',
  total_returned_points: '60', total_award_budgets: '500', total_reserved_points: '100'};
const record = id => ({status: 'credited', digest: hash('8'), credited_points: '380', award_budget: '400', verdict: {reason: 'The formal component is useful.'}, evidence: {
  id, problem: 'p-vs-np', repository: 'Owner/problem', branch: 'research', policy: hash('5'), contract: address('1'),
  head: commit('a'), base: commit('b'), protocol_commit: commit('c'), worker_commit: commit('c'), wallet: address('d'), pr: '7',
  claim: 'A precisely stated mathematical component.', context: '{"title":"A useful component"}', research_direction: 'A contributor-selected direction', formal_statement: 'True',
  evidence_kind: 'formal', verification: 'verified', dependencies: [], verified_dependencies: [],
}});
const impact = id => ({downstream: id, status: 'not-requested'});
function native(total = 1, override = () => undefined) {
  const calls = [];
  return {calls, read: async (method, args) => {
    calls.push([method, args]); const custom = override(method, args, calls.length); if (custom !== undefined) return custom;
    if (method === 'get_config') return structuredClone(config);
    if (method === 'count_contributions') return String(total);
    if (method === 'get_points') return structuredClone(points);
    if (method === 'list_contributions') return {items: Array.from({length: args[1]}, (_, index) => 'pr-' + (args[0] + index)), total: String(total), next_offset: null};
    if (method === 'get') return record(args[0]);
    if (method === 'get_impact') return impact(args[0]);
    assert.fail(method);
  }};
}

test('capture reads only the newest bounded page with exact original source pins and dated provenance', async () => {
  const {read, calls} = native(1000), snapshot = await collectOpenSnapshot({problem, read});
  assert.equal(calls.length, 28); assert.ok(calls.length <= SNAPSHOT_READ_LIMIT);
  assert.deepEqual(calls[3], ['list_contributions', [988, 12]]);
  assert.equal(snapshot.offset, 988);
  assert.equal(snapshot.records.length, 12);
  assert.equal(snapshot.records[0].evidence.protocol_commit, commit('c'));
  assert.equal(snapshot.identity.protocolCommit, commit('6'));
  assert.equal(snapshot.readMode, 'latest-final'); assert.equal(snapshot.atomic, false);
  assert.equal(validateOpenSnapshot(snapshot, problem), snapshot);
  assert.match(openSnapshotLabel(snapshot), /Published snapshot from .*live unavailable/);
  assert.match(openSnapshotLabel(snapshot), /not an atomic snapshot/);
  assert.match(openSnapshotLabel(snapshot), /read-only copy cannot authorize merges or points/);
});

test('empty ledger uses only three unsigned views and never fabricates records', async () => {
  const {read, calls} = native(0), snapshot = await collectOpenSnapshot({problem, read});
  assert.equal(calls.length, 3); assert.deepEqual(snapshot.records, []); assert.equal(snapshot.count, '0');
});

test('inherited snapshots authenticate each original contract without adding balances again', async () => {
  const predecessor = {address: problem.deployment.contract, snapshot_hash: hash('e')};
  const successor = {...problem, deployment: {...problem.deployment, contract: address('f'), predecessor}};
  const provenance = r => ({inherited: true, predecessor: predecessor.address, snapshot_hash: predecessor.snapshot_hash,
    record_hash: openMigrationHash(r), original_record_hash: openMigrationHash(r)});
  const provider = native(12, (method, args) => method === 'get_config' ? {...structuredClone(config), predecessor} : method === 'get_inheritance' ? provenance(record(args[0])) : undefined);
  const snapshot = await collectOpenSnapshot({problem: successor, read: provider.read});
  assert.equal(provider.calls.length, SNAPSHOT_READ_LIMIT);
  assert.equal(snapshot.inheritances.length, 12);
  assert.equal(snapshot.records[0].evidence.contract, predecessor.address);
  assert.equal(snapshot.points.total_awarded, points.total_awarded);
  assert.equal(provider.calls.filter(([method]) => method === 'get_points').length, 1);
  assert.deepEqual(provider.calls[6], ['get_inheritance', ['pr-0']]);
  assert.equal(validateOpenSnapshot(snapshot, successor), snapshot);
  for (const mutate of [
    s => { delete s.inheritances; }, s => { s.inheritances[0] = {inherited: false}; },
    s => { s.inheritances[0].predecessor = address('a'); }, s => { s.inheritances[0].snapshot_hash = hash('a'); },
    s => { s.inheritances[0].record_hash = hash('a'); }, s => { delete s.inheritances[0].original_record_hash; },
    s => { s.records[0].evidence.claim = 'Substituted original evidence'; }, s => { s.records[0].evidence.contract = address('a'); },
    s => { s.config.predecessor.snapshot_hash = hash('a'); }, s => { s.reads.splice(6, 1); },
  ]) { const changed = structuredClone(snapshot); mutate(changed); assert.throws(() => validateOpenSnapshot(changed, successor), /Open ledger snapshot/); }
});

test('released inherited records retain their source hash and authenticate the current state separately', async () => {
  const predecessor = {address: problem.deployment.contract, snapshot_hash: hash('e')};
  const successor = {...problem, deployment: {...problem.deployment, contract: address('f'), predecessor}};
  const original = record('pr-0'); Object.assign(original, {status: 'submitted', credited_points: '0', verdict: null});
  const released = {...original, status: 'expired', release_reason: 'The unmerged PR was closed.'};
  const inheritance = {inherited: true, predecessor: predecessor.address, snapshot_hash: predecessor.snapshot_hash,
    record_hash: openMigrationHash(released), original_record_hash: openMigrationHash(original)};
  const provider = native(1, method => method === 'get_config' ? {...structuredClone(config), predecessor} : method === 'get' ? released : method === 'get_inheritance' ? inheritance : undefined);
  const snapshot = await collectOpenSnapshot({problem: successor, read: provider.read});
  assert.equal(snapshot.records[0].status, 'expired');
  assert.notEqual(snapshot.inheritances[0].record_hash, snapshot.inheritances[0].original_record_hash);
  assert.equal(snapshot.inheritances[0].original_record_hash, openMigrationHash(original));
});

test('capture stops on its first failed read and does not retry explicit provider throttling', async () => {
  const {read, calls} = native(5, method => { if (method === 'get') throw Object.assign(Error('Rate limit'), {code: -32029}); });
  await assert.rejects(collectOpenSnapshot({problem, read}), /Rate limit/);
  assert.equal(calls.length, 5);
});

test('failed captures remove stale outputs and never publish partial results', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-snapshot-')), destination = path.join(dir, 'ledger.json');
  try {
    fs.writeFileSync(destination, '{"old":"snapshot"}');
    const failing = native(3, method => { if (method === 'get_impact') throw Error('Native read unavailable'); });
    await assert.rejects(writeOpenSnapshot({problem, destination, read: failing.read}), /Native read unavailable/);
    assert.equal(fs.existsSync(destination), false); assert.equal(fs.existsSync(destination + '.pending'), false);
    const complete = await writeOpenSnapshot({problem, destination, read: native(1).read});
    assert.deepEqual(JSON.parse(fs.readFileSync(destination, 'utf8')), complete);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('cross-deployment snapshots, mismatched native configuration and substituted records fail closed', async () => {
  const snapshot = await collectOpenSnapshot({problem, read: native(1).read});
  for (const mutation of [
    s => { s.identity.contract = address('f'); }, s => { s.identity.policy = hash('f'); }, s => { s.identity.protocolCommit = commit('f'); },
    s => { s.config.executor = address('f'); }, s => { s.config.minimum_account_age_days = '0'; },
    s => { s.records[0].evidence.id = 'different'; }, s => { s.records[0].evidence.policy = hash('f'); },
    s => { s.records[0].evidence.contract = address('f'); }, s => { s.records[0].evidence.worker_commit = commit('f'); },
    s => { s.impacts[0].downstream = 'different'; }, s => { s.records[0].evidence.verification = 'not-formal'; },
    s => { s.points.total_awarded = '9999'; }, s => { s.reads.pop(); },
    s => { Object.assign(s.points, {total_awarded: Number.MAX_SAFE_INTEGER + 1, total_initial_points: Number.MAX_SAFE_INTEGER + 1, total_award_budgets: Number.MAX_SAFE_INTEGER + 1, total_reserved_points: '0', total_impact_points: '0'}); },
    s => { s.completedAt = new Date(Date.now() + 120000).toISOString(); },
  ]) { const changed = structuredClone(snapshot); mutation(changed); assert.throws(() => validateOpenSnapshot(changed, problem), /Open ledger snapshot/); }
});

test('changed or malformed pages and overlong captures stop without following another page', async () => {
  for (const page of [{items: ['pr-0'], total: '2', next_offset: 1}, {items: ['pr-0', 'pr-0'], total: '1', next_offset: null}]) {
    const {read, calls} = native(1, method => method === 'list_contributions' ? page : undefined);
    await assert.rejects(collectOpenSnapshot({problem, read}), /page changed or is malformed/);
    assert.equal(calls.length, 4);
  }
  let clock = Date.now();
  const slow = native(1);
  await assert.rejects(collectOpenSnapshot({problem, read: slow.read, now: () => { const value = new Date(clock).toISOString(); clock += 301000; return value; }}), /capture interval exceeded/);
  assert.equal(slow.calls.length, 1);
});

test('browser fallback preserves the last successful live view and clearly selects published data', async () => {
  const snapshot = await collectOpenSnapshot({problem, read: native(1).read});
  const failed = async () => { throw Error('CORS failure'); };
  const live = await chooseOpenLedgerView({loadLive: async () => snapshot, loadPublished: () => assert.fail('live should win')});
  assert.equal(live.mode, 'live');
  const retained = await chooseOpenLedgerView({loadLive: failed, loadPublished: () => assert.fail('never overwrite live with cache'), current: live});
  assert.equal(retained.snapshot, snapshot); assert.equal(retained.changed, false); assert.equal(retained.unavailable, true);
  const cached = await chooseOpenLedgerView({loadLive: failed, loadPublished: async () => snapshot});
  assert.equal(cached.mode, 'published'); assert.equal(cached.unavailable, true);
  const unavailable = await chooseOpenLedgerView({loadLive: failed, loadPublished: failed});
  assert.equal(unavailable.mode, 'unavailable'); assert.equal(unavailable.snapshot, undefined);
});

test('generated Pages refresh captures only trusted main after its own adjudication workflow', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-pages-'));
  try {
    fs.mkdirSync(path.join(dir, '.open-math')); fs.writeFileSync(path.join(dir, '.open-math/open.json'), JSON.stringify({schemaVersion: 5, policy:{path:'.open-math/open-policy.json'}, protocol: {repository: 'MuncleUscles/open-mathematics', commit: commit('6')}}));
    fs.writeFileSync(path.join(dir,'.open-math/open-policy.json'),JSON.stringify({version:6}));
    execFileSync(process.execPath, ['scripts/render-open-workflows.mjs', dir, commit('6')]);
    const pages = fs.readFileSync(path.join(dir, '.github/workflows/pages.yml'), 'utf8');
    assert.match(pages, /workflow_run:\n    workflows: \[Open research adjudication\]\n    types: \[completed\]\n    branches: \[main\]/);
    assert.match(pages, /github\.event\.workflow_run\.head_branch == 'main'/);
    assert.match(pages, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
    assert.match(pages, /ref: \$\{\{ github\.sha \}\}/);
    assert.doesNotMatch(pages, /workflow_run\.head_sha|download-artifact|pull_request_target/);
    const research=fs.readFileSync(path.join(dir,'.github/workflows/research.yml'),'utf8');
    assert.match(research,/run: bash github\/build-full-lean.sh/);
    assert.match(research,/  accounts:\n    needs: process/);
    assert.match(research,/run: node github\/sync-accounts\.mjs \.\.\/problem\n/);
    assert.match(pages, /build-open-site\.mjs \.\.\/problem \.\.\/site --snapshot/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('policy successor snapshots authenticate multi-era origins and retain the same totals', async()=>{
 const r=record('pr-0'), originalHash=openMigrationHash(r), ancestor=address('9');r.evidence.contract=ancestor;
 const recordHash=openMigrationHash(r);
 const predecessor={version:2,address:address('1'),snapshot_hash:hash('a'),source_policy:hash('5'),source_config_hash:hash('b'),source_code_hash:hash('c'),
  records:[{id:'pr-0',record_hash:recordHash,impact_hash:openMigrationHash(impact('pr-0')),inheritance_hash:hash('d'),origin_contract:ancestor,origin_policy:hash('5')}],credited_order:['pr-0'],semantic_fences:[{id:'pr-0',statement_hash:hash('e')}]};
 const successor={...problem,policyHash:hash('f'),deployment:{...problem.deployment,contract:address('f'),predecessor}};
 const h={inherited:true,version:2,predecessor:predecessor.address,...Object.fromEntries(['snapshot_hash','source_policy','source_config_hash','source_code_hash'].map(k=>[k,predecessor[k]])),original_record_hash:recordHash,record_hash:recordHash,origin_chain:[
  {contract:predecessor.address,policy:hash('5'),snapshot_hash:hash('a'),record_hash:recordHash,original_record_hash:recordHash},
  {contract:ancestor,policy:hash('5'),snapshot_hash:hash('9'),record_hash:originalHash,original_record_hash:originalHash}]};
 const provider=native(1,method=>method==='get_config'?{...structuredClone(config),policy:hash('f'),predecessor}:method==='get'?r:method==='get_inheritance'?h:undefined);
 const snapshot=await collectOpenSnapshot({problem:successor,read:provider.read});
 assert.equal(snapshot.points.total_awarded,points.total_awarded);
 assert.equal(snapshot.records[0].evidence.policy,hash('5'));
 assert.equal(validateOpenSnapshot(snapshot,successor),snapshot);
 for(const mutate of [s=>s.inheritances[0].origin_chain.pop(),s=>s.inheritances[0].origin_chain[0].policy=hash('f'),s=>s.inheritances[0].source_config_hash=hash('f'),s=>s.inheritances[0].original_record_hash=hash('f'),s=>s.records[0].evidence.policy=hash('f'),s=>s.records[0].evidence.contract=address('1')]){
  const changed=structuredClone(snapshot);mutate(changed);assert.throws(()=>validateOpenSnapshot(changed,successor),/Open ledger snapshot/);
 }
});
