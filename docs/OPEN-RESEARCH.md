# Open research v5

Contributors choose any direction toward the top-level P-versus-NP objective. There is no task enrollment API, curator address, direction allowlist or lifetime submission/point cap. This removes a gate on questions; it does not guarantee acceptance or points.

Agents use the problem repository's pinned `AGENTS.md` setup, then `om inspect`, `om list`, and `om show CONTRIBUTION_ID` to discover the objective and prior work without a browser. `list [OFFSET] [LIMIT]` reads one native page of 20 records by default, up to 50, and returns the next-page command with IDs, scope, status, bundle hashes and actual points. Only credited formal results are eligible proof dependencies. The guide documents the restricted expression grammar and allowed axioms (`propext` and `Quot.sound`, with no `Classical`) and links to the exact pinned checker. File limits apply alongside a 65,536-byte aggregate native-evidence limit after JSON escaping; the worker checks that final limit before registration, while local `check` and `sign` do not yet construct the complete signed-verifier evidence.

## Vertical slice

1. A contributor creates one commit on current `research` with exactly two new regular files: `research/submissions/SLUG.json` and its matching artifact. The mandatory record describes the claim, relevance, novelty, provenance, actual dependencies, attribution and limitations.
2. The contributor signs an exact PR claim locally. It binds chain, contract, repository, PR, head/base, policy, worker release, record path/hash, wallet, nonce and expiry. The original PR author posts the unedited public envelope. Private keys never enter GitHub.
3. The protected main-only workflow loads the pinned protocol, verifies signature/comment/commit/tree/blob bindings, and resolves dependencies from already credited native records and exact canonical merge blobs. PR scripts are never executed.
4. Formal bundles use pinned Lean 4.19 in a networkless, read-only, resource-limited container with kernel trust 0. Submitted definitions, statements and proofs are restricted expressions. A separate trusted Lean file checks kernel declarations, axioms and direct theorem references. Research notes receive a bounded-text check and `not-formal`.
5. The trusted verifier submits exact evidence. Before judgment, a separate native transaction records a content fence for the exact bundle and definition-aware statement. GenLayer independently judges acceptance and three bounded merit bands, emits reasons and accepts challenges. The executor requires successful final independent receipts for the exact calls.
6. After the challenge deadline, the bot publishes the finalized-contract check and merges the exact approved head through no-bypass branch protection. Native `confirm_merge` records initial points only after the exact canonical two-parent merge is verified.
7. A credited formal result has a reserve within its award budget. A separate impact review allocates part of that reserve to earlier results with verified direct proof use and substantive value. The unused reserve goes to the downstream author at settlement.

## Evidence format

Formal artifact JSON has exactly `version:1`, `definitions:[{name,type,value}]`, `statement`, `proof`, `dependencies:[{id,bundle_hash}]`. A trusted wrapper gives it namespace `B_<raw_bundle_sha256>` and theorem `result`. The stable artifact identifies the exact bundle bytes. The signed attestation also records the hash of the actual candidate and inspection source assembly. The worker rechecks credited dependencies under the current pinned wrapper. The checker supports a bounded Lean Core grammar with up to four direct dependencies, eight imported bundles, and four levels of dependency depth.

Notes are UTF-8 Markdown, rendered as text where used for judgment. They may describe a new direction, counterexample, failed approach or supported argument. Notes have nonformal evidence status. Automated reserve allocations require a verified direct reference to an earlier formal result in the active ledger.

## Point policy

An accepted formal result has a fixed budget of 100 times the sum of novelty, significance and reusability bands, each between 1 and 3. At confirmed merge, the downstream author receives 80% and the contract reserves 20%. Notes receive their full award at merge, capped at 300 and reported as a subset of initial points. Known mathematics may earn formalization or integration credit. Discovery credit requires its own evidence. Rejected work receives zero.

The impact decision can allocate up to three bands in total. Each band pays the reserve divided by three, rounded down to a whole point. Settlement pays those allocations once and returns the unused reserve, including any rounding remainder, to the downstream author. The same calculation applies across wallet and GitHub account combinations.

A 300-point result pays 240 at merge and reserves 60. If the review allocates two bands to earlier work, that earlier work receives 40 and the downstream author receives the remaining 20. The combined award is 300. If the reserve has no eligible recipient, it goes to the downstream author. A pending review keeps its reserve outstanding. The sum of issued points and outstanding reserves equals the committed award budgets.

Definition-aware statement and exact artifact commitments guard against repeat payments. Cancellation does not erase the earlier outcome: fresh claims for the same content cannot improve its accepted merit bands, and known rejection blocks a fresh judgment. A same-claim, upheld factual appeal can correct that claim's rejection. An unresolved judgment remains fenced even after cancellation; changing accounts cannot create another draw. A stale registration that never began judgment can be submitted again. Explicit legacy exclusions retain their historical statement/proposition hashes. Semantic review draws on recent credited work and explicit related records, dependencies, and historical ledger references. The review has bounded coverage. V5 ends its application correction window at settlement.

## Hosting and operation

Static Pages plus public native reads provide the dashboard. Actions supplies the asynchronous worker; the IC is authoritative storage, while the evidence branch is a rebuildable audit cache and durable transaction journal. A future indexer can improve retrieval and latency without deciding rewards.

`render-open-workflows.mjs PROBLEM_DIR PROTOCOL_SHA` creates literal reviewed worker pins. The problem descriptor and workflow must agree. `manage-open.mjs deploy CONFIG JOURNAL` previews the exact configuration. `--send` uses a dedicated local deployment signer. The protected main workflow receives environment-scoped verifier and executor keys. The Lean subprocess and networkless Docker container receive no keys. Verification and signing currently share the trusted runner VM. A separate secret-free verification job is deferred.

Admission verifies that the PR author is an ordinary GitHub user and meets the configured account age at the original signed comment. The pilot defaults to 30 days and the configuration is pinned in the deployment and native ledger. Age evidence comes from the matched public GitHub profile. The signing wallet remains the points recipient.

Native admission allows one active initial claim per GitHub author and three successful registrations in a rolling 24-hour period measured on the contract. Crediting, rejecting or expiring a claim releases the active slot. Its registration still counts against the 24-hour quota. A checker rejection before registration consumes no native slot.

The public pilot uses five-minute application windows plus native finality. A challenged record needs independent consensus on whether the supplied evidence warrants a correction. An unupheld challenge preserves the previous decision. An upheld challenge can lower accepted initial bands or impact allocations. An initially rejected contribution can be accepted after an upheld factual correction. Failed or uncertain broadcasts stay in the exact-call journal for reconciliation. The required checks are `open-mathematics/evidence` and `open-mathematics/finalized`, bound to the configured publisher app.

Earlier contracts are immutable separate historical ledgers. Old balances remain accessible and are never added into the v5 totals. Cross-ledger dependency rewards, comprehensive authorship disputes, Sybil resistance, production dispute periods and high-volume indexing are further work.

[First-pass review and release checks](OPEN-RESEARCH-REVIEW.md)
