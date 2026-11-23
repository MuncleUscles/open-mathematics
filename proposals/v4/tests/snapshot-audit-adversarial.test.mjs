import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validatedCommunitySnapshot} from '../../../public/community-snapshot.mjs';
import {auditSnapshot} from '../audit-snapshot.mjs';

const root = new URL('../../../', import.meta.url);
const read = file => JSON.parse(readFileSync(new URL(file, root)));
const deployment = read('public/deployment.json');
const historical = read('public/community-snapshot.json');
const paidImpact = snapshot => snapshot.impacts.find(row => row.value.allocations?.length).value;
const contribution = (snapshot, id) => snapshot.records.find(record => record.evidence.id === id);
function expectDiagnostic(change, message) {
  const snapshot = structuredClone(historical);
  change(snapshot);
  assert.ok(validatedCommunitySnapshot(snapshot, deployment), 'the fixture should still be display-schema-valid');
  const result = auditSnapshot(snapshot, deployment);
  assert.equal(result.readyForMigration, false);
  assert.equal(result.consistent, false);
  assert.ok(result.issues.some(issue => message.test(issue)), JSON.stringify(result.issues));
}

test('an untyped wallet in author claim history yields an issue without throwing', () => {
  expectDiagnostic(snapshot => {
    snapshot.authors[0].claim_history.at(-1).wallet = {toString: 'malformed display field'};
  }, /binding is not supported/);
});

test('matching missing digests cannot establish a settled impact link', () => {
  expectDiagnostic(snapshot => {
    const impact = paidImpact(snapshot);
    delete contribution(snapshot, impact.downstream).digest;
    delete impact.source_digest;
  }, /not bound to its downstream record digest/);
});

test('impact allocations must have an eligible recipient with verified direct proof use', () => {
  expectDiagnostic(snapshot => {
    const impact = paidImpact(snapshot);
    impact.eligible = [];
    contribution(snapshot, impact.downstream).evidence.verified_dependencies = [];
  }, /ineligible recipient/);
});

test('a settled authorship claim must match the digest recorded for the author binding', () => {
  expectDiagnostic(snapshot => {
    snapshot.authors[0].claim_history.at(-1).attestation_hash = '1'.repeat(64);
  }, /binding is not supported/);
});

test('a credited contribution cannot depend on itself', () => {
  expectDiagnostic(snapshot => {
    const evidence = snapshot.records[0].evidence;
    evidence.dependencies.push(evidence.id);
  }, /outside its earlier credited records/);
});

test('one settled attribution case cannot appear as two applied correction revisions', () => {
  expectDiagnostic(snapshot => {
    const provenance = snapshot.provenances[0].value;
    const sourceCase = snapshot.cases.find(row => row.kind === 'external-solution' && row.status === 'settled');
    const correction = {
      ...structuredClone(sourceCase),
      id: 'case-' + '8'.repeat(32),
      kind: 'attribution',
      target: provenance.contribution,
      verdict: {
        apply: true, mode: provenance.mode, retain_initial_points: provenance.current_initial_points,
        external_allocations: [],
      },
    };
    snapshot.cases.push(correction);
    provenance.version = '2';
    const allocation = {
      retained: provenance.current_initial_points, external: [], revoked: provenance.revoked_points,
      mode: provenance.mode,
    };
    provenance.sources = correction.payload.sources;
    provenance.author_ids = correction.author_ids;
    provenance.corrections = ['1', '2'].map(version => ({
      case: correction.id, version, before: allocation, after: allocation,
    }));
  }, /lacks a unique captured settled attribution case for its revision/);
});

test('an admitted external solution must remain referenced by its problem', () => {
  expectDiagnostic(snapshot => {
    snapshot.problem.external_solutions = [];
  }, /disagrees with its problem's admitted history/);
});

test('matching balances cannot conceal a shared-controller impact award above its native cap', () => {
  expectDiagnostic(snapshot => {
    const impact = paidImpact(snapshot), allocation = impact.allocations[0];
    assert.equal(impact.eligible.find(row => row.id === allocation.id).shared_github_author, true);
    allocation.band = '2';
    impact.paid_points = '200';
    const wallet = contribution(snapshot, allocation.id).evidence.wallet;
    for (const row of snapshot.walletBalances) {
      if (row.wallet === wallet) {
        row.value.impact_points = '200';
        row.value.points = String(BigInt(row.value.initial_points) + 200n);
      }
      row.value.total_awarded = '900';
      row.value.total_impact_points = '200';
    }
  }, /exceeds the shared GitHub controller cap/);
});

test('balanced historical values that exceed native uint256 width are diagnosed', () => {
  expectDiagnostic(snapshot => {
    const record = snapshot.records[0];
    const provenance = snapshot.provenances.find(row => row.id === record.evidence.id).value;
    const original = 2n ** 256n, historicalDelta = original - BigInt(record.credited_points);
    record.credited_points = String(original);
    provenance.original_initial_points = String(original);
    provenance.revoked_points = String(original - BigInt(provenance.current_initial_points));
    for (const row of snapshot.walletBalances) {
      if (row.wallet === record.evidence.wallet) row.value.historical_initial_points = String(original);
      row.value.total_historical_initial_awarded = String(BigInt(row.value.total_historical_initial_awarded) + historicalDelta);
    }
  }, /exceeds the native uint256 range/);
});

test('display data cannot opt into migration readiness', () => {
  const snapshot = {...structuredClone(historical), readyForMigration: true, unverifiedRequirements: []};
  const result = auditSnapshot(snapshot, deployment);
  assert.equal(result.consistent, true);
  assert.equal(result.readyForMigration, false);
  assert.ok(result.unverifiedRequirements.length > 0);
});
