import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decodeSubmission, validateSubmission } from '../src/submission.mjs';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const template = readJson('../research/SUBMISSION_TEMPLATE.json');
const policy = readJson('../lean/policy.json');
const wallet = '0x52908400098527886E0F7030069857D2E4169EE7';
const options = { wallet, goals: policy.goals };

function submission() {
  return {
    schema_version: 1,
    problem: 'p-vs-np',
    kind: 'lemma',
    title: 'Satisfiability under variable renaming',
    claim: 'A renaming with a left inverse preserves satisfiability of each CNF formula.',
    novelty: 'This adds a checked integration of a known result to the CNF component.',
    prior_art: [{
      reference: 'CNF semantics in the enrolled evaluation component',
      relationship: 'The earlier component establishes evaluation under renaming.',
    }],
    evidence: {
      policy: policy.name,
      goal: 'renaming_sat',
      proof_path: policy.goals.renaming_sat.path,
      reproduce: 'Compile the proof with the pinned Lean verifier.',
    },
    dependencies: [{
      id: 'pr-1-ee4678fc76d9-5c22de45baf0',
      use: 'Rewrite evaluation of the renamed formula using the prior lemma.',
      importance: 'The lemma connects the composed assignment to the original formula.',
    }],
    attribution: { wallet, contributions: 'Wrote and checked the downstream proof.' },
    limitations: 'The result assumes a left inverse and gives no complexity bound.',
  };
}

const formatted = record => `${JSON.stringify(record, null, 2)}\n`;
const decode = text => decodeSubmission(Buffer.from(text), options);

test('accepts complete records and equivalent spellings of the signing wallet', () => {
  const record = submission();
  assert.deepEqual(decode(formatted(record)), record);

  record.attribution.wallet = wallet.toLowerCase();
  assert.equal(validateSubmission(record, options), record);

  record.evidence.goal = 'renaming';
  record.evidence.proof_path = policy.goals.renaming.path;
  record.dependencies = [];
  record.prior_art = [];
  assert.deepEqual(decode(formatted(record)), record);
});

const recordObjects = [
  ['root', record => record],
  ['prior art', record => record.prior_art[0]],
  ['evidence', record => record.evidence],
  ['dependency', record => record.dependencies[0]],
  ['attribution', record => record.attribution],
];

for (const [label, select] of recordObjects) {
  test(`requires exactly the declared fields in ${label}`, () => {
    for (const field of Object.keys(select(submission()))) {
      const record = submission();
      delete select(record)[field];
      assert.throws(() => validateSubmission(record, options), /missing or unknown fields/, field);
    }

    const record = submission();
    select(record).extra = 'unexpected';
    assert.throws(() => validateSubmission(record, options), /missing or unknown fields/);
  });
}

test('requires a string goal and an exact enrolled policy and proof path', () => {
  for (const goal of [['renaming_sat'], 1, null, 'constructor', 'unknown-goal']) {
    const record = submission();
    record.evidence.goal = goal;
    assert.throws(() => validateSubmission(record, options), /invalid goal/);
  }

  for (const evidence of [
    { proof_path: policy.goals.renaming.path },
    { proof_path: [policy.goals.renaming_sat.path] },
    { policy: 'unrecognized-policy' },
  ]) {
    const record = submission();
    Object.assign(record.evidence, evidence);
    assert.throws(() => validateSubmission(record, options), /invalid goal or proof path|unenrolled/);
  }
});

test('rejects foreign, malformed, and zero attribution wallets', () => {
  const record = submission();
  for (const address of ['0x1111111111111111111111111111111111111111', '0x1234']) {
    record.attribution.wallet = address;
    assert.throws(() => validateSubmission(record, options), /must match the signing wallet/);
  }

  const zero = `0x${'0'.repeat(40)}`;
  record.attribution.wallet = zero;
  assert.throws(() => validateSubmission(record, { ...options, wallet: zero }), /must match the signing wallet/);
});

test('rejects two descriptions of the same dependency ID', () => {
  const record = submission();
  record.dependencies.push({
    ...record.dependencies[0],
    use: 'Reuse the equality when constructing the assignment witness.',
  });
  assert.throws(() => validateSubmission(record, options), /duplicate dependency/);
});

test('requires filling the template title, claim, and novelty individually', () => {
  for (const field of ['title', 'claim', 'novelty']) {
    const record = submission();
    record[field] = template[field];
    assert.throws(() => validateSubmission(record, options), /replace template instructions/, field);
  }
});

test('requires valid UTF-8 before parsing JSON', () => {
  const bytes = Buffer.from(formatted(submission()));
  const title = bytes.indexOf('Satisfiability');
  assert.ok(title >= 0);
  bytes[title] = 0xff;
  assert.throws(() => decodeSubmission(bytes, options), { code: 'ERR_ENCODING_INVALID_ENCODED_DATA' });
});

test('enforces the serialized byte limit for Unicode records', () => {
  const record = submission();
  record.claim = '公式'.repeat(1400);
  record.novelty = '推导'.repeat(950);
  record.limitations = '限制'.repeat(950);
  assert.equal(validateSubmission(record, options), record);

  const text = formatted(record);
  assert.ok(text.length < 12000);
  assert.ok(Buffer.byteLength(text) > 12000);
  assert.throws(() => decode(text), /12,000-byte limit/);
});

test('rejects duplicate JSON keys at both root and nested levels', () => {
  const text = formatted(submission());
  for (const field of [/^  "schema_version": .*,$/m, /^    "goal": .*,$/m]) {
    const duplicate = text.replace(field, '$&\n$&');
    assert.notEqual(duplicate, text);
    assert.throws(() => decode(duplicate), /duplicate keys/);
  }
});

test('requires the documented two-space JSON formatting', () => {
  const record = submission();
  assert.deepEqual(decode(formatted(record)), record);
  assert.throws(() => decode(JSON.stringify(record)), /format the record/);
  assert.throws(() => decode(JSON.stringify(record, null, 4)), /format the record/);
});
