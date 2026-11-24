# Bounded judging benchmark

This offline pilot prepares fixed inputs and reports recorded measurements. It
does not call a model, send a native transaction, reroll a judgment, award points,
or claim that consensus makes a mathematical conclusion correct.

## Current evidence and status

`fixtures/benchmark/manifest.json` commits to bounded documentary snapshots,
exact reconstructed federation prompts, their provenance, and native receipt captures.
GitHub captures are tool-returned UTF-8 text with a trailing newline: their hashes
bind those local bytes, not raw HTTP wire bytes. Issue and PR records are dated
snapshots of mutable records. Repository files and commits identify immutable
revisions. Bibliographic excerpts explicitly identify their derived capture.

The JSP-000007 documentary case is ready for evaluation. The issue claim is
projected without labels, state, closure time or comments. Organizers' responses
remain in a separate historical source and never enter the prepared prompt.
The task distinguishes formalization, publication, verification and adaptation;
it does not establish who originally discovered the Poincaré theorem or determine
prize entitlement. Publication/verification dates are documentary facts, not a
reproduction of either proof. The announcement's calendar wording is preserved
without an invented reconciliation.

P vs NP PR21 and PR22 have historical outcome summaries: rejection with zero
points and acceptance of a nonformal note with 300 points, respectively. Their
exact original judging prompts and complete pre-verdict context have not been
reconstructed here. They therefore have no paired baseline result. A historical
native outcome is not an independent expert label or a fresh benchmark run.

Federation A and B now have exact reconstructed initial contract prompts and
paired first-answer centralized/native judgments. The [committed measurements](../fixtures/benchmark/measurements.json)
and [published report](../fixtures/benchmark/report.json) contain five valid
completed cells and 13 `not_run` cells. Both paired comparisons agree on
acceptance and all three merit bands: A rejects with 0/0/0; B accepts with 1/1/1.
These are two observations of judgment agreement, not mathematical accuracy,
expert agreement, model superiority, or evidence of general reliability.
Federation C and the historical PR21/22 comparisons remain unrun.

The A/B native measurements cover the finalized round-zero `adjudicate`
transactions. They do not claim completion of protected merge, credit payment,
attribution settlement, or the full contribution workflow. B's readback in the
capture is `approved`; its 300-point value is the result budget returned by
adjudication, not proof of a 300-point transfer. The report compares judgment
outputs and strips the contract-added `award` field from the six-field outcome.

Each centralized baseline used a fresh Codex agent without inherited parent-chat
context, received only its frozen prompt, and preserved its first answer.
Exact model identifiers and revisions were not exposed: `Codex session model`
is a display description and `not-exposed` records that limitation. Cost and
latency remain null; start or observation times are not inference latency.
No centralized panel or independent expert ground truth has been supplied.
The reporter cannot independently prove execution or isolation of these agents.

The original JSP-000007 baseline returned `insufficient_evidence`. Its
[raw prompt, first answer, metadata and audit](../fixtures/benchmark/runs/codex-fresh-agent-jsp-2026-11-24/README.md)
remain byte-for-byte unchanged. The original manifest, one-run measurements,
and one-completed/17-unrun report are preserved under that run's
`original-edition/` directory. The old audit's root `measurements.json` and
`report.json` commitments refer to those preserved edition files, while the
root benchmark files now describe the expanded edition. The original manifest
hash is checked against `original-edition/manifest.json`, not rewritten to imply
that the first JSP run saw later federation evidence.

Four reported milestones match the four predeclared records. One additional
announcement milestone is unmatched by that list and remains for review; the
expected list was not expanded after seeing the answer. Historical organizer
agreement is false, which is disagreement with a historical decision, not a
finding of mathematical inaccuracy. The frozen inputs and rubric are unchanged.

## Commands

Run from the protocol repository:

```sh
node scripts/judging-benchmark.mjs prepare --out /private/tmp/pnp-judging-inputs.json
node scripts/judging-benchmark.mjs report --measurements fixtures/benchmark/measurements.json --out /private/tmp/pnp-judging-report.json
node scripts/judging-benchmark.mjs report --measurements /absolute/path/measurements.json
node --test tests/judging-benchmark.test.mjs
```

Omitting `--out` prints JSON. Output files are created exclusively; an existing
artifact is never silently replaced. `--fixtures` selects another reviewed
fixture directory. Source hashes, sizes, paths and roles are checked before
preparation or reporting. Limits are 16 cases, 32 sources, 256 KiB per source,
2 MiB total source bytes, 192 KiB per prompt and 48 recorded case/arm attempts.
Reports without `--measurements` remain preparation-only with zero imported
attempts; use the explicit committed measurement path above to reproduce the
published result. No command here runs a model or repeats the recorded judgment.

Give an evaluator only the selected prepared case's `prompt`. Keep the manifest,
historical sources and reports out of its context. In particular, do not give a
baseline the native verdict, awarded points, acceptance labels, organizer
response, final repository state, or a post-verdict synopsis. An archived exact
prompt can legitimately contain earlier challenge decisions; retain exactly
what the original adjudication saw and document that scope.

## Fixed comparison

Arms are `centralized_single`, `centralized_panel` and `genlayer`. A centralized
panel has at least two declared model revisions and the predeclared
`exact-outcome-unanimity-v1` aggregation rule. Its independently produced
acceptance and merit bands, or documentary priority assessment, must agree;
otherwise record `unresolved`. Record every failed/invalid attempt, not only
successful answers. The harness rejects duplicate case/arm attempts, so a
failure cannot be replaced by a favorable retry in one benchmark edition.

