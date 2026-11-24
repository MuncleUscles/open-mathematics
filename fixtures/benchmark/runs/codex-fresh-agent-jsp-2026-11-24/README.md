# Recorded JSP-000007 centralized baseline

This package preserves one actual first-answer baseline recorded on
2026-11-24. Publication did not run another evaluator or alter the answer.

- [Exact prepared prompt](benchmark-jsp-prompt.txt), SHA-256
  `08b5fb3a092e633d1a7f47d7426004840d55cc17ab027c3fd158d6cddb0cb845`.
- [Raw first answer](benchmark-jsp-output.json): `insufficient_evidence`.
- [Original start metadata](benchmark-jsp-start.json) and
  [completion observation](benchmark-jsp-completion.json), copied byte-for-byte.
- [Publication audit manifest](audit.json), binding those bytes to the
  [measurement](../../measurements.json) and [report](../../report.json).

The orchestrating session reports that `documentary_baseline` was created with
no inherited parent conversation, read only this exact frozen prompt, and
returned the preserved first answer. The input excludes organizer responses and
historical labels. Those execution and context-isolation statements are recorded
observations; the offline reporter does not independently verify them.

The provider is recorded as OpenAI. The exact model identifier and revision were
not exposed. `Codex session model` is a description, and `not-exposed` is an
explicit unknown value, not a reproducible model revision. No temperature or
other hidden model parameters are inferred. Cost and latency are null. The start
and observation timestamps include orchestration and observation time, so their
difference is not reported as inference latency.

The response meets the frozen output schema. Four milestones match predeclared
documentary records; one additional announcement milestone is unmatched by the
predeclared list and needs review. The report does not classify that unmatched
item as false. Its disagreement with the historical organizer assessment is
reported separately from correctness. Source-reference membership checks do not
prove that an explanation is supported.

There is one completed baseline and 17 unrun case/arm cells, with no paired
GenLayer result, expert ground truth, panel consensus, or mathematical accuracy
estimate. No proof was reproduced, prize entitlement determined, mathematical
discovery established, native judgment submitted, or points awarded by this run.
