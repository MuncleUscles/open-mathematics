# Review: v3→v4 migration and goal proposal

**Verdict.** A v4 migration modelled on the existing v2→v3 import is unsafe: it would allow a second impact payout, silently lift the shared-controller cap, and could brick `get_problem`. Public views can reconstruct the complete v3 state, but only with a new capture tool; `public/community-snapshot.json` is not valid import input. The worktree has no v4 code yet (HEAD is `eecacad`, no diff), so this reviews v3 and its tooling as the migration source. Static reading only: no tests run, no chain reads, no files written (plan file and MEMORY.md skipped per the read-only instruction).

## Findings: migration

**P0 — would misallocate points or brick the ledger**

1. **Dropping impact state enables a double payout.** The v3 import requires `impacts` to be empty and carries balances only (`contracts/research.py:507`, `:532-537`). Copied to v4, balances arrive as 500/300 but `impacts` and `impact_artifacts` are empty, so `review_impact(pr-5…)` passes the guards at `:329-336` and pays wallet `0x62d4…` another 100. (std 15)
2. **Integer typing decides the sybil cap.** `normalize` turns every bigint into a string (`src/studio.mjs:3`); the snapshot has `round:"0"` and `github_author_id:"2372232"`.
   - `shared_github_author` is an `==` against the new int id (`research.py:344`). A string import makes it false, so the max band becomes 3 instead of 1 (`:355`) and the same-controller cap goes from 100 to 300.
   - The same defect makes every imported object unsettleable (`expected_round != r["round"]` at `:185`, `:346`, `:861`) and makes `binding_version += 1` (`:910`) and `version += 1` (`:891`) raise.
   - v3 hand-coerced seven paths (`:515-523`); v3 state has about 30 int paths, and an all-digit `claim` defeats heuristics. Capture typed values instead: the SDK decode returns bigint vs string before `normalize`, and `rawReturn` exists. (std 3)
3. **Case enumeration truncates silently.** `list_cases` returns the last 100 (`:643`), and the bound check in `scripts/capture-community.mjs:26-27` can never fire.
   - `report_case` is permissionless and `withdraw_case` frees the slot (`:956-968`), so one wallet can append 100 cases and push the three real ones out of view.
   - `validatedCommunitySnapshot` does not check `problem.external_solutions ⊆ cases` (`public/community-snapshot.mjs:56`).
   - Importing a `problem_state` that references an absent case raises at `:634`; external-solution `report_case`, `review_case` and `expire_case` then all revert.
   - Enumerate with `list_case_page` (`:647`) to exhaustion and check referential closure. (std 5, 14)

**P1 — silent state loss or wedge**

4. **Lineage overwrite.** `:524` writes `record["ledger_migration"]`, and both records already carry it (v2→v3: `0x33262…`, `33c8e6…`). Reusing the key erases that link. pr-1 also has `migration` (v1→v2), which `:344` reads. Keep records byte-identical and put v3→v4 lineage in a separate map and view.
5. **Bootstrap window.** Only `register` is gated on import (`:122`), and the "empty ledger" check covers only `order` and `total_points` (`:504`). A pre-import `set_affiliation` or `report_case` on v4 yields duplicate `affiliation_order` entries or inconsistent `case_order`/`active_cases`. Gate every write.
6. **Do not import `active_cases`.** `expire_case` has no `withdrawn` check (`:938-952`), so a native counter can sit below the true count. The snapshot has no `get_case_capacity` reads, so I cannot confirm native values; derived counts are 0 for both reporters. Import terminal cases only, start counters at 0, and assert native equals derived at freeze.
7. **Balance keys are not enumerable.** The capture reads only record wallets (`capture-community.mjs:38`), but points can land on a claimed-author wallet (`:906`); today that is coincidentally the same wallet `0x5f1d…`. Completeness is provable: Σ known balances + Σ unclaimed == `total_points` with non-negative balances. Enforce it in the tool and in the contract.
8. **Hash-in-source makes import checks untestable.** `tests/direct/test_migration.py:15-20` proves only a hash mismatch; the semantic checks at `:507-512` never run on a snapshot that passes the hash. Pin the hash as a constructor argument so adversarial fixtures execute. (std 13)
9. **Operator parameters have no view.** `verifier`, `executor`, `policy`, `window`, `legacy_required` and `imported_snapshot` (`:63-78`) are readable only from deploy calldata. The capture compares `codeHash` against the local file, not the chain (`capture-community.mjs:9`); the SDK has `getContractCode`. (std 7)

**P2 — hardening**

