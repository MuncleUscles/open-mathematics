# Ordinary Lean and pinned Mathlib submissions

The full-Lean policy (version 6) accepts ordinary Lean source in a version-2 JSON bundle. Its trusted environment is Lean **4.36.0** and Mathlib commit **`fc4f59e577feb1a4956671bc04ac18aaaf8cd842`**. The allowed axioms are exactly `propext`, `Classical.choice`, and `Quot.sound`. The reviewed problem policy and protocol commit identify whether this environment is active. Policy version 5 retains its historical restricted Lean 4.19 format.

Start with the problem repository's **main-branch [agent guide](https://github.com/MuncleUscles/p-vs-np/blob/main/AGENTS.md)**. It sets up the exact trusted tools, configuration checkout and `pnp` command. Keep your contribution checkout separate; never install or run contributor-provided tooling on the host.

## Create your own result

```sh
pnp inspect
pnp list
pnp init my-result YOUR_PUBLIC_WALLET formal
```

`init` creates the required record and one artifact. Under policy 6 the artifact is a working-format example:

```json
{
  "version": 2,
  "imports": ["Mathlib.Data.Int.Basic", "Mathlib.Tactic.Ring"],
  "source": "namespace Contribution\n\ntheorem result (x y : Int) :\n    (x + y) ^ 2 = x ^ 2 + 2 * x * y + y ^ 2 := by\n  ring\n\nend Contribution\n",
  "theorem": "Contribution.result",
  "dependencies": []
}
```

This is a standard textbook identity demonstrating Mathlib's `ring` tactic. It is not new mathematics or a claim to points. Replace it with your work and complete every placeholder in the accompanying submission record. For known results, choose honest `formalization` or `integration` provenance and identify actual external sources. Explain what you contributed, why it helps the research goal, and what it does not establish.

The bundle has exactly these five fields. `source` holds ordinary Lean definitions, structures, inductive types, lemmas and proofs; it is not restricted to the former expression/tactic allowlist. Select the exact theorem with `theorem`, using a relative qualified name such as `Contribution.result`. Imported modules go in `imports`, with at most eight specific `Mathlib.…` modules from the pinned environment. The compiler supplies those imports before the source.

The artifact is at most **32,768 UTF-8 bytes**, including the JSON envelope and escaped source; the source field itself is bounded at 30,000 bytes. The record is at most 16,000 bytes. The complete notation-free theorem and definition statement may contain up to 32,768 UTF-8 bytes; it is never truncated. Keep both concise: the combined native evidence also has a 65,536-byte bound after escaping and adding context and verifier metadata. Local `check` and `sign` do not predict the full signed-verifier evidence size.

Do not submit a Lake project, a changed `lean-toolchain`, `lakefile`, dependency manifest, build script, workflow or Mathlib source edits. The PR still contains **exactly two new regular files**: `research/submissions/my-result.json` and `research/artifacts/my-result.json`. Environment upgrades belong in reviewed protocol changes, separately from research submissions.

## Reuse accepted work

```sh
pnp show CONTRIBUTION_ID
```

`show` authenticates the native record, checks the stored artifact against its bundle hash, and returns `reuse.reference`. Copy that exact fully qualified Lean reference. The verifier wraps each source in `B_<raw_bundle_sha256>`:

| Accepted artifact | Default theorem reference inside another bundle |
| --- | --- |
| Version 2, `theorem: "Contribution.result"` | `_root_.B_<bundle_hash>.Contribution.result` |
| Historical version 1 | `_root_.B_<bundle_hash>.result` |

The angle-bracket text above is explanatory; use the actual name returned by `pnp show`. `_root_` is needed because your source also runs inside its own bundle namespace. A v2 artifact may choose a different theorem name; `show` returns that name rather than assuming `Contribution.result`.

In the bundle, add `{ "id": "ACTUAL_ID", "bundle_hash": "ACTUAL_64_HEX_HASH" }`. In the record's dependency list add the same `id`, plus substantive `use` and `importance` descriptions. Keep both lists in the same order. Only credited formal results are eligible for proof reuse. The worker fetches their exact accepted bytes and rechecks them in the active environment. New v2 bundles can reuse either v1 or v2 dependencies; historical v1 syntax cannot refer to v2 source bundles.

Limits remain four direct dependencies, eight imported bundles in total and four levels below the submitted bundle. Declared direct proofs must actually occur in the checked proof after the verifier's reductions. A citation alone is not verified proof use. This check does not establish necessity, independent authorship or downstream merit; the contract makes the point decision within one fixed award budget.

One exact historical Lean 4.19 bundle needs a reviewed proof-only compatibility port for Lean 4.36. The pinned adapter manifest binds its original bundle, original proof and compiled proof hashes; verification reports the applied adapter and manifest hash and still requires every kernel check. Its definitions, statement, dependencies and original artifact identity stay unchanged. Unknown bundles receive no adapter. This compatibility check does not reopen the historical contribution's judgment or award points.

## Check and submit

```sh
pnp format research/artifacts/my-result.json
pnp format research/submissions/my-result.json
pnp check research/submissions/my-result.json
```

The default check validates the format and dependency manifest only. It **does not run Lean**, establish that the source parses, or verify a proof. Its result says `syntax-only` and `production_verified: false`.

To run the actual isolated verifier locally, build the trusted image using Docker, then copy the printed `export TRUSTED_LEAN_IMAGE=…` command into your shell:

```sh
bash "$OPEN_MATH_TOOLS/github/build-full-lean.sh"
# Run the exact export command printed by the build script, then:
pnp check research/submissions/my-result.json --lean
```

Trusted image construction downloads the pinned toolchain, Mathlib and its dependencies before any contribution is loaded. Proof execution has no network or service keys and uses bounded container resources. The full check may take several minutes. The worker runs the production check independently against the exact signed PR; a local pass does not authorize registration, merge or points.

The compiler and tactics process untrusted source only in isolation. Acceptance additionally requires the independent serialized-proof/kernel checks against the pinned library definitions, including the theorem's actual proposition, dependency use and allowed axioms. Compiler success, a printed success message, `sorry`, a custom axiom or a green GitHub badge is not sufficient. The submitted theorem must survive the verifier's supported export and resource bounds; ordinary Lean syntax is not permission to execute arbitrary host projects.

Follow the main-branch guide to commit the two files as one commit on the current `research` base, open the PR, and sign its exact head/base/record. Keep private keys outside repositories. The PR author posts the original unedited public signed envelope. Never edit or repost it to obtain a new judgment after consensus fails.

Formal verification establishes the submitted theorem, not the mathematical significance of its definitions and not a full solution to P versus NP. GenLayer independently adjudicates merit, novelty, merge and nontransferable points. Research notes remain available for substantive nonformal work and receive no formal-proof badge. Historical receipts and points retain their original policy and are not silently rejudged by this format upgrade.
