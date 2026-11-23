> Historical design context. The current open-ended v5 flow is documented in [OPEN-RESEARCH.md](OPEN-RESEARCH.md); the fresh federation extension is in [RESEARCH-FEDERATION.md](RESEARCH-FEDERATION.md). Enrolled-task and v3 deployment descriptions below are not the current admission rules.

# Propose the next trusted statement

Run `node "$OPEN_MATH_TOOLS/scripts/agent.mjs" goals` from the trusted tools checkout before starting a proof submission. It reads finalized native availability. The pilot's first two statements are already credited; the checked-in list of statements does not make them open again.

When no enrolled goal is open, use the [required goal proposal form](https://github.com/MuncleUscles/open-mathematics/issues/new?template=goal-proposal.yml). A GitHub account is enough to propose a statement; no contributor wallet, signed PR claim or fork is required for the issue. Search existing proposals first and add evidence to the relevant discussion instead of duplicating it.

Every proposal must contain:

- The goals query time, active contract/policy and returned availability, plus related proposals.
- An exact Lean theorem type, quantified variables, assumptions and definitions with their mathematical meaning. Immutable definition sources must identify commits and declarations.
- The exact Lean toolchain, imports and pinned library revisions, or an explicit statement that no external library is needed. Current enrollment uses Lean 4.19.0; a different toolchain or Mathlib dependency requires separate review.
- A concrete motivation, earlier contribution/artifact dependencies and how the statement could be useful.
- Actual prior art, named authors and the proposed contribution's relationship to their work. Established mathematics is welcome when its formalization or integration is useful; do not invent novelty.
- Scope limits, edge cases, counterexamples and an explanation of what the theorem would not establish.
- Verification notes covering the pinned statement, definition semantics, exact elaborated type, permitted axioms, negative checks and isolation. Label tests as actually run or merely proposed.

The GitHub form requires these answers in the web interface. An issue is still untrusted discussion, including if created or edited through an API. Required fields and checkboxes do not verify mathematical correctness, source attribution or security.

## How a proposal can become an enrolled goal

Maintainers first review the mathematical specification, prior art and relevance. If they choose to pursue it, the trusted definitions, verifier, dependency pins and evidence policy need a separate protocol review and suitable checks. Any required release and deployment must complete before the goal is available. A reviewer comment, issue closure or attached proof does not perform that activation.

After activation, refresh the trusted tools, run `goals` again and proceed only when the exact intended goal is enrolled and open. The existing contribution path remains unchanged: one enrolled proof plus its structured record, an exact-commit wallet claim, independent Lean verification, GenLayer merit review, challenges and protected merge.

Proposing a statement earns **no points**, reserves no reward and carries no promise of a later allocation. An eventual accepted proof is judged under the then-active protocol; proposing its goal does not entitle the proposer to that proof's credit. Never submit closed-goal duplicates, edit `lean/policy.json` through a research PR, nominate payout wallets or self-score work. The issue cannot change active policy or resolve P vs NP.
