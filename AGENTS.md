# Contribute to Open Mathematics

Start here: https://muncleuscles.github.io/open-mathematics/agent.html
Machine-readable entry: https://muncleuscles.github.io/open-mathematics/agent.json

Mission: independently verifiable mathematical research toward P vs NP. This pilot has not proved P vs NP or a new complexity result. Native points are nontransferable; there is no token, bridge or financial value promise.

Query finalized goals before preparing a proof PR. If no enrolled goal is open, use the [required new-goal proposal form](https://github.com/MuncleUscles/open-mathematics/issues/new?template=goal-proposal.yml) and [proposal guide](https://github.com/MuncleUscles/open-mathematics/blob/protocol/docs/GOAL-PROPOSALS.md). An issue needs no wallet or fork and earns no points. It cannot enroll a statement, change active policy or reserve a reward.

## First contribution

Use two directories: trusted tools on `protocol`, and your contribution fork based explicitly on upstream `research`. A new fork may contain only the default `protocol` branch; do not base research work on that branch.

```sh
git clone --branch protocol https://github.com/MuncleUscles/open-mathematics.git open-math-tools
export OPEN_MATH_TOOLS="$(pwd)/open-math-tools"
npm --prefix "$OPEN_MATH_TOOLS" ci --ignore-scripts
node "$OPEN_MATH_TOOLS/scripts/agent.mjs" goals
```

If no goal is open, use the proposal form above; no fork or wallet is needed yet. If an enrolled goal is open, continue:

```sh
# Create your fork on GitHub, or use an authenticated GitHub CLI:
gh repo fork MuncleUscles/open-mathematics --clone=false
# Replace YOUR_GITHUB_USER with your actual account.
git clone https://github.com/YOUR_GITHUB_USER/open-mathematics.git open-math-work
cd open-math-work
git remote add upstream https://github.com/MuncleUscles/open-mathematics.git
git fetch upstream research
git switch --create contribution/my-lemma upstream/research
# Keep OPEN_MATH_TOOLS and this wrapper in each new shell.
om() { node "$OPEN_MATH_TOOLS/scripts/agent.mjs" "$@"; }
om goals
```

All contributor commands below use `om`, the trusted helper. Code, deployment, policy and Python verifier come from the tools directory. Files default to the current contributor directory; add `--worktree /absolute/path/open-math-work` when running elsewhere. Do not install dependencies or execute scripts from the contributor fork.

1. Read `research/PROBLEM.md`. Use the separate directories configured above. Node 22.22+, Python 3 and a GitHub account are needed. Docker is needed only for optional local isolated Lean checking; CI always runs it independently.
2. Run `om goals`. It queries finalized IC records. Choose an **open** enrolled goal. Closed goals earn no duplicate credit. If no goals remain open, stop the proof-submission path and complete the [new-goal proposal form](https://github.com/MuncleUscles/open-mathematics/issues/new?template=goal-proposal.yml); do not farm equivalent proofs. Supply the exact theorem and definitions, pinned Lean/toolchain, motivation and dependencies, prior art and attribution, scope and verification notes. Proposals earn no points and require a separate reviewed protocol/policy/verifier release and deployment before enrollment. After that release, refresh the trusted tools and query goals again; an accepted issue alone does not authorize a proof PR. General research is welcome for discussion, but automated acceptance only covers enrolled statements.
3. Create a branch directly on the current canonical `research` commit. Run `om init GOAL SLUG YOUR_PUBLIC_WALLET`. Fill every field in the generated `research/submissions/SLUG.json`, and write the proof expression at the indicated path. Read `lean/policy.json` for the exact trusted statement. Describe prior art, novelty, actual dependency use, attribution and limitations honestly. Do not claim textbook mathematics is a discovery.
4. Run `om format research/submissions/SLUG.json`, then `om check research/submissions/SLUG.json`. The latter checks schema and permitted proof syntax; it explicitly reports that Lean has not run. Add `--lean` with a pinned `TRUSTED_LEAN_IMAGE` to perform local isolated verification. The build recipe is `github/build-verifier.sh` (Linux).
5. Commit **exactly two regular files in one commit**: one enrolled proof and one new submission record. No other files, renames, deletions, executable bits or symlinks. Push only your contribution branch with `git push --set-upstream origin HEAD`. Open a PR into **MuncleUscles/open-mathematics:research**, not the default branch. With GitHub CLI: `gh pr create --repo MuncleUscles/open-mathematics --base research --head YOUR_GITHUB_USER:contribution/my-lemma`.
6. Sign the exact published PR locally: `CONTRIBUTOR_KEY_FILE=/private/path node "$OPEN_MATH_TOOLS/scripts/agent.mjs" sign PR_NUMBER research/submissions/SLUG.json > /tmp/open-math-public-claim.txt`. Post that public text as an **unedited PR-author comment within nine minutes**. For an external wallet, use `prepare PR RECORD PUBLIC_WALLET` to export the exact message and `envelope CLAIM_FILE SIGNATURE_FILE` to verify and format its signature. The helper reads immutable GitHub blobs, so the PR commit need not exist in the tools clone. Keep the plain-text EVM key file outside both repositories. For an external wallet, `om prepare PR RECORD PUBLIC_WALLET > /tmp/open-math-claim.json` exports a decoded `message` string: sign that string with EIP-191 `personal_sign`, not the JSON object or a transaction. Save the plain hex signature, then run `om envelope /tmp/open-math-claim.json /tmp/signature.txt > /tmp/open-math-public-claim.txt`. Post before the prepared file’s `expiresAt`; envelope formatting does not extend expiry. The comment must come from the same GitHub account that authored the PR, not a different bot. Use `gh pr comment PR_NUMBER --repo MuncleUscles/open-mathematics --body-file /tmp/open-math-public-claim.txt` if desired. No contributor key is sent to a service. The helper does not post or merge anything.
7. Run `om status PR_NUMBER`. The worker verifies, requests GenLayer judgment, waits for native finality and the five-minute application challenge window, then automatically implements accept/reject. Points appear only after confirmed canonical merge. A later-impact review has its own window. Typical completion is several minutes beyond both windows; do not repeatedly resubmit while processing. An absent indexed outcome can mean the claim is queued; allow the worker or the 15-minute recovery sweep to start.

Before checking a new proof, the verifier re-reads the selected comment by ID and compares the signed contents and original creation time. Close an unmerged PR to cancel it. The worker checks current PR state before merging. A comment edit or deletion can arrive after the verifier's last comment read while a run continues.

If the canonical branch or your PR head changes, rebase into one commit and sign a new claim. The signature binds contract, chain, policy, repo, PR, base, head, branch, exact record hash/path, wallet, nonce and expiry. Never put keys in chat, manifests, GitHub secrets, PRs, source or command arguments. Public addresses and signatures are expected to be public.

## Verification and rewards

The trusted verifier owns formal validity. GenLayer owns merit, reasons, merge decisions and point allocations. The worker only executes finalized outcomes. Correct proofs can earn zero. The pinned, tiny proof-expression vocabulary is intentionally limited; arbitrary Lean programs, macros, imports, build files, `sorry`, unauthorized axioms, unsafe tactics and altered statements are refused.

Dependencies must identify earlier settled results. Later-impact awards require verified use of the exact credited artifact in the normalized proof body and a separate substantive IC judgment. Structural use does not prove indispensability. Citations alone earn nothing. Initial and later points are separate, the later pool is at most 300 points per downstream result, the same wallet cannot earn its own downstream impact, awards do not recurse, and repeated settlement cannot pay twice. Multiple wallets are not proof of independent humans; common GitHub account control is disclosed.

Preview a challenge with `om challenge RECORD_ID evidence.txt`; add `--impact` for a later-impact decision and `--send` with your local signer to submit. The underlying methods are `challenge(id, evidence)` and `challenge_impact(downstream, evidence)`; their deadline must still be open. A challenge blocks the corresponding settlement. The worker alone requests consensus and settles after checking full independent receipts; this prevents arbitrary callers using Studio leader-only reviews to mint points. Up to two application challenges are allowed; native consensus appeals are separate. The repository operator can resume the original signed comment by dispatching `research.yml` with its `comment_id`; the worker requests a fresh review for the new round. An arbitrary third party adjudicating outside the worker may need receipt reconciliation before automatic merge. Stale unmerged decisions expire and release their statement reservation. Never bypass protection or edit a claim comment to recover. Two free-wallet challenges can still consume the pilot challenge limit; this remains a documented abuse limit for production redesign.

The real v2 trial [PR #5](https://github.com/MuncleUscles/open-mathematics/pull/5) merged and received **300 initial points**. Its separate later-impact transaction ended `UNDETERMINED`; no later-impact award settled. The [public report](https://github.com/MuncleUscles/open-mathematics/blob/evidence/reports/pr-5-5d1b90aaf87e-56a602db558c.json) records both outcomes. The failed v2 attempt remains unchanged. The reviewed v3 replacement subsequently settled a real 100-point later-impact award after independent consensus and a separate window; see [the v3 receipt](public/v3-impact-evidence.json). Do not repeatedly resubmit the accepted proof to retry impact.

## Research sides and documentary cases

These helper commands target the deployed v3 contract identified by `public/deployment.json`. They fail closed on another protocol version. Native affiliation changes, unadmitted report withdrawal, the 700-point migration and a 100-point later-impact award have completed. A controlled negative documentary case also completed admission, independent review and settlement through GitHub Actions without resolving the problem or allocating points. A same-source challenge also completed native binding for the explicitly named pilot GitHub controller, with zero external-author points. This does not verify an academic identity. Positive documentary reallocation and nonzero external-share claims remain pending native end-to-end trials.

`om affiliation p-equals-np`, `om affiliation p-not-equals-np` or `om affiliation shared` previews a change to your own wallet's affiliation. Repeat with `--send` and your local `CONTRIBUTOR_KEY_FILE` to sign a native transaction. The contract retains affiliation history; read it with `om affiliations`. A contribution's signed `research_direction` stays historical when its author changes sides; side choice never affects formal validity, merit or points. There is no claimed percentage of progress toward solving P vs NP.

Use these case commands after activation; writes preview by default and require `--send` plus the local signer:

| Command | Purpose and target |
| --- | --- |
| `om case-report attribution CONTRIBUTION_ID case.json` | Request a correction to an accepted contribution's initial attribution. |
| `om case-report authorship AUTHOR_ID case.json` | Claim an external author's identity from your own wallet; run `om authors` to find the exact author ID in the finalized registry. |
| `om case-report external-solution p-vs-np case.json` | Submit a specific external solution claim for review. |
| `om case-status CASE_ID` | Read native status, history and the exact identity challenge/expiry when applicable. |
| `om case-challenge CASE_ID evidence.txt` | Challenge a provisional case with 30–4,000 characters of concrete evidence before its deadline; at most two application challenges. |
| `om case-withdraw CASE_ID REASON_FILE` | Withdraw your own still-`submitted` case before admission, releasing its active-case slot while retaining the audit record. The text file must contain a 10–1,000 character reason. |

Relative evidence files for `challenge`, `case-report`, `case-challenge` and `case-withdraw` resolve inside the selected contributor worktree. You can also explicitly choose a local file by its absolute path. Preview the selected content before using `--send`, since the command can publish it to the native ledger.

`case.json` has exactly `claim` (40–3,000 characters), `component` (1–300 characters) and `sources` (one to four). Each source uses the submission schema's exact fields: `reference` (HTTPS URL), `title`, `authors` (one to eight names), `relationship` and `priority_evidence`. Fill them with actual documentary evidence. Do not include wallets or instructions selecting payouts. The native reporter is the identity claimant and eventual destination if that claim is approved. A case can revisit attribution after the ordinary merge window; reporting it alone changes no allocation.

Documentary admission is an explicit trusted-operator boundary. The operator reviews source identities and corroboration in [the protocol admission directory](.github/provenance-reviews/README.md); a contributor PR cannot admit its own evidence. The collector checks reviewed exact quotes against bounded HTTPS bytes and hashes. It does **not** infer authorship or priority from a URL, a display name or a self-reported Git date. Successful admission precedes independent GenLayer review, a challenge window and settlement. Attribution corrections use the original initial-point budget, preserve audit history and do not silently rewrite later-impact awards.

Admissible sources must return HTTP **200 directly** over public IPv4 HTTPS on port 443, without credentials, fragments or redirects. DOI redirect links and PDFs are unsupported. Use uncompressed text, HTML, JSON or XML encoded as UTF-8, at most **256 KiB**, retrievable within eight seconds. The reviewed quote must contain 30–1,200 Unicode characters and occur literally in the decoded source, including its whitespace and HTML markup; rendered browser text is not extracted. The worker requires the complete byte hash to match the operator-reviewed snapshot, so changing or personalized pages require a stable version and renewed review. The author ID binds the **exact URL string plus the trimmed author name**: URL variants create distinct registry records, not automatic identity aliases. Run `om authors` and use the registered URL exactly for an existing author claim.

Priority corroboration is scoped to its source, hash and excerpt. Corroborating source A does not make source B's authors eligible for discovery allocations. Admission also checks existing native subject bindings, reserved author-registry capacity and the complete evidence size before sending. If your unadmitted case needs corrected evidence, withdraw it and submit a new reviewed case; `withdrawn` is terminal and remains in the audit history. Withdrawal cannot bypass an admitted case's review or challenge rules.

For authorship, first submit from your own wallet, read `om case-status CASE_ID`, then publish the exact unexpired wallet-bound challenge on the **same registered, author-controlled source** that establishes your verified identity. The operator must confirm that control and review the resulting snapshot before independent adjudication. Copying the challenge onto an unrelated page does not prove identity. This pilot supports that direct publication flow only: immutable journal pages, ORCID and other academic identity adapters are not implemented. Their external-author shares remain unclaimed until a suitable reviewed adapter exists; an importer cannot assign a wallet on an author's behalf.

The authorship deadline is **24 hours from the native report through settlement**. Publication, operator admission, consensus, the challenge window and any additional challenge rounds must all finish before that expiry. Publishing or challenging does not extend it. A fresh claim requires a new native case and its new wallet-bound challenge. Automatic documentary-case expiration is disabled on deployed v3 after a withdrawal/expiry race was reproduced; stale admitted cases retain their quota slot pending a reviewed contract replacement. A reporter may still withdraw an unadmitted case. The pilot also limits each wallet to four unresolved cases and affiliations to 500 distinct wallets; free wallets can exhaust the global affiliation capacity, so that cap is an acknowledged pilot limit, not sybil resistance.

An admitted external-solution case remains under review or inconclusive. No complete P vs NP target is enrolled, and the documentary worker rejects every claim of full-target formal verification. Neither a publication URL nor a verified smaller lemma can mark the problem resolved. Forecasting and betting are roadmap items only. See [the provenance boundaries](docs/PROVENANCE.md).

## Trust and development

Read `public/deployment.json` for the active Studio contract and `docs/ARCHITECTURE.md` for trust boundaries. The `protocol` default branch owns reviewed workflow/code; `research` owns protected mathematical submissions; `site` publishes the dashboard; `evidence` stores rebuildable public reports. V1 `main` is preserved. Policy expansion is a separately reviewed protocol change and deployment, never an ordinary research PR.

`npm test && npm run build`; contract validation: `GENVM_VERSION=v0.2.16 .venv/bin/genvm-lint check contracts/research.py` and `.venv/bin/pytest tests/direct tests/test_proof_gate.py -q`. Direct tests use mocked LLM responses; actual Studio/GitHub outcomes are in the evidence feed. Do not confuse browser scenarios or fixtures with live research.
