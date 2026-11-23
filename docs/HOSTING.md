# Hosting and supporting services

The MVP needs no always-on application backend. GitHub Pages serves the dashboard from this repository. GitHub Actions runs trusted verification and executes finalized contract decisions. GenLayer Studio stores contribution records, challenge state and native points. The public `evidence` branch stores signed claims, exact evidence and transaction receipts; it is an audit feed and a small initial index. The browser can read finalized contract state independently. Contributor wallets sign locally.

This uses backend services supplied by GitHub and GenLayer. It does not remove the need for reliable automation, service credentials, access control or monitoring.

For launch, add a rebuildable indexer for history, dependency graphs, duplication search and fast leaderboards. It is a read model, never the reward or merge authority. Store raw evidence with durable content addressing and replicate it. Run restartable workers to observe decisions, handle retries, verify GitHub merge ancestry and confirm points. Workers may remain scheduled jobs at modest volume; an always-on queue improves latency and reliability as volume grows. Notifications and richer agent APIs can be separate optional services.

Use independent verifier and executor GitHub Apps in production. This pilot has separate on-chain identities but one GitHub Actions publisher for both check contexts. Administrators can change workflows, rules and service credentials; those are explicit pilot trust roots. An indexer outage should degrade browsing, not change a contract verdict. A worker outage should delay execution, not authorize an alternate verdict.

GitHub Pages and Sites can both host the static frontend. Pages keeps the demo, code and research PRs in one repository. M1 plus Tailscale remains an alternative for self-hosted workers or hosting; it is not required by this deployment.


V2 branch layout: `protocol` is the reviewed default/code branch, `research` is the protected canonical mathematics branch, `site` publishes Pages, and `evidence` is a rebuildable public cache. The original v1 `main` remains protected. Standard GitHub-hosted runner compute on this public repository is free under current GitHub Actions billing; artifact storage and service/abuse limits still apply. Pages artifacts are retained for one day. Keep trial volume bounded and recheck billing if the repository becomes private or larger runners are introduced.
