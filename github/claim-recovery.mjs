const RELEASABLE = new Set(['submitted', 'provisional', 'challenged', 'approved']);
const EXPIRATION_REASON = 'The unmerged PR closed or no longer matches its signed head, target branch, or canonical base. This decision and its statement reservation expire.';

export async function expireStaleUnmergedClaim({
  pr, claim, branchHead, registered, expirationStarted, confirmRegistration, readRecord, release,
}) {
  if (!expirationStarted) {
    if (pr.merged === true) return false;
    if (pr.merged !== false) throw Error('GitHub PR merge status is missing');
    if (pr.state === 'open' && pr.head.sha === claim.head && pr.base.ref === claim.branch &&
        await branchHead(claim.branch) === claim.base) return false;
  }
  if (!registered) return true;

  await confirmRegistration();
  const record = await readRecord();
  // A journaled release may already be in flight even if the PR changed back.
  if (expirationStarted || RELEASABLE.has(record.status)) {
    await release(EXPIRATION_REASON);
    await readRecord();
  }
  return true;
}
