# Reviewed preparation for a next research phase

These proposals are undeployed. The authoritative Studio v3 ledger remains at `0x6acF1e29790B2eE45c01184fFaa8F84f06ba9AAc`, with 800 total points. They add no accepted contribution, point allocation, active goal or migration path.

- [Replacement design and audit](v4/README.md): a prospective expiry guard, its direct-VM regressions, historical accounting diagnostics, and Fable's independent migration review with dispositions. The existing v2 importer cannot preserve the v3 state. The diagnostic always reports `readyForMigration: false`.
- [Disjoint-CNF goal proposal](disjoint-cnf/PROPOSAL.md): a precise known SAT result with an openly attributed reference proof, counterexamples and portable local Lean verification. Both existing goals were finalized as closed in the dated availability query. A separate reviewed verifier/policy release and deployment are required before this goal can accept proof submissions.

Validation on the isolated draft: 47 direct-VM tests (including the 4 prospective guard cases), 17 snapshot-audit tests, and 5 real Lean 4.19.0 proposal regressions pass. The temporary patched contract passed GenVM validation with 31 public methods. These are local checks; there was no native replacement deployment, importer execution, production proof-gate enrollment or full end-to-end trial for the proposal.

The active contract source, policy, deployment metadata, worker and workflows are byte-identical to base `eecacad0cb9ba8034040d9b7a9c92543dcbadcc0`. The v3 worker still refuses automatic case expiry. Review the limits in each proposal before treating any local success as evidence of production readiness.
