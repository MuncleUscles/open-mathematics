# Protocol and problem repositories

V4 separates reusable execution from mathematical content. The old v3 release and dashboard remain independently deployed until a reviewed activation. Local checks and fixtures do not establish live enrollment or an end-to-end result.

| Repository | Responsibility |
| --- | --- |
| `MuncleUscles/open-mathematics` | Intelligent Contract, isolated Lean checker, claim helper, GitHub worker, dashboard builder |
| `MuncleUscles/p-vs-np` | Mathematical definitions, task statements, required submission records, research PRs, reviewed workflow pins and public evidence |

The problem repository uses `main` for reviewed configuration, protected `research` for contributions, and `evidence` for rebuildable reports. Its workflow checks out `main` at the triggering commit and protocol tools at a literal reviewed SHA. It never checks out a contributor's PR as executable code. Only two bounded regular blobs—the proof and record—are read from the exact signed commit.

## Open work without replacing the ledger

`Research(config_json)` creates one problem ledger with three separate roles: curator, verifier and executor. The curator enrolls exact policy file bytes and immutable source-review commits through `enroll_policy`; enrollment assigns no points. Later batches append goals without changing old policies or resetting balances. A goal cannot change its definition, proof path or reward eligibility. `close_goal` permanently prevents new registrations while preserving existing decisions and historical credit. It is not a rollback of an already registered claim.

The initial pack offers two independent formalization tasks: parity namespace disjointness and CNF restriction correctness. Clause restriction is a supporting milestone in the latter, not another award. Unit propagation is deferred until meaningful dependency credit is supported for this pack. Disjoint-SAT has a disclosed proof and is nonrewardable. These are known SAT foundations, not mathematical discoveries or a solution to P versus NP.

Policies bind ordered definition bytes, the exact theorem type, a content fingerprint and goal commitment. The contract recomputes commitments. A separate proposition hash prevents identical propositions being renamed or re-enrolled after definition-file churn. This is not semantic equivalence detection: binder renaming, reformulation and different definitions still need curator and GenLayer review.

The previous v3 ledger at `0x6acF1e29790B2eE45c01184fFaa8F84f06ba9AAc` remains live for corrections. Its historical 800 points are not imported, re-awarded or summed with v4. The deployment reserves the actual two previously credited propositions as well as their historical fingerprints. Later-impact, affiliations, documentary cases and external-author allocations do not cross ledgers. A future migration needs a separately proven import design.

## Exact claim and verification flow

The contributor signs an EIP-191 version-3 claim containing repository, problem, chain, contract, PR, head, base, branch, record hash/path, goal/hash, policy hash, source-review commits, wallet, nonce and expiry. The PR author's original, unedited comment must contain this envelope. Keys remain local. The required schema makes novelty, sources, attribution and limitations explicit.

`problem-select.mjs` selects only eligible signed comments. `problem-verify.mjs` re-reads the selected comment and resolves exact source blobs from the canonical problem configuration history. `verify_problem.py` checks the raw policy, all trusted files, expression grammar, exact theorem and restricted axiom report inside pinned Lean in a resource-bounded, networkless container. `--lean` is explicitly local diagnostics and cannot emit production verification. Shared Unicode commitment vectors are consumed by JS, Python and native tests.

The enrollment `protocol_commit` is an immutable review snapshot. The currently executed tools are separately pinned by `.open-math/problem.json` and recorded as signed `worker_commit` evidence. Thus an updated worker can process a new claim for an older task without rewriting its enrollment. Before changing worker pins, drain or reconcile in-flight journals under their original worker: cached attestations from another worker are deliberately parked, not rewritten or rebroadcast.

The verifier attests formal validity. GenLayer independently decides merit and allocation, with a challenge window. The worker validates exact-call consensus receipts, final native state, approved GitHub checks and branch protection before implementing a merge. Points settle only after canonical merge confirmation. Known failed consensus and unknown broadcasts remain journaled for reconciliation; they are not rerolled.

## Running and operating

Contributors start from the problem repository's `AGENTS.md`, which pins trusted tools and provides `goals`, `init`, `check`, `prepare`/`sign`, `envelope`, `status` and `challenge`. A policy file on disk is not proof of an open reward. The helper queries finalized native configuration and enrollment before preparing a contribution.

Curators compile a reviewed mathematical pack with `node scripts/compile-problem.mjs PACK DEST OWNER/REPO`. Commit policy and mathematical bytes first; the separate descriptor can then name that immutable source commit without a circular hash. Additive batches retain all old files and use new versioned file paths when needed.

`node scripts/manage-problem.mjs deploy CONFIG JOURNAL` and `enroll PROBLEM_DIR POLICY_SHA` preview the exact action. `--send` uses a dedicated local `OPERATOR_KEY_FILE`; enrollment also requires an `ENROLLMENT_JOURNAL`. Deployment intent is persisted before broadcasting, and an unknown broadcast cannot be retried blindly. Keep the curator key out of GitHub. Separate verifier and executor pilot keys belong only in a protected problem-repository environment; they still share the worker's host trust boundary.

The site is static: `node scripts/build-problem-site.mjs PROBLEM_DIR OUTPUT`. GitHub Pages hosts the dashboard and GitHub Actions supplies the worker; no always-on application backend or indexer is needed for this bounded pilot. The contract is authoritative, reports are a cache, and the page explicitly requests live availability instead of polling Studio continuously. Scheduled recovery is best-effort; supervised workflow dispatch with the original comment ID is the fallback.

## Validation and limits

Run Node tests with `npm test`; native direct tests with `.venv/bin/pytest tests/direct -q`; pinned GenVM lint on `contracts/research_v4.py`; and checker tests with `LEAN_BIN=/path/to/lean-4.19.0 python3 -B -m unittest discover -s tests -p test_problem_verifier.py`. `RUN_DOCKER_TESTS=1` also requires the pinned image from `github/build-verifier.sh`. Direct LLM tests are mocked; Linux Docker validation and a live native/GitHub contribution are separate evidence.

The pilot has a lifetime cap of 100 registered contributions, 100 goals and bounded challenge/case quotas. Free wallets are not sybil resistance. General dependency importing, production scheduling, independent identity and lossless ledger migration remain outside this launch cut. Do not advertise unattended public operation until the exact new deployment completes native and GitHub end-to-end trials.
