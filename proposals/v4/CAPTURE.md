# Bounded native-state diagnostic (undeployed proposal)

This read-only collector observes the locally pinned v3 Studio deployment. It is **not a migration exporter or a cutoff**. Every output, including a stable successful observation, contains:

```json
{"migrationReady":false,"atomic":false,"completeHistory":false}
```

Nothing here changes the deployed contract, source policy, worker or public dashboard. No signing account or private-key file is loaded. The collector cannot submit transactions. Its output is not accepted by an importer and must not be copied into a public snapshot or treated as authorization.

## Local checks and deliberate execution

From this repository, with the existing locked dependencies installed:

```sh
node --test proposals/v4/tests/native-capture.test.mjs
node proposals/v4/capture-native.mjs --help
```

The tests mock all network responses, including requests through the actual pinned `genlayer-js` 0.18.9 client. They pass on the repository's exact pinned Node 22.22.0 runtime. The separate native trial below failed before collecting any state views; it is not a successful export.

Only after reviewing the diagnostic and arranging a quiet, rate-limited observation period, explicitly run one fresh capture:

```sh
node proposals/v4/capture-native.mjs
# Optional source retrieval, if this Studio provider supports the declared raw RPC:
node proposals/v4/capture-native.mjs --check-source
```

These commands make sequential native reads. Do not run both merely to compare results: each command is a distinct full capture. There is no retry or resume. A throttle, timeout, malformed response, mismatched source or exhausted budget stops that capture. Local guard errors remain identifiable through bounded SDK/Viem cause wrappers using fixed allowlisted descriptions. Provider error messages and bodies are never copied into diagnostics. HTTP failures retain only their numeric status; HTTP 429 may also retain a numeric `Retry-After` of 0–604800 seconds (date-form and other values are omitted). Unknown failures remain unknown; a generic SDK code of `-1` does not identify a byte limit or another specific cause. Wait for a deliberate operator decision before starting a new one; never splice two captures together.

The CLI checks installed SDK version 0.18.9 and hashes the actual local `contracts/research.py` and `lean/policy.json` bytes against `public/deployment.json` before any RPC. It uses the declared Studio chain and verifies `eth_chainId`; it never substitutes localnet's chain ID. A draft source edit that changes the pinned hash therefore prevents capture until a separately reviewed matching source is used.

Outputs are compact JSON in unique files under ignored `.data/v3-native-captures/`, mode 0600. Writes are exclusive and atomic; existing captures are never overwritten. A stopped capture has `status: "failed"`, a sanitized reason and explicitly partial evidence, and exits unsuccessfully. Setup or output-persistence failure produces no successful capture file. No `.env`, signer or contributor key is read.

## What is observed

1. Chain identity and an address history observation before native views. History uses `sim_getTransactionsForAddress` with **one address argument**; the SDK's optional filter is omitted for observed Studio compatibility.
2. Optionally, exact source bytes via the declared `gen_getContractCode` request. The SDK convenience method is deliberately avoided because it rejects non-localnet before requesting. An explicit unsupported-method result is `unavailable`; another error stops collection. Canonical base64/UTF-8 bytes must hash to the pinned source. Even a match provides no atomic binding to all later state reads.
3. The full exposed contribution index, each record/provenance/impact, affiliations, authors, problem, and exposed admission tail. Cases use `list_case_page(offset, 100)` starting at zero **through an empty page**, then repeat that entire enumeration after the reads. Duplicate IDs or exhausted bounds fail.
4. Wallet closure from contribution wallets, external-author claimed wallets and claim history, affiliations and case reporters. Each wallet's native point and active-case-capacity views are recorded. Active counts are derived from observed case statuses and compared with native capacities, including invalid ranges. Wallet points, unclaimed author points and later-impact totals are compared only over this observed closure.
5. Contribution/case indexes, registries, problem and admission tail are read again; every observed wallet's points are read again and compared as raw ABI. Whole address history is read again. Changes, active cases, unfinished contributions/impacts and capacity discrepancies are reported rather than concealed.

`latest-final` is explicit on every view. It selects the finalized view available to **each call**, not a shared block. Matching before/after readings do not establish an atomic cutoff, absence of intervening changes, or quiescence. History rows retain their observed status; only `FINALIZED` is labeled finalized. `ACCEPTED`, `UNDETERMINED`, cancellation and timeout states are not silently treated as final. Finalized execution can itself have failed.

