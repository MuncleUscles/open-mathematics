# Draft v3 replacement: preserve state before activation

This is a local engineering proposal, not a deployment, migration authorization or new authoritative ledger. The published v3 contract remains `0x6acF1e29790B2eE45c01184fFaa8F84f06ba9AAc`; its source and policy are unchanged. The worker still refuses to initiate documentary expiry. Do not apply the proposed guard to the deployed source file, rerun the older v2 importer, or switch deployment metadata to an unverified replacement.

## Why the one-line fix is not the whole replacement

`expire_case` must treat `withdrawn` as terminal, just as it treats `expired`. The patch and direct-VM regressions here show that delayed executor expiry can preserve history and quota while still expiring a genuinely stale active case once. The temporary patched copy also passes GenVM lint and validation with 31 public methods.

The existing `import_snapshot` accepts only the exact older v2 ledger with 700 initial points and no impact reviews. It deliberately initializes earlier provenance. Reusing it would omit the v3 impact award, affiliations, native author identity and documentary history. A complete v3 replacement needs a separate importer and a reviewed cutoff.

The initial public read model has 2 credited records, 700 historical initial points, 100 settled later-impact points, 2 wallet balance views, 1 affiliation history, 1 author binding and 3 terminal cases. It was collected over 19 seconds. It is useful audit input, but it is not proof of complete state at one moment.

## State that must survive

| State | Preservation and independent cross-check |
| --- | --- |
| Deployment configuration | Source chain/address/code, verifier and executor roles, problem ID, old policy, dispute window, full-target definition and imported-ledger lineage. A new policy is a separate reviewed binding; it must not rewrite historical evidence. |
| Contributions | Original ordered IDs, full evidence, evidence digest, status, rounds, challenges, verdict, deadlines, exact merge commit and historical award. Never manufacture a new acceptance or a new merge receipt for carried records. |
| Statement reservations | Preserve the source fingerprint map or prove an exact reconstruction from complete records and terminal transitions. Do not reopen a credited statement or retain an expired reservation merely by guessing from a displayed row. |
| Current and historical points | Wallet totals, later-impact balances, total points and historical initial amounts. Initial retention after corrections, external allocations, unclaimed author points and revoked amounts must reconcile independently; an aggregate total alone cannot catch a redirected wallet. |
| Impact reviews | Preserve all review states, original downstream digest, eligibility, allocations, rounds, challenges, deadlines and paid amount. Preserve artifact-use reservations so import cannot repeat an old award. |
| Provenance | Preserve exact initial budgets, current retained credit, sources and source-scoped author IDs, correction versions, before/after history, external shares and revocations. Do not call `_initial_provenance` to overwrite corrected v3 state. |
| External authors | Ordered source IDs, exact URL/name identity, verified subject, claimed wallet, binding version, unclaimed points and complete claim history. Claim text bound to the old contract remains historical evidence, not a newly signed challenge for the replacement. |
| Cases and quotas | Enumerate from offset zero with `list_case_page`, retaining full histories, attestations, verdicts, revisions, identity deadlines and challenges. Reconcile the admitted-case order and each reporter's active counter. A reconstructed logical count must be compared with actual storage; silently repairing a mismatch would conceal the original bug. |
| Affiliations and problem status | Retain wallet order, current side and all changes; retain immutable contribution directions separately. Preserve external-solution references and any native resolution exactly. No complete P vs NP target is currently enrolled. |
| Receipts and audit feed | Retain original contract/chain/hash/method/typed-argument bindings, successful independent reviews, failed receipts, native rounds and GitHub ancestry. Migration has its own receipt; it does not replace historical verification. |

## Cutoff and activation are unresolved requirements

The installed `genlayer-js` 0.18.9 `readContract` implementation in `src/contracts/actions.ts` sends `transaction_hash_variant`. Its `TransactionHashVariant` enum exposes `latest-final` and `latest-nonfinal`, not an arbitrary historical transaction or block argument. Do not invent a pinned-read API or treat an ignored SDK field as snapshot isolation. No native historical-read experiment was made for this draft.

`list_cases` and `list_review_cases` return only the latest 100 IDs. The presentation schema itself is capped at 100 cases. A migration exporter must not inherit these display limits: paginate complete case history, verify its boundary and admission order, and explicitly fail when complete enumeration cannot be established.

Stopping operator workflows can prevent new verification, consensus, merge confirmation and settlement, but it does not freeze contributor-controlled affiliation, report, challenge or withdrawal writes on the old immutable contract. A safe cutover therefore needs a published authority/cutoff rule, handling of those later writes, and evidence that no pending operator transaction can change rewards after the selected state. A second equal read pass is a useful diagnostic; it is not by itself a proof against an intervening change or incomplete history.

Before activation, separately implement and review:

