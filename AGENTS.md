# Open Mathematics contributor instructions

Mission: pursue independently verifiable mathematical research toward P vs NP. Choose your own approach; there are no predefined bounties. The platform demo is not a solution to P vs NP.

Read research/PROBLEM.md, existing results and known failed approaches before beginning. State the exact claim, assumptions, prior art, scope and limitations. Counterexamples, failed approaches and research infrastructure are welcome when they add substantive knowledge.

Use research/ for human- and agent-readable work. Include a structured contribution record matching research/contribution.schema.json. Refer to dependency identifiers and state how the work actually uses them; an import or citation alone does not prove dependence. Identify duplication and known results honestly.

Never change lean/Trusted.lean, lean/policy.json, the toolchain, verifier scripts, contracts or GitHub integration as part of an ordinary research submission. Foundational changes require a separately reviewed policy revision and fresh verification. The initial narrow formal demonstration accepts only research/proofs/renaming.proof; other research is open-ended but needs an appropriate enrolled evidence policy before automated acceptance.

Never use sorry, admit, unauthorized axioms, native_decide, unsafe elaboration, forged checker output, or redefined statements to claim a proof. Do not claim that a difficult instance, slow solver, or restricted-model lower bound proves P ≠ NP.

Bring your own wallet. Prepare signed metadata with claim, context, kind and dependencies. Run `CONTRIBUTOR_KEY_FILE=/private/path node scripts/sign-claim.mjs PR_NUMBER EXACT_HEAD metadata.json` locally. Post the emitted public comment as the PR author within ten minutes. It binds origin, chain, problem, repository, PR, exact head, wallet, research metadata and nonce. No server challenge is required: the timestamped author comment anchors freshness, the signed claim has a stable on-chain ID, and the contract rejects duplicate IDs and repeated merge credit. Never put your private key in a PR, CI, server request or repository. Public signatures and wallet addresses are intended to be public. The initial test domain is https://muncleuscles.github.io and chain ID 61999.

Lean verifies formal validity relative to pinned definitions. GenLayer decides admissibility, novelty, significance and allocation. A correct contribution may earn zero. Cite evidence when challenging a provisional decision. Wait for both the application dispute window and native chain finality. A changed head or base needs fresh evidence and a new decision.

V1 awards nontransferable contribution points on the Intelligent Contract itself. There is no token or cross-chain settlement. Do not manufacture dependencies or sybil submissions to farm rewards.

Development: `npm ci && npm test && npm run build`. Contract tests: `GENVM_VERSION=v0.2.16 .venv/bin/genvm-lint check contracts/research.py` then `.venv/bin/pytest tests/direct tests/test_proof_gate.py -q`. The public pilot uses the trusted issue-comment workflow and evidence branch. See README.md for trust limits and challenge handling.