## Type and transport boundaries

Native reads retain raw ABI hex, exact encoded arguments, and tagged values. Tags distinguish integers from numeric strings, bytes from addresses, maps from lists, and null from booleans. Map keys remain strings in ordered key/value pairs; they are never converted to object properties. Each native value is bounded before SDK decoding and must re-encode to **identical bytes**. Invalid UTF-8, duplicate map keys, trailing bytes, noncanonical encodings and excessive depth fail. Values the pinned SDK cannot round-trip—such as a string whose leading U+FEFF is stripped by its decoder—also fail; the collector does not repair them.

History is **SDK-parsed and reserialized JSON**, stored as `parsedJSON` with its hash. This is not original HTTP evidence and does not claim arbitrary JSON numeric precision. Unsafe parsed integer values are refused, but parsing can already have rounded a fractional token. The collector makes no claim of lossless history serialization. Native ABI bytes are a separate, lossless representation.

SDK 0.18.9 does not expose a fetch-injection option. The standalone CLI temporarily replaces global `fetch` with a bounded guard and restores it afterward. This pattern is **CLI-only**, not suitable for a shared app or server. It accepts only exact read RPC envelopes, the bound address, zero sender and `latest-final` view calls. Requests are reserialized after validation; only explicitly reconstructed options and a JSON content-type header are forwarded. Authentication headers, foreign addresses, transaction RPCs, redirects and credentials are refused. An abort timer remains active through streaming the response body, before SDK parsing.

Fixed maximums (tests can only reduce them): 200 calls, 180 seconds overall, 8 seconds per read, 2 MiB per response, 16 MiB aggregate wire/observed response bytes, 8 MiB stored evidence, 400,000 decoded nodes, and 16 MiB compact final output. Individual ABI depth is at most 32, nodes 100,000 and collection items 10,000. Index bounds are 1,000 cases, 2,000 observed wallets and 1,000 history rows. Large legitimate deployments can exceed these conservative bounds and produce a failed diagnostic; increasing limits is a separate reviewed change.

## Missing guarantees

Studio's SDK history method supplies no pagination, count or completeness witness. A short or identical history can omit transactions or lag; internal-call coverage is unproven. `completeHistory` is always false. Exposed `list_review_cases` returns only the last 100 admissions, so historical admission order remains unproven even when all creation-index cases were enumerated. The observed wallet closure does not prove that no unindexed balances or recipients exist (`completeWalletIndex: false`). Stable totals and counts are diagnostic comparisons only.

No operator freeze, full receipt lineage, canonical GitHub merge verification, transaction cutoff proof, authenticated storage enumeration, migration approval, importer or post-import equivalence is performed. A successful run is evidence for further review, never permission to migrate or to expand a mathematical goal policy.

## Actual failed trial, 2026-11-23

One invocation with `--check-source` at tool commit `6a420a2cce5225605d19cad29d19d60034e6d636` ran from 04:16:53.411Z to 04:16:56.285Z. It confirmed chain ID 61999, then stopped on the history request. No native state view or remote source retrieval occurred, and no transaction was submitted. The SDK wrapped the failure as a generic `-1`; the original exception cannot be identified retrospectively.

The [unaltered partial diagnostic](evidence/native-capture-partial.json) is 2,183 bytes with SHA-256 `2723068dbc7b8c5500200dda496c9b046593c63689baf17ebff6d5c2a5991e92`. It retains `status: "failed"` and all three false readiness/completeness flags. Local source/policy hash checks are not remote source verification.

A separate [bounded HTTP probe](evidence/history-transport-probe.json) at 04:19:23.823Z received HTTP 200 and stopped when the decompressed history stream crossed 2 MiB (2,113,536 bytes observed at the chunk boundary). Response contents were discarded. This establishes the size of that later response, not the cause of the earlier hidden exception. Neither the cap nor the history-completeness claim was changed, and the collector was not rerun. The [trial summary](evidence/native-capture-failure.json) ties those observations together.

The subsequent offline fix preserves locally generated budget/timeout errors through SDK wrappers, with fixed public descriptions and bounded HTTP status/retry metadata. Its tests use the actual SDK against mocked responses; a future native run has not validated the fix. A compact, paginated history source with completeness evidence remains a separate prerequisite for a scalable migration design.