1. A complete exporter with a supported, verified snapshot anchor or an explicitly bounded verifier-attested consistency procedure. Preserve raw responses and exact bytes; distinguish this trust boundary from consensus verification.
2. Operator quiescence and treatment of every pending contribution, impact and case. The narrow initial replacement should require no in-flight work unless a transition has been specifically tested. Do not expire v3 cases as a shortcut.
3. An immutable exact import commitment, source identity and schema; one-time authorized import before any new writes; failure atomicity; idempotence after import; no additive points; exact preservation of rejected/withdrawn/expired history and typed integers.
4. Full post-import comparison and accounting checks, including individual wallet destinations, unclaimed external balances, source identity pins, duplicate reservations and replay behavior. Reconcile canonical GitHub heads and all final checks against the original receipts.
5. A reviewed authority switch for the site, helper and worker, with an explicit old-ledger archive and no summing balances across versions. Define rollback before activation and what happens if late old-contract calls occur.

This draft intentionally contains no migration writer, signing path, replacement deployment or metadata switch. It does not claim these requirements are met.

## What the local audit does

Run from the repository root:

```sh
node proposals/v4/audit-snapshot.mjs
node --test proposals/v4/tests/snapshot-audit.test.mjs
```

The audit checks intrinsic accounting and reference consistency in the existing display bundle, including budget conservation, original awards, dependency recipients, later-impact totals, claimed-author wallet coverage, source-identity claim history and terminal-case scope. It always returns `readyForMigration: false`. Its exit code reports only whether those local consistency checks passed; it must never be used as a deployment gate. The saved `historical-view-audit.json` records the input hash and observed 800-point reconciliation. It does not authenticate RPC source state, prove complete enumeration, replace raw storage validation, or verify every historical receipt.

Tests corrupt individual balances, totals, impact allocations, statement fingerprints, history and identity coverage. A synthetic correctly balanced correction fixture can pass the local arithmetic audit while still remaining unauthorized for migration; matching numbers do not establish source truth. Actual positive native attribution reallocation and nonzero external-author claiming remain uncompleted trials.

## Independent review and dispositions

[Fable's complete read-only review](FABLE-REVIEW.md) examined v3 at `eecacad` and the earlier `work/next-goals` prototype. It did not execute tests or read the chain, and it did not inspect the final portable proposal or the new local audit. Its findings are review evidence, not a deployment approval or a claim that the next version exists.

- **Double payment, numeric typing, truncated history:** accepted as replacement blockers. Retain impact reviews and artifact reservations; export typed integer/string values before the display normalizer; enumerate all case pages. Numeric strings such as `round` or `github_author_id` must not be guessed back into types by their contents. An all-digit claim remains a string. Incorrect types can disable the shared-controller cap or break settlement, even with correct total balances.
- **Lineage, bootstrap, quotas and identity:** preserve prior `migration` and `ledger_migration` byte-for-byte, adding a separate lineage record for the new transition. Gate every write until exact committed import succeeds, not only registration. Compare native capacities with derived live cases; fail on disagreement rather than silently repairing history. A terminal-only import starts zero active counters and no processing queue. Preserve identity subject, binding version and every claim/correction reference.
- **Coverage and authority:** enumerate record, claimed-author and all other valid balance recipients and prove per-wallet as well as aggregate conservation. Check deployed source using the supported SDK code endpoint and verify constructor roles from the exact deployment receipt. Source-code equality is not an attestation that every response came from that contract.
- **Testability and size:** use a constructor-bound immutable import commitment in the prospective design so malformed committed fixtures reach semantic checks. Measure real bounded import size; do not reuse the 40,000-character v2 limit blindly. The importer, export schema and these semantic tests are not implemented here.
- **History bracketing:** accepted as one diagnostic component, not sufficient proof of an atomic snapshot. The installed SDK offers no arbitrary historical read. History pagination, omitted/lagging transactions, terminality, typed read stability and the later cutoff recheck must be demonstrated before labeling an export complete. Even matching history lists do not prove absence of unseen writes. Do not call a diagnostic a freeze, and do not infer migration readiness from it.
- **Cutover tools:** worker intake pause, stale-helper address checks, version changes, historical-case queue exclusion, source archival, successor metadata and separate replacement keys remain required implementation work. The reviewer suggests deleting old secrets only after activation; this draft changes no secrets and switches no authority.
- **Affiliation spam:** no silent history pruning in this proposal. A bounded eligible-wallet view or re-declaration rule may be useful, but a selective import must be an explicit reviewed policy with the full historical archive retained. Free-wallet affiliation spam remains a production design limit.
- **Future goals:** the immutable policy means a new goal cannot be enrolled merely by changing JSON. An append-only policy registry and a future explicit freeze/successor mechanism are design options requiring separate adversarial review, not additions hidden inside this guard fix.

The next-goal prototype's hardcoded paths and stale standalone proof assembly were fixed in `proposals/disjoint-cnf`: the portable verifier executes the actual input buffers and clears old evidence on failure. Its production Linux assembly/image, grammar and enrollment remain untested. A fresh finalized goals read at 03:46 UTC on 2026-11-23 confirmed both existing goals closed. The helper's misleading generic dependency display is addressed in a separate maintenance release, not by altering this proposal's policy.

The reference proof remains open and explicitly attributed. Withholding an already known infrastructure proof to manufacture a reward opportunity would not improve novelty. A future submitter must disclose this reference; correctness alone promises no points, and maintainers should not self-submit this reference as an independent discovery. This proposal itself requests no reward.
