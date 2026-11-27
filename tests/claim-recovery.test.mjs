import assert from 'node:assert/strict';
import test from 'node:test';
import { expireStaleUnmergedClaim } from '../github/claim-recovery.mjs';

const claim = { branch: 'research', head: 'a'.repeat(40), base: 'b'.repeat(40) };

function setup({ target = claim.branch, registered = true, merged = false, expirationStarted = false, status = 'approved' } = {}) {
  const calls = [];
  const options = {
    claim,
    pr: { state: merged ? 'closed' : 'open', merged, head: { sha: claim.head }, base: { ref: target } },
    branchHead: async () => { calls.push('read canonical branch'); return claim.base; },
    registered,
    expirationStarted,
    confirmRegistration: async () => { calls.push('check registration'); },
    readRecord: async () => { calls.push('read record'); return { status }; },
    release: async reason => { calls.push(['release', reason]); status = 'expired'; },
  };
  return { options, calls };
}

test('an unmerged approval retargeted on the same head releases its reservation', async () => {
  const { options, calls } = setup({ target: 'other' });
  assert.equal(await expireStaleUnmergedClaim(options), true);
  assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), [
    'check registration', 'read record', 'release', 'read record',
  ]);
  assert.match(calls[2][1], /statement reservation expire/);
});

test('a fresh retargeted PR does not register or release anything', async () => {
  const { options, calls } = setup({ target: 'other', registered: false });
  assert.equal(await expireStaleUnmergedClaim(options), true);
  assert.deepEqual(calls, []);
});

test('an unchanged or already merged PR is left available for the normal execution path', async () => {
  const current = setup();
  assert.equal(await expireStaleUnmergedClaim(current.options), false);
  assert.deepEqual(current.calls, ['read canonical branch']);

  const merged = setup({ merged: true });
  assert.equal(await expireStaleUnmergedClaim(merged.options), false);
  assert.deepEqual(merged.calls, []);
});

test('a journaled expiration is resumed with identical calldata after a retarget is undone', async () => {
  const initial = setup({ target: 'other' });
  await expireStaleUnmergedClaim(initial.options);

  const resumed = setup({ expirationStarted: true, status: 'expired' });
  assert.equal(await expireStaleUnmergedClaim(resumed.options), true);
  assert.deepEqual(resumed.calls.find(Array.isArray), initial.calls.find(Array.isArray));
});

test('retarget recovery never releases earned points or a rejection', async () => {
  for (const status of ['credited', 'rejected', 'expired']) {
    const { options, calls } = setup({ target: 'other', status });
    assert.equal(await expireStaleUnmergedClaim(options), true);
    assert.deepEqual(calls, ['check registration', 'read record']);
  }
});

test('an incomplete PR read does not authorize a fresh release', async () => {
  const { options, calls } = setup({ target: 'other' });
  delete options.pr.merged;
  await assert.rejects(expireStaleUnmergedClaim(options), /merge status is missing/);
  assert.deepEqual(calls, []);
});
