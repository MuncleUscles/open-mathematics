# Open Mathematics protocol development

New research contributions belong in MuncleUscles/p-vs-np on its protected research branch. Follow https://github.com/MuncleUscles/p-vs-np/blob/main/AGENTS.md with the exact pinned protocol release. No task ID or curator enrollment is required in v5.

This repository owns the protocol, checker, worker, agent helper and static dashboard. Keep old v1–v4 contracts and evidence unchanged; their ledgers remain separate. Do not describe historical functionality or mock tests as live v5 results.

Run `npm test`, `npm run build`, the focused Python verifier suite, direct contract tests and pinned `genvm-lint` before publishing. Full E2E requires actual signed PRs, isolated production Lean, independent native consensus, protected merges, exact receipt checks and readback of initial/impact points. Local direct tests mock model responses.

Never execute contributor checkout code on the host or pass service secrets into the proof container. Keep contributor keys outside repositories and never print them. Preserve each review transaction hash. Watch the Studio appeal deadline as soon as a review starts. Require a finalized submit or request_retry transaction from the signed claim wallet, bound to the track, PR and original comment. A retry also names its finalized undetermined review. The worker verifies and settles these requests. See docs/OPEN-RESEARCH.md. The contract decides merge and points, the worker executes. Follow root GitHub app-first access rules and keep exact release pins in problem workflows.
