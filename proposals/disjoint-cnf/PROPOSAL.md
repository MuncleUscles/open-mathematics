# Proposed next goal: compose independent CNF components

Recommend `disjoint_sat`: **two CNFs with disjoint variable sets can be combined without introducing a satisfiability conflict**. This is known SAT infrastructure, useful for verified component decomposition and for composing independently built gadgets after a separately verified variable-freshening step. It is not a complexity result, a new SAT algorithm, or a claimed advance toward deciding P vs NP.

This is a local proposal and feasibility reference, not an enrolled goal or a research submission. This review bundle changes no active policy, contract or reward. A finalized helper query completed at 03:46:13 UTC on 2026-11-23 against `0x6acF1e29790B2eE45c01184fFaa8F84f06ba9AAc` on chain 61999: both `renaming` and `renaming_sat` were closed under policy `9e8e13a652604f4cf3cc334e934301898bd7d888bcd73b26a71744b1b41f2965`. The dated availability record is `goal-availability.json`; query again before any future submission.

## Exact specification

`ProposedStatement.lean` starts with an exact byte-for-byte copy of the reviewed `lean/Trusted.lean`: variables are natural numbers, a literal is `(variable, desired Boolean value)`, a clause is a list interpreted by `any`, and a CNF is a list interpreted by `all`. A literal `(n, true)` requires `a n = true`; `(n, false)` requires `a n = false`. Duplicates are allowed. The existing `Satisfiable` definition from `lean/Downstream.lean` is reproduced unchanged.

The new definitions and exact target are:

```lean
def Satisfiable (f : CNF) : Prop := ∃ a : Nat → Bool, evalCNF a f = true

def cnfVars (f : CNF) : List Nat := f.flatMap (fun c => c.map Prod.fst)
def DisjointCNFVars (f g : CNF) : Prop :=
  ∀ n : Nat, n ∈ cnfVars f → n ∈ cnfVars g → False

def DisjointSAT : Prop := ∀ (f g : CNF), DisjointCNFVars f g →
  (Satisfiable (List.append f g) ↔ Satisfiable f ∧ Satisfiable g)

-- The trusted wrapper would require exactly:
theorem candidate : DisjointSAT := <bounded proof expression>
example : DisjointSAT := candidate
```

`cnfVars` retains duplicates; only membership matters. `List.append` is intentional: directly writing `f ++ g` did not synthesize an `HAppend CNF CNF` instance with the existing non-`abbrev` CNF alias in this exact environment. Avoid changing the pinned foundations merely to make notation convenient.

The statement-source SHA-256 is `443dcc8a8e121910cf6783953b811fa2331686f9066c90c913c67cceb0489083`. This identifies the proposal bytes only; it is not an active policy or registration.

## Computational role and dependencies

The forward direction restricts a satisfying assignment for the concatenation to its two components. The reverse direction combines two witnesses using a decidable finite-membership test:

```lean
fun n => if n ∈ cnfVars f then a n else b n
```

Disjointness ensures that this assignment agrees with `b` on every variable used by `g`; agreement on a component's variables preserves its evaluation. The local proof includes this transport argument as a local helper, not as an assumed axiom or separately credited theorem.

Use the existing CNF definitions and `Satisfiable`, but declare **no credited proof dependency** for this goal. The tested proof does not use `renaming_sound` or `RenamingSAT`; attaching either for points would be artificial. A later, separately specified freshening theorem could map components into disjoint variable namespaces and legitimately combine the renaming results with this result. That later theorem and any polynomial-time construction/cost statement are not proved here.

## Prior art and attribution

Armin Biere and Carsten Sinz, *Decomposing SAT Problems into Connected Components*, Journal on Satisfiability, Boolean Modeling and Computation 2 (2006), 191–198, explicitly describe the satisfiability equivalence between independent components and their conjunction. This proposal formalizes the two-component, disjoint-variable semantic core in this repository's small CNF representation. It does not claim the paper originated the elementary fact or that this is the first formalization. [Author-hosted primary paper](https://cca.informatik.uni-freiburg.de/papers/BiereSinz-JSAT06.pdf).

Appropriate contribution description: known-result formalization/infrastructure integration, with the existing repository definitions and this reference proof disclosed. No discovery credit or reward is presumed. This reference proof is published with the proposal; a later submission must acknowledge it rather than claim its proof expression as independent new work. The paper's PDF is useful prior art for human review; the pilot's documentary byte collector does not admit PDFs, so this citation alone cannot establish a native documentary case or source-authorship claim.

## Local verification actually completed

From the repository root, with Lean 4.19.0 on `PATH`:

```sh
python3 -B proposals/disjoint-cnf/verify-proposal.py
python3 -B proposals/disjoint-cnf/test_verify_proposal.py
```

Alternatively set `LEAN_BIN` to your installed Lean 4.19.0 executable. The scripts resolve the repository from their own location and can run from another working directory. No machine-specific executable path is stored in this bundle.

