# Prospective replacement: expiry guard and state audit

Start with [the migration design](MIGRATION.md) and [Fable's independent review](FABLE-REVIEW.md). The design records which findings are addressed and which remain activation requirements. Nothing here deploys a replacement or changes the authoritative v3 ledger.

The guard treats an already withdrawn case as terminal when a delayed executor expiry arrives. It preserves the withdrawal history and the reporter's active-case count. A genuinely stale active case can still expire and release its slot exactly once.

Run the in-memory regressions from the repository root using the existing GenLayer test environment.

```sh
PYTHONPATH="$PWD/tests/direct" "${PYTEST_BIN:-.venv/bin/pytest}" -q proposals/v4/tests
node --test proposals/v4/tests/*.test.mjs
node proposals/v4/audit-snapshot.mjs
```

Set `PYTEST_BIN` to the existing environment's pytest executable if it lives outside this checkout. The tests copy the current contract into a temporary directory, apply the one-line patch there and deploy only to the direct VM.

This proposal is based on `eecacad0cb9ba8034040d9b7a9c92543dcbadcc0`. Deploying a replacement requires a reviewed migration of the full v3 state and history. The existing migration covers the v2 ledger. Until a replacement is verified, the v3 worker keeps automatic case expiry disabled.

The audit uses the checked-in display snapshot and always reports `readyForMigration: false`, even when its internal consistency checks pass. It makes no RPC calls and cannot establish completeness, a single cutoff, authenticity or authorization. The related [disjoint-CNF proposal](../disjoint-cnf/PROPOSAL.md) is a locally checked known result, not an enrolled goal or rewarded contribution.

The separate [bounded native diagnostic](CAPTURE.md) retains raw ABI and tagged values while explicitly refusing migration readiness. Its actual native trial failed on history before any state views or remote source verification; the preserved failure and later bounded HTTP probe are linked in that document. Do not treat it as a completed native export or rerun it just to obtain a successful result.
