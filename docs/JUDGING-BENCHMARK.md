# Bounded judging benchmark

This offline pilot prepares fixed inputs and reports recorded measurements. It
does not call a model, send a native transaction, reroll a judgment, award points,
or claim that consensus makes a mathematical conclusion correct.

## Current evidence and status

`fixtures/benchmark/manifest.json` commits to seven bounded source snapshots.
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

Federation A, B and C are explicit placeholders pending exact inputs and final
receipts. The committed measurement list is empty. All 18 case/arm cells are
`not_run`, and no accuracy or false acceptance/rejection rate is reported.

## Commands

Run from the protocol repository:

```sh
node scripts/judging-benchmark.mjs prepare --out /private/tmp/pnp-judging-inputs.json
node scripts/judging-benchmark.mjs report --out /private/tmp/pnp-judging-report.json
node scripts/judging-benchmark.mjs report --measurements /absolute/path/measurements.json
node --test tests/judging-benchmark.test.mjs
```

Omitting `--out` prints JSON. Output files are created exclusively; an existing
artifact is never silently replaced. `--fixtures` selects another reviewed
fixture directory. Source hashes, sizes, paths and roles are checked before
preparation or reporting. Limits are 16 cases, 32 sources, 256 KiB per source,
2 MiB total source bytes, 192 KiB per prompt and 48 recorded case/arm attempts.

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
model, revision and parameters; unknown costs/latencies are `null`, not zero.
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

## Adding an exact federation case

Archive the full original prompt as an `exact_prompt` source with role `input`,
bytes and SHA256. Mark the case `ready`, set its `prompt_source_id`, include that
source in `input_source_ids`, and preserve the exact `allowed_refs`. Archive all
supporting pre-verdict evidence as separately hashed sources. Do not reconstruct
missing prior context from a subsequent verdict or use today's policy in place
of the original pinned policy. New results that lack a complete archive remain
`pending_fixture`.

Native receipt verification belongs to the existing trusted receipt checker.
After that separate check, freeze a `normalized_native_receipt` source with role
`measurement` and set the case's `native_receipt_source_id`. Its JSON contains
`verification: "independently-finalized-receipt"`, `status`, `prompt_sha256` and
the normalized six-field `outcome` (or null for failure). Preserve exact raw
receipts, transaction hashes, contract/policy/round identities and the checker
revision alongside it. The run supplies the matching `receipt_source_id`.

This harness checks the normalized source commitment and outcome correspondence;
it does not independently verify chain finality or turn a self-authored status
label into evidence. A report states this boundary explicitly. A pair is scored
only when both arms have valid outcomes for the same prompt.

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