The verifier uses `LEAN_BIN` when set, otherwise `lean` on `PATH`, and rejects other release versions (including misleading prefixes such as `4.19.01`). It uses Lean **4.19.0**, no Mathlib, no external imports, kernel `--trust=0`, and `-DmaxHeartbeats=100000`. The tested expression is 1,321 bytes. The statement file is 1,287 bytes. The verifier reads the actual `ProposedStatement.lean`, `candidate.proof` and separately reviewed `BoundaryChecks.lean` once, assembles those exact byte buffers with a fixed `candidate : DisjointSAT` wrapper into a temporary Lean file, and hashes the inputs and the executed assembly. It does not read a separately maintained `ReferenceCheck.lean`. Lean exits 0 with no warnings and reports only `propext` and `Quot.sound`, which match the existing policy. No `Classical.choice`, `sorryAx`, native evaluation axiom, or additional axiom appears. Lean's own documentation explains [axiom auditing](https://lean-lang.org/doc/reference/latest/find/?domain=Verso.Genre.Manual.section&name=The-Lean-Language-Reference--Validating-a-Lean-Proof--The-Blue-Double-Check-Marks--Significance).

`BoundaryChecks.lean`, compiled with the actual statement and candidate, verifies:

- An empty CNF is satisfiable; a CNF containing an empty clause is not.
- Opposite unit clauses on the same variable are individually satisfiable but their concatenation is not. Thus deleting the disjointness assumption gives a false universal claim.
- Two same-sign unit clauses can overlap and still be jointly satisfiable. Thus disjointness is sufficient, not necessary for every particular pair.

`evidence.json` records the exact input and assembled-source hashes, repository commit when available, toolchain output, axiom report and checks. Each run removes old success evidence first and writes a new `status: pass` file only after all checks succeed. Treat checked-in evidence as a historical run: rerun after any input change. The five real local regressions cover unrelated working directories, changed false proof despite an old valid `ReferenceCheck.lean`, changed statement, changed boundary checks, and nonexact Lean versions. Failed runs leave no accepted evidence. Checks also run with Python optimization enabled so validation does not depend on removable `assert` statements. The existing assembler rejects the new goal, and its existing syntax filter rejects the new proof expression, as expected. This script executes reviewed local Lean inputs. It is **not a sandbox for untrusted code**, the isolated PR verifier, GenLayer adjudication, a merge, a reward, or enrollment. Only the production isolated gate may admit future research submissions.

## Required reviewed verifier and release work

The code was first inspected at local commit `e1c7764b6f986bfb1b757d2358db4a671790da64`; this bundle is staged only under `proposals/disjoint-cnf` in the isolated replacement draft. `evidence.json` records its checkout commit at verification. The active policy hash at inspection and verification is `9e8e13a652604f4cf3cc334e934301898bd7d888bcd73b26a71744b1b41f2965`.

| Surface | Required adaptation before enrollment |
| --- | --- |
| `lean/policy.json` | Review and pin the exact new definitions file and `candidate : DisjointSAT`; add a new proof path such as `research/proofs/disjoint_sat.proof`, statement hash, and `dependency: null`. Keep old statements and hashes intact. |
| `lean/check.py` | Add an explicit `disjoint_sat` assembly branch; it currently supports only `renaming` and `renaming_sat`. Review a bounded grammar for the local helper, typed binders, finite-membership conditional and named core list lemmas. Do not enable arbitrary declarations, imports, macros, elaborators, comments, strings, `sorry`, axioms or arbitrary tactics just to accept the reference. |
| `scripts/verify_lean.py` | Update its hardcoded trusted-fixture selection for a separately reviewed local fixture. Production must continue using the pinned Docker image, exact toolchain, trusted file hashes, `--trust=0`, warnings/errors rejection, exact candidate type and axiom allowlist. The new goal has no imported proof dependency and must emit no invented dependency-use claim. |
| `src/submission.mjs`, schema/template, agent helper | The current semantic policy name is hardcoded as `cnf-core-v2`. If a revised policy name is chosen, update it consistently rather than publishing metadata that validation rejects. The helper's goal listing currently reports the credited renaming dependency generically; it should not imply this goal depends on that proof. |
| `github/verify-pr.mjs` / dependency resolver | Its dependency path is specifically the old `renaming_sound` statement and artifact. `dependency: null` avoids falsely invoking it for this goal. Do not claim support for arbitrary future dependency graphs; a later goal using `RenamingSAT` needs a separately generalized resolver and proof-use inspection. |
| Policy-bound deployment | The live contract's policy hash is fixed and registration checks it. Publishing a changed policy JSON does not activate it. A separately reviewed release/deployment and preservation of existing state are required before the new goal is available. |

Before activation, add isolated positive and adversarial gate checks for the exact new theorem: wrong theorem/definitions, omitted assumption, forged or unrelated dependencies, proof escaping into commands, unauthorized axioms, oversized input and same-statement duplicate attempts. Check the complete attestation against the contract's 2,000-character formal-statement, 12,000-character proof and 24,000-character evidence bounds; the individual prototype files fit, but a full future claim has not been assembled or tested. Then exercise the signed PR pipeline against the new reviewed deployment. These release checks have **not** been run by this proposal.

## Why this goal first

Renaming composition is a useful small identity but mostly duplicates elementary map composition. Injectivity necessity is a good diagnostic for the renaming assumptions, but its simple counterexample does not yet provide a composition primitive. The proposed disjoint-CNF result supplies a reusable correctness boundary for component-based work with a constructive proof and clear negative cases. Neither this choice nor any small verified lemma measures progress toward resolving P vs NP.
