const terminalStatuses = new Set(['settled', 'expired', 'withdrawn']);

export const staleCaseDiagnostic = 'This provenance case is stale. Automatic expiration requires a reviewed replacement contract.';
export const isTerminalCase = status => terminalStatuses.has(status);

export async function isStaleCase(c, readView, now = Date.now()) {
  if (isTerminalCase(c.status)) return false;
  if (c.kind === 'attribution') {
    const provenance = await readView('get_provenance', [c.target]);
    return Number(provenance.version) !== Number(c.revision);
  }
  if (c.kind === 'authorship') {
    const author = (await readView('get_external_authors', [])).find(a => a.id === c.target);
    return !!author?.claimed_wallet || Number(author?.binding_version) !== Number(c.revision) || now >= Number(c.identity_expiry) * 1000;
  }
  return (await readView('get_problem', [])).status === 'resolved';
}

export async function requireV3CaseCanProceed(c, readView, now = Date.now()) {
  if (await isStaleCase(c, readView, now)) throw Error(staleCaseDiagnostic);
}

export async function reconcileV3CaseExpiration(c, executor, transaction) {
  if (c.status !== 'expired') return;
  const reason = c.history?.findLast(item => item.event === 'expired')?.reason;
  if (typeof reason !== 'string') throw Error('Exact native case expiration reason is unavailable');
  await transaction('expire', executor, 'expire_case', [c.id, reason], false, true);
}
