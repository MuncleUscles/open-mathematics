# Anthropic source-collection fixture

This is an actual read-only collection of one small existing lemma from
`anthropics/formal-math`, not a new mathematical contribution or a native ledger
result. It does not verify the full VP–VNP claim, establish original discovery,
bind a wallet, award points, or supply a judging-benchmark measurement.

## Exact source

- PR: [anthropics/formal-math#51](https://github.com/anthropics/formal-math/pull/51),
  publishing account `steinke-ant`, GitHub ID `294419551`.
- Source/merge commit: `11b6c7e3c927df2658f513b6b68ea7f8929c62c5`.
- PR head: `918c8e2778aee18b0283dc5a33ed39ab3cd63a96`.
- Path: `vp-vnp/Nc/LowDegree.lean`.
- Git blob: `67486500737d07db480c2d0deeb645437278cdfe`.
- Source SHA-256: `ae26842182c09a0154db023ecb736b11e86137632f5e852c0f192e3e1c28316b`.
- Literal token: `eval_one_line`, inside namespace `Nc`. The full 1,869-byte
  source is the exact supplied excerpt; token matching is documentary binding,
  not Lean parsing or semantic verification.

`LowDegree.lean` preserves the upstream file unchanged. `input.json` is the
collector input; `provenance.json` is the actual returned evidence and packet.
`collection.json` records the collector source hash, measured bounds and artifact
hashes. PR identity identifies the publishing account only; individual lemma
authorship and original discovery remain unestablished.

## Observed collection

The first run of the revised collector succeeded in **25.258 seconds**, making
42 requests for all 333 changed files and the exact source/license objects.
The largest response was 283,235 bytes; total response bytes were 3,859,660.
The 30-second deadline, 512 KiB response limit and 256 KiB file limit were
unchanged. Slower retrievals can still time out; no retry is hidden in this result.

The prior 300-file limit rejected this PR before listing files. Its 100-file
pages also exceeded 512 KiB, so increasing only the file count would not work.
Ten-file pages keep the measured responses below that cap while preserving
complete-list, duplicate, source/head/merge and immutable-blob checks.

The repository-root license endpoint works at this commit. It returns the same
11,357-byte Apache-2.0 blob as `vp-vnp/LICENSE`, preserved here as `LICENSE`.
The separately fetched and hash-verified `vp-vnp/NOTICE` is preserved as `NOTICE`.
The collector does not automatically discover project notices; those still need
separate review and preservation. Neither licensing metadata nor collection
establishes mathematical validity or priority.

## Read-only reproduction

From the protocol checkout, with an optional GitHub read token in `GITHUB_TOKEN`:

```sh
node --input-type=module <<'JS'
import fs from 'node:fs';
import {collectGithubProvenance} from './github/github-provenance.mjs';
const input=JSON.parse(fs.readFileSync('fixtures/federation/anthropic/input.json','utf8'));
const result=await collectGithubProvenance(input,{token:process.env.GITHUB_TOKEN});
console.log(JSON.stringify(result,null,2));
JS
```

This only reads GitHub. It does not run upstream source or call a native contract.
The frozen source objects must still match; mutable PR metadata and response
hashes may differ on a later read.