10. **Affiliation spam carries over.** The 500 cap is global and wallets are free (`:604`); `get_affiliations` is unpaginated (`:616`). Import only affiliations of wallets already in the ledger (record wallets, claimed wallets, reporters of imported cases).
11. **Size.** The import bound is 40,000 chars (`:498`); compact v3 state is already 27.4 KB (records 9.3, cases 11.5, impacts 3.8).
12. **Worker wedge.** `github/process-case.mjs:29` skips a terminal case only if its evidence journal has `completedAt`. Otherwise `:38` throws an identity mismatch under the v4 contract on every scheduled run. Keep imported cases out of `admitted_cases`.
13. **Version pins.** `protocolVersion!==3` is hardcoded in `scripts/agent.mjs:98,136,139`, `capture-community.mjs:9`, `community-snapshot.mjs:48`, `research-community.mjs:67`, `process-case.mjs:9` and `import-snapshot.mjs:7`. They fail closed, but flipping the pointer without updating them takes the helper and dashboard dark.
14. **Every new goal forces a replacement.** `policy` is immutable and checked at `:128`, so `disjoint_sat` cannot be enrolled on v3 and each later goal means another migration. An append-only policy history in v4 would avoid that; this is your decision.

## What must be preserved

| State | Source | Reconstructable? |
|---|---|---|
| Records (2), including `digest`, `merge_commit`, `migration`, `ledger_migration`, per-record `evidence.policy` (pr-1 is `6913ab…`) | `list_contributions` + `get` | Yes, capped at 100. `digest` is opaque; its preimage exists only in register calldata. |
| `fingerprints` | no view | Derived: statement hash of approved/credited records (`a1c9…`→pr-1, `ca48…`→pr-5). |
| `points`, `impact_points`, totals (500/300, 800, 100) | `get_points(wallet)` | Yes, via wallet closure plus the conservation check. |
| `impacts`, including `source_digest`, `eligible`, `paid_points` | `get_impact` | Yes. `impact_artifacts` is derived (`e418…`→pr-5). |
| Provenance (both version 0) | `get_provenance` | Yes. |
| External author: `binding_version` 1, `verified_subject`, `claim_history` | `get_external_authors` | Yes. The author id is not domain-bound, so it is stable. |
| Cases (3) with `attestation_hash` (`c444…`, `fa93…`) and history timestamps | `list_case_page` + `get_case` | Yes. Ids and `identity_challenge` embed the v3 address; keep as historical. |
| `problem_state` | `get_problem` | Yes. Store `open`, not the derived status. |
| Affiliation history with original timestamps | `get_affiliations` | Yes while small. |
| `active_cases`, `admitted_cases` order | per wallet / last 100 only | Derive; do not import. |
| Operator parameters | none | Deploy tx `0x18b79f…` only. |

Receipt lineage to carry:
- **Contracts:** v1 `0x8981C4…` → snapshot `7fd204…` → v2 `0x33262B…` → snapshot `33c8e6…` → v3 `0x6acF1e…` (import tx `0x58809d…`).
- **Merge receipts:** `0xe675bf…` (pr-1) and `0xf3f509…` (pr-5).
- **v3-native receipts:** impact, affiliation and case transactions, plus the evidence-branch journals that hold the attestation preimages.

**Confidence.** High for the current state (2 records, 3 cases, 1 affiliation, 1 author) once re-captured with typed, paginated, bracketed reads. The existing snapshot is internally consistent (500+300=800; 700+100=800, checked by hand), but it is non-atomic (19 s window), has stringified ints, uses `list_cases` only, and has no capacity or operator reads.

## SDK historical reads (installed genlayer-js 0.18.9)

- **Not supported.** `readContract` sends `gen_call` with only `transaction_hash_variant` ∈ {`latest-final`, `latest-nonfinal`} (`src/contracts/actions.ts:76-86`, `src/types/transactions.ts:137-140`). There is no block, hash or timestamp parameter.
- **Available:** `rawReturn`, `getContractCode`, and the typed RPC `sim_getTransactionsForAddress`, which the repo already uses (`github/receipt-recovery.mjs:43`).
- **Not to rely on:** receipts carry `contract_state` (stripped at `github/runtime.mjs:9`), but the SDK has no decoder for it.
- **Unverified:** pagination and lag of the history API (the repo itself notes lag at `receipt-recovery.mjs:35`), and whether raw return bytes are canonically ordered.

## Cutoff, quiesce, late writes, authority

1. **Announce at T-48h.** No new authorship claims after T-24h, because of the 24 h expiry (`:692`).
2. **Drain.** Assert zero records in submitted/provisional/challenged/approved, zero impacts in provisional/challenged, and zero admitted non-terminal cases.
3. **Pause intake in-repo.** No flag exists today, and the crons keep firing (`research.yml:12`, `provenance.yml:10`). Add `intake:"paused"` to `deployment.json`, checked by `select-claim`, `process-claim`, `process-case`, `process-impact` and `om sign/prepare`.
4. **Anchor by bracketing.** Read the transaction history, do the typed reads, read the history again, and require the two histories to be identical with every tx terminal. The cutoff is {tx count, last hash, digest of hashes}. Repeat after window plus finality margin and require the same state hash.
5. **Re-check at import and at pointer flip.** Every post-cutoff tx must decode to `set_affiliation`, `report_case`, `withdraw_case`, or a failed execution. Any operator-sender tx or `challenge*` aborts. (std 4)
6. **Late v3 writes are not migrated.** After the drain none can touch points: every point path is gated on verifier or executor (`:118`, `:182`, `:249`, `:287`, `:322`, `:434`, `:701`, `:779`, `:858`), and challenges need provisional objects. Wallets re-declare affiliation on v4 with their own signature and re-file unadmitted reports. Do not add an operator "late delta" import; that would let the operator write self-declared state.
7. **Authority.**
   - Keep one pointer: `deployment.json` → `agent.json`.
   - Add a v4 `get_lineage()` view and archive `deployment-v3.json`.
   - Use fresh v4 operator keys and delete the v3 secrets after activation.
   - Add an `om --send` guard that compares the local contract with the published `agent.json`. v3 cannot reject stale-tool writes, so without it a contributor's write is lost silently. (std 9)