The prompt hash binds the evaluator to the frozen input. Declare provider,
model, revision and parameters; if an exact identifier or revision is not exposed,
record that limitation explicitly rather than inventing a pin. Such a run cannot
support a claim about a particular immutable model revision. Unknown
costs/latencies are `null`, not zero.
The offline reporter cannot independently prove that a submitted measurement
was executed or that a panel actually followed its aggregation rule. Preserve
raw evaluator outputs and call metadata separately for audit. Never describe
synthetic test fixtures as measured model or native results.

Imported measurements use this shape (replace every illustrative value with
an actual recorded run; this example is not included as a measurement):

```json
{
  "schema_version": 1,
  "runs": [{
    "run_id": "recorded-run-id",
    "case_id": "jsp-000007",
    "arm": "centralized_single",
    "status": "completed",
    "prompt_sha256": "exact prepared prompt hash",
    "models": [{"provider": "provider", "model": "model", "revision": "revision"}],
    "parameters": {"temperature": 0},
    "elapsed_ms": null,
    "cost_usd": null,
    "outcome": {}
  }]
}
```

`outcome` must follow the prepared documentary schema or the research contract's
six fields: `accept`, `novelty`, `significance`, `reusability`, `reason`, and
`evidence_refs`. Invalid responses remain counted as `invalid_output`. A failed
or unresolved attempt has `outcome: null` and a bounded `failure_reason`.

## Exact federation inputs and receipt checks

The [federation capture](../fixtures/benchmark/captures/federation-2026-11-24/manifest.json)
records every field in each original prompt. Registration JSON was matched
byte-for-byte to native calldata and its hash to the native record. Integer
fields were preserved from that JSON rather than inferred from stringified RPC
views. The deployed contract source matches both original protocol revisions.
Constructor evidence, the complete append-only registration order, distinct
content hashes, and round-zero records establish empty credited prior context,
empty historical references and challenges, and null previous verdict/content
ceiling. No missing context was filled from an outcome.

These are exact reconstructions of the string passed to
`gl.nondet.exec_prompt(prompt, response_format="json")`. They are not raw
provider request captures and do not expose provider system instructions,
runtime wrapping, model revisions, or sampling parameters. The checked-in
`reconstruct.py` evaluates only the deployed contract's prompt-building
expressions; it never calls a model. All pre-verdict provenance and original
baseline outputs have byte/hash commitments in `capture-artifacts.json`.

Each native capture contains the SDK-normalized receipt and exact journal intent,
transaction hash, contract, policy, round, original registration JSON, readback,
and immutable GitHub report blob reference. Original receipt representations,
including ABI return bytes and idle/error validator telemetry, are retained.
They are not raw HTTP wire captures. Source hashes identify the existing
receipt checker revision used for collection.

Collection independently called the existing `journaledTransaction` checker
against Studio in recovery-only mode with a read-only client. Reporting calls
that same checker offline against the frozen receipt, then decodes the leader
and agreeing validator returns, checks the exact pre-award nondeterministic
result and native record verdict, and normalizes only bounded numeric fields.
A self-authored `verification` label without a valid raw capture is rejected.
The report does not query fresh chain state or submit another judgment.

The contract enforces independently obtained validator agreement on the outcome
bands. Validator returned values preserve the leader's accepted result; they are
not separately captured model explanations. Duplicate/idle entries do not
establish additional independent judges. Native model identities, inference
latency, and dollar cost are not established by these captures.

New federation cases without complete context or verified judgment receipts
remain pending. Exact raw prompts are input sources; native outcomes and all
post-verdict capture metadata have role `measurement` and cannot enter prepared
evaluator inputs. A pair is scored only when both arms have valid outcomes for
the same prompt. Full protocol completion is tracked separately.

## Interpretation

Documentary metrics check exact source-reference membership, recorded milestone
matches, and unsupported claims of reproduced verification, mathematical
discovery or final award confirmation. Reference membership alone does not prove
that an explanation is supported. An unmatched milestone needs review; it is
not automatically false. Agreement with organizers is separate from these
checks and is never labeled accuracy. A defensible insufficient-evidence answer
is valid.

There is no independent expert ground truth in this fixture. Accuracy, false
acceptance and false rejection remain null. Small-sample historical agreement
cannot establish superiority, neutrality, censorship resistance or general
robustness. Source admission, evidence selection, model correlations, policy
control and repository administration remain separate governance questions.

## GitHub collection boundary

`github/github-provenance.mjs` accepts public GitHub files newly added by a
merged PR. Modified/renamed files and bot submitters are excluded from this pilot.
Complete PR listings are limited to 500 changed files in pages of ten, with at
most 64 requests under one 30-second deadline. The 512 KiB JSON-response and
256 KiB source/license-file limits still apply. Large or incomplete responses
fail closed; finding the selected source never skips the remaining file pages.
A later source revision must descend from the PR's merge and preserve the same
head/merge/source blob. The exact changed-file record and patch, PR metadata,
source bytes, and commit-pinned license bytes are retained outside the native
evidence. SHA1 verifies Git blob objects; SHA256 binds their content.

The supplied statement must be a literal contiguous source excerpt containing
the exact theorem token. This is documentary binding, not a Lean parser or
semantic verification. The PR submitter ID establishes neither original
mathematical authorship nor a wallet. SPDX metadata does not prove discovery or
complete reuse permission; the preserved license and any applicable notices
still need review. No CI status is used as mathematical verification.

The [Anthropic collection fixture](../fixtures/federation/anthropic/README.md)
records an actual read-only collection from the 333-file `formal-math` PR #51.
Its project NOTICE is retained separately; the collector does not discover all
applicable notices. This is source-collection evidence, not a new benchmark
measurement, a full VP–VNP verification, or a native contribution outcome.
