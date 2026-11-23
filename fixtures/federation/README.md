# Real pequalnp federation proof fixtures

These are real mathematical artifacts from pequalnp, with a new local
compatibility proof and a downstream application. They are **local unpublished
fixtures**, not evidence of GenLayer acceptance, a merged research PR, an
identity claim, or an award. Original mathematical discovery and priority are
not established by the upstream GitHub records.

All three packaged fixtures passed the isolated full verifier and all six
serialized kernel checks. `verification/summary.json` records the exact bundle,
assembly, statement, and report hashes. C's semantic audit confirms direct
proof-body use of B's selected theorem under the explicitly local fixture ID.

## The three cases

| Case | Upstream source | Local mathematical work | Attribution expectation |
|---|---|---|---|
| A | `L_gct_126`, [PR #2](https://github.com/brilliant-hq/pequalnp-proofs/pull/2), `brilliant-hq` | The unchanged cubic polarization identity and `ring` proof, packaged with specific imports. | Simple reuse; no discovery claim; zero or low local credit. |
| B | `L_meta_253`, [PR #130](https://github.com/brilliant-hq/pequalnp-proofs/pull/130), `lshhhhhhh` | Prove that setting a cover variable true in the actual list-CNF evaluator equals deleting clauses incident to that graph vertex. | Preserve source formalizer attribution; assess integration value independently. |
| C | `L_meta_727`, [PR #979](https://github.com/brilliant-hq/pequalnp-proofs/pull/979), `fededevi` | Transport minimum vertex-cover forcing into minimum-true-variable CNF models, then use B's exact theorem to reduce incident clauses. | Known mathematical consequence formalized locally; no new-literature discovery claim. |

The source contributors above are GitHub account identities recorded by the
upstream PRs. Their original discovery, real-world identity, wallet control,
and entitlement to a particular allocation remain separate claims. No external
wallet is assigned. These expectations are fixture descriptions, not judgments.

## Exact provenance and licensing

`upstream/evidence.json` records source text, GitHub numeric author IDs, submitted
head and merged commit IDs, Git blob hashes, source SHA256 hashes, and upstream
checker comments. All evidence uses snapshot
`42765bad82112b0ea3e275713780ab49db8074ec`. The files under `upstream/` are preserved
byte for byte. The upstream license is Apache-2.0, retained in full at
`upstream/LICENSE`; the snapshot has no upstream NOTICE file. `NOTICE` and each
modified source identify the modifications.

The final accepted upstream checker comments bind the submitted proof heads.
Their Actions runs were `workflow_dispatch` runs whose `head_sha` identifies a
base-repository commit; it must not be mistaken for the submitted proof commit.
C's PR history includes an initial pre-build refusal at an earlier head, then
acceptance at its final submitted head. Upstream checks are documentary evidence;
the local verifier checks the packaged proofs independently.

Upstream already pins Lean 4.36.0 and Mathlib
`fc4f59e577feb1a4956671bc04ac18aaaf8cd842`, exactly matching the full verifier.
No toolchain migration or migration credit is claimed.

## Mathematical boundary

B reproduces the five definitions in `lean/Trusted.lean`: `Clause`, `CNF`,
`evalLiteral`, `evalClause`, and `evalCNF`. It proves the semantics of positive
two-literal edge clauses, then the Boolean complement identity between a cover
CNF and the upstream graph edge predicate. A separate lemma proves that a
`Nat`-indexed assignment update commutes with complementing its `Fin n`
restriction. The selected B theorem uses upstream `L_meta_253` to connect those
representations. Both orientations of each edge are represented; duplicate
clauses do not affect the proved semantics. The formal graph-to-clause-list
definition uses Mathlib's noncomputable `Finset.toList`, so this is a proof of
semantic compatibility, not an executable graph-conversion service.

C identifies the finite set of true graph variables with a vertex cover and
constructs a `Nat` assignment for every finite cover. It transfers the minimum
cardinality hypothesis, applies upstream `L_meta_727`, and uses B's selected
theorem to prove the restricted CNF is satisfied. Variables outside `Fin n`
are excluded from the cardinality. The theorem is a standard consequence; it
does not establish a new complexity bound or solve P versus NP.

## Reproduce and bind

`python3 fixtures/federation/prepare.py` packages source as normalized version-two
bundle JSON. It does not execute Lean. It emits A, B, a C publication template,
and `C.local.json`, whose dependency ID is explicitly
`local-fixture:B-not-accepted`. The local dependency manifest is a test input,
not an assertion that the dependency has been accepted.

Build the trusted image with `github/build-full-lean.sh`, then set
`TRUSTED_LEAN_IMAGE` to the resulting immutable image ID. Run:

```text
python3 fixtures/federation/verify_local.py A
python3 fixtures/federation/verify_local.py B
python3 fixtures/federation/verify_local.py C.local
```

The wrapper calls the existing `scripts/verify_full_lean.py` implementation.
Candidate Lean only executes in offline, read-only, unprivileged containers.
Serialized proofs then pass through six fresh kernel checks and the trusted
semantic audit. `*.local-verification.json` explicitly scopes the resulting
reports to unpublished local inputs. Its `head` and `base` fields identify the
verifier checkout, not a research submission commit. The nested verifier's
`production_verified` field describes its verification pipeline, not live
consensus or ledger acceptance.

Once B has actually been accepted, run `prepare.py --accepted-b-id ACTUAL_ID`
to create `C.bound.json`, resolve the accepted artifact through the normal
trusted dependency flow, and verify again against the real research commit
and policy. Supplying an ID to the packaging script does not verify acceptance.
Never publish `C.local.json`, its local manifest, or a template placeholder as
an accepted dependency. Changing B's source changes its bundle hash and C's
namespace binding; regenerate and reverify both artifacts.
