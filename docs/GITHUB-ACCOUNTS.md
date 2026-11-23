# GitHub contributor identities

The account contract is an additive index of the active research contract. It
stores native credit totals by GitHub's stable numeric account ID and a
refreshable username. It does not issue a second reward, transfer points, change
research decisions or migrate the existing ledger. Never add its totals to the
source ledger's totals.

## Account control

1. The contributor signs the exact repository, PR, head/base commits, artifact
   record, wallet, contract, policy, expiry and protocol release.
2. The GitHub PR author posts that envelope in an original, unedited comment.
3. The trusted verifier independently fetches that exact PR and comment. Their
   numeric author IDs must match, the signed fields must match, and the wallet
   signature must recover the claimed wallet. Account type and age are checked
   against the matching GitHub profile.
4. Only the enrolled verifier can register this evidence on the research
   contract. The original GitHub ID and signing wallet remain in every native
   contribution record.

This proves authorization by the GitHub account and wallet for the submission.
It does not prove a unique human controls both, make wallet/account ownership
globally exclusive, or prevent somebody controlling multiple GitHub accounts.
The research contract trusts the enrolled verifier for these external checks.
The account companion does not remove that trust assumption.

## Native account credit and names

Anyone can call `sync_contribution(id, expected_source_hash)`. The contract reads
the pinned research contract's finalized record and impact record itself. It
adds only the difference from the previously indexed author credit and copies
settled impact allocations once, using each upstream contribution's original
GitHub ID. It never accepts caller-supplied recipients or points. The expected
hash is `openMigrationHash({record, impact})`; stale observations fail.

Multiple signing wallets under the same GitHub ID share one account total.
Distinct GitHub IDs remain distinct even when they use the same wallet. Original
wallet balances remain available for audit in the research contract. Numeric
IDs survive username changes; usernames cannot move credit between accounts.

`refresh_username(id, expected_checked_at)` independently fetches
`https://api.github.com/user/{id}` through GenLayer web consensus. Validators must
agree exactly on the returned numeric ID, username and normal `User` type. The
caller supplies no username. This verifies the public account label, not the
original PR authorization. The observation time is stored on chain; failed or
undetermined refreshes leave the previous observation intact.

`get_account(id)` and `list_accounts(offset, limit)` expose the native account
ledger. `get_state()` compares its indexed record count and point totals with
the source's finalized totals. Updates may lag; the website labels partial,
stale or unreconciled views and suppresses their rankings. Snapshot dates are
collection intervals, not atomic snapshots. Names always show their last
on-chain observation time.

## Operations

The problem repository pins `.open-math/github-accounts.json` separately from
the original protocol. The main-only research workflow runs the pinned account
updater with the already-enrolled executor key after research processing. It
scans a bounded rotating page plus recent records, preserving exact-call
journals on the protected evidence branch. Name refreshes are bounded and
separate from point synchronization. No credentials are placed in Pages builds.

Preview/deploy from a clean, reviewed implementation checkout:

```sh
node scripts/manage-github-accounts.mjs deploy /path/to/problem /outside/repo/deploy.json
OPERATOR_KEY_FILE=/outside/repo/dedicated-deployer.key \
  node scripts/manage-github-accounts.mjs deploy /path/to/problem /outside/repo/deploy.json --send
```

Copy the finalized journal's `deployment` object into the problem's reviewed
`.open-math/github-accounts.json`, pin the exact implementation in its workflow,
and run `node github/sync-accounts.mjs /path/to/problem` from that workflow.
For an operator-only local run, pass an outside-repository journal directory
as the second argument and supply the dedicated executor through the process
environment. Never print or commit any private key.

There is no claim of new research E2E validation here: account deployment,
profile consensus and credit readback are separate from Lean verification,
merit adjudication, protected merging and upstream reward trials.