## Narrowest safe draft plan

1. **Tools only, no contract change.** Write `scripts/freeze-v3.mjs` (typed, paginated, bracketed, on-chain code check) and a pure invariants module with fixtures. It is read-only against v3 and can run as a dry run now.
2. **New file `contracts/research_v4.py`; v3 file untouched.** The diff is limited to:
   - one shared terminal-status set for expire/settle/withdraw (fixes the race; std 2);
   - `import_state` with a constructor-pinned hash, no coercions, and on-chain checks for conservation, terminal-only state and referential closure;
   - a bootstrap gate on every write;
   - a separate lineage map;
   - removal of the dead v2 import (std 17);
   - `freeze()` plus successor and enumeration views, so the next migration is atomic. This fixes the root cause rather than repeating the workaround.
3. **Tests.**
   - Round-trip: raw view bytes on v4 equal the captured v3 bytes for every entity.
   - Double pay: `review_impact(pr-5)` reverts after import.
   - Cap: a new downstream by GitHub id 2372232 on another wallet gets `max_bands` of 1 for pr-1 and pr-5.
   - Reservation: both statement hashes are refused.
   - Adversarial snapshots: +100 balance, missing wallet, missing impact, dangling case, non-terminal object, string `round`.
   - Race regression: `(withdrawn, 1 active)` is unchanged after expiry, and the test fails on v3 code.
   - Identity: author `d76c…` cannot be re-claimed or change subject.
   - Tool: a 103-case eviction fixture is fully enumerated.
   - Worker: no wedge on a journal missing `completedAt`.

**Blocked until separately authorized:** any deployment or Studio rehearsal, the pointer flip, intake resume, enabling expiry initiation, policy change or goal enrollment, and deletion of v3 secrets.

## Goal proposal (`next-goals/PROPOSAL.md`)

Proposing an unenrolled exact statement is coherent with both goals closed: `AGENTS.md` step 2, `docs/GOAL-PROPOSALS.md:5` and `agent.json` `whenNoGoalsOpen` define exactly this path. The proposal labels itself correctly as not enrolled and earning no points.

| Stage | Trust | State today |
|---|---|---|
| No-wallet proposal (issue) | Untrusted discussion; no points, no reservation | Not filed |
| Local verified reference | Proposer's machine only | Done: macOS Lean 4.19.0, `--trust=0`, axioms `propext` and `Quot.sound` |
| Trusted enrollment | Reviewed policy and verifier release plus a new deployment | Blocked on v4 (finding 14) |
| Production verified PR | Isolated Linux verifier, signed claim bound to contract and policy | Impossible until enrolled |
| IC judgment | GenLayer merit; a correct proof can earn zero | Not applicable yet |

Gaps:
- **Availability field.** The form requires a goals query (`goal-proposal.yml:13-19`), and `PROPOSAL.md:5` says none was made. Run `om goals` before filing.
- **Local pass is not a production pass.** Production assembly prepends `import Lean` and appends `Inspect.lean` (`lean/check.py:20`), while `ReferenceCheck.lean` has no import. `simpa`/`simp` behaviour depends on the loaded simp set, so re-verify under the exact assembly and image. The default Lean path is an ephemeral `/private/tmp/…` (`verify-proposal.py:8`), and the tools path is the sibling `sides-provenance` worktree (`:7`).
- **Grammar is the security-critical change.** `check.py:6` is a closed whitelist of about 40 tokens; the reference proof needs dozens more, including free local names (`transport`, `joined`, `l.1`). Admitting arbitrary identifiers under `import Lean` opens elaboration-time code paths. Keep a closed tactic and lemma whitelist with a bounded binder-name pool, and test it adversarially.
- **Open research vs assigned bounty.** Publishing the full proof makes the future goal copy-paste, and the proposer is the same GitHub controller (2372232) that holds all 800 points. My recommendation, for you to decide:
  - file the statement, negative checks and the proof hash (`a272dc…`), and withhold the proof text;
  - have maintainers not self-submit during a stated open period.
- **Optional.** The transport lemma is the reusable primitive. Enrolling it would give later goals a real dependency instead of `dependency: null`.
- **Misleading output.** `agent.mjs:43` reports `creditedDependency` for every goal, including ones with no dependency.

**Next step:** build `scripts/freeze-v3.mjs` and the invariants module (plan step 1) and run it read-only against v3. That either confirms the 800-point state under a real cutoff anchor or surfaces drift before any contract work.
