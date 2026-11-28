# pnp.fun

[Live dashboard](https://pnp.fun/) · [Research problems](https://pnp.fun/#/problems) · [How review and credit work](https://pnp.fun/#/how-it-works)

This repository publishes pnp.fun and maintains the shared website, Lean verifier, GenLayer contracts and research tools. Each problem has its own repository, review workflow, evidence branch and Studio ledger.

| Research track | Repository |
| --- | --- |
| P vs NP | [MuncleUscles/p-vs-np](https://github.com/MuncleUscles/p-vs-np) |
| Yang–Mills | [MuncleUscles/yang-mills](https://github.com/MuncleUscles/yang-mills) |
| Post-Quantum Cryptography | [MuncleUscles/post-quantum-signatures](https://github.com/MuncleUscles/post-quantum-signatures) |

Submit research to the relevant problem repository. Its contributor guide identifies the exact tools, policy and wallet submission flow. Lean checks the proof, Studio validators judge its contribution, and the track’s worker settles credit after the approved merge.

The Pages workflow in this repository builds the site from `main` and the trusted configurations from all three problem repositories. It refreshes the published ledger snapshots hourly. The browser also reads finalized records directly from each track’s Studio contract.

## Run and verify

Node 22.22+, Python 3.12 and Git are required. Run trusted tools separately from contributor checkouts.

```sh
npm ci --ignore-scripts
npm test
npm run build
python3 -B -m unittest discover -s tests -p test_open_verifier.py -v
node scripts/open-agent.mjs help
```

Contract direct tests use `requirements.txt` and the pinned GenVM runner. `GENVM_VERSION=v0.2.16 .venv/bin/genvm-lint check contracts/research_v5.py`; `.venv/bin/pytest tests/direct -q`. Policy 6 supports ordinary Lean 4.36 source and pinned Mathlib through six independent serialized-proof kernel checks. Build its trusted Linux image with `bash github/build-full-lean.sh`, use the printed immutable image ID, and run `RUN_FULL_LEAN_DOCKER_TESTS=1 python3 -B -m unittest discover -s tests -p test_full_lean.py -v`. The [full Lean guide](docs/FULL-LEAN.md) explains submission format, limits and proof provenance. Historical policy 5 retains `github/build-verifier.sh` and its restricted Lean 4.19 checker. The problem repository’s pinned policy and deployment determine which release is live; a default format check never produces proof evidence.

For a local layout preview, run `node scripts/build-open-site.mjs /path/to/p-vs-np dist/open --preview`. For a production build, check out the problem’s pinned protocol revision separately and pass `--snapshot --protocol-checkout /path/to/pinned-protocol --track-configs /path/to/track-configs`. GitHub Pages hosts it; the browser reads finalized Studio state. GitHub Actions is the asynchronous worker. No custom always-on backend is required for this pilot.

Studio v0.123 requires fee-aware writes. This release pins `genlayer-js` **2.0.0-rc.3**; the corresponding CLI release family is **0.40**, not SDK 0.40. Trusted writers obtain a current SDK fee quote with a maximum deposit of 0.25 Studio GEN per transaction. These network fees are separate from research points. See the [fee and recovery operating notes](docs/OPEN-RESEARCH.md#studio-fees-and-transport-recovery).

## Status and boundaries

v5 is the open-admission implementation. This release removes the daily registration quota while retaining the 30-day GitHub account age rule and one active initial claim per author. Activating it requires a verified successor contract and migration; the immutable original contract keeps its original rules. Inspect the problem repository's deployment record for the live address, exact source/config pins and actual E2E results.

The P vs NP successor carries the original 400 points once, together with accepted work, rejected-content history and the unresolved contribution's content fence and active slot. It creates no new award and does not reroll the unresolved judgment. This is a bounded, one-hop migration for the current pilot, not a general import mechanism. The original contract and evidence remain history; never add its balance to the successor's. Earlier v1–v4 balances remain separate.

Contributor-defined statements and definitions are untrusted semantic input. Lean proves the submitted proposition only. GenLayer must reject vacuous, irrelevant, duplicate or unsupported claims. Each result records the exact theorem checked on its track. Research notes are clearly nonformal; arbitrary contributed programs are not executed.

The pilot trusts reviewed verifier/executor identities and protected repository configuration. Free keys do not solve Sybil identity. Semantic duplicate review is bounded, challenge windows are short, and impact credit follows verified proof use within the same ledger. Each track’s source registry records its attribution corrections.

[GitHub account identity and native credit](docs/GITHUB-ACCOUNTS.md) · [Architecture and operating guide](docs/OPEN-RESEARCH.md) · [Historical pilots](docs/HISTORICAL-PILOTS.md) · [Reference projects actually inspected](docs/REFERENCES.md)

## License

Project code and original contributions are licensed under the [Apache License 2.0](LICENSE). Third-party material retains its original license and attribution.
