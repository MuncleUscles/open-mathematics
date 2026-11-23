# Hosting and supporting services

The MVP needs no always-on application backend. GitHub Pages serves the [P-versus-NP dashboard](https://muncleuscles.github.io/p-vs-np/) from the separate `MuncleUscles/p-vs-np` problem repository, using a pinned release of this protocol repository. GitHub Actions runs trusted verification and executes finalized contract decisions. GenLayer Studio stores contribution records, challenge state and native points. The public `evidence` branch stores signed claims, exact evidence and transaction receipts; it is an audit feed and a small initial index. The browser can read finalized contract state independently. Contributor wallets sign locally.

This uses backend services supplied by GitHub and GenLayer. It does not remove the need for reliable automation, service credentials, access control or monitoring.

The dashboard code tries finalized native state on entry and offers manual refresh. It displays up to twelve newest contributions initially, with bounded loading of earlier live records. A failed refresh preserves the last complete live display and marks it stale. On an initial live-read failure, the resilience release can load a validated published snapshot with its original capture interval and a clear “live unavailable” label. It never represents that copy as fresh or uses it to authorize a transaction. Published snapshots do not support paging beyond their captured twelve records.

`node scripts/build-open-site.mjs TRUSTED_PROBLEM OUTPUT --snapshot` captures at most 28 unsigned contract views plus one chain-ID check. It validates the exact deployment and native configuration, preserves each record's original source revision, and records a collection interval rather than an atomic state. An incomplete or mismatched capture fails the build and publishes nothing. The trusted-main Pages workflow refreshes after adjudication; research PR code and worker artifacts are never used as publication input. A future failed build leaves the prior published snapshot and date intact.

At the November 23 release checkpoint, Studio's canonical RPC was returning an empty HTTP 404 response. No first v5 snapshot could be captured. The resilience changes are tested and prepared in [the runtime upgrade](https://github.com/MuncleUscles/p-vs-np/pull/10); the active deployment descriptor, workflow pin and Pages artifact determine what is actually live. A shared read cache/indexer can improve browsing at larger scale.

An earlier pilot observed Studio's `standard` API bucket returning `-32029` at 500 requests per hour, with a provider-supplied retry delay. This is a historical observation, not a permanent allowance guarantee. Honor explicit throttling and inspect any already-broadcast transaction before recovery; never resend a decision simply because a read failed.

For launch, add a rebuildable indexer for history, dependency graphs, duplication search and fast leaderboards. It is a read model, never the reward or merge authority. Store raw evidence with durable content addressing and replicate it. Run restartable workers to observe decisions, handle retries, verify GitHub merge ancestry and confirm points. Workers may remain scheduled jobs at modest volume; an always-on queue improves latency and reliability as volume grows. Notifications and richer agent APIs can be separate optional services.

Use independent verifier and executor GitHub Apps in production. This pilot has separate on-chain identities but one GitHub Actions publisher for both check contexts. Administrators can change workflows, rules and service credentials; those are explicit pilot trust roots. An indexer outage should degrade browsing, not change a contract verdict. A worker outage should delay execution, not authorize an alternate verdict.

GitHub Pages and Sites can both host the static frontend. Pages keeps the published problem dashboard, problem configuration and research PRs together, while protocol implementation remains in its own repository. M1 plus Tailscale remains an alternative for self-hosted workers or hosting; it is not required by this deployment.


The active problem repository uses `main` for reviewed configuration and agent instructions, `research` for accepted mathematics, and `evidence` for public reports and transaction journals. Its Pages workflow builds an artifact from the exact `main` configuration and literal protocol commit; it does not publish from a `site` branch. The worker also runs reviewed `main` code and uses encrypted service keys from a main-only environment. Research PRs cannot replace that worker or its policy.

The live deployment and its source pin are recorded in [the problem deployment descriptor](https://github.com/MuncleUscles/p-vs-np/blob/main/.open-math/open-deployment.json). Pages artifacts are retained for one day. Keep trial volume bounded and inspect current GitHub billing and service limits before changing repository visibility, runner class or scale.

## Historical v3 snapshot tooling

The following describes the earlier dashboard in the protocol repository. It is not a feature of the active open-research dashboard.

`node scripts/capture-community.mjs` collects bounded, sequential finalized views without a signer and publishes `public/community-snapshot.json` only after the complete bundle passes deployment and schema validation. The dashboard uses it when native reads fail. Its interval and per-read timestamps are retained: it is not an atomic block snapshot and never authorizes a transaction, reward or merge. The initial capture used 16 reads and ended at 2026-11-23T03:10:02.266Z.

If a read is throttled, honor the reported retry delay, then run `node scripts/capture-community.mjs --resume`. Successful reads are journaled under ignored `.data/community-capture.json` and are not repeated. An incomplete capture expires after 15 minutes; `--fresh` starts a new capture after the provider permits reads. A completed `--resume` does not query the network or relabel old data with a new time. Review and publish the complete snapshot with the static site; never attach service keys or include the ignored journal in a PR. The collector caps each bundle at 200 native reads. A larger registry needs a paginated indexer rather than increasing this pilot limit silently.


## Historical recovery schedule observation

This observation concerns the earlier protocol-repository pilot. It does not establish the current problem repository's scheduled-worker reliability.

At the 2026-11-23 06:35 UTC check, the repository API returned zero runs for `event=schedule`, although research and provenance workflows were both `active` and their schedules existed on the `protocol` default branch. The repository was public, not a fork, archived or disabled. This establishes an observation gap; it does not identify why GitHub had not delivered a scheduled run. Event-triggered PR processing and explicit recovery have separate successful trial evidence.

Do not promise recovery within fifteen minutes from cron configuration alone. GitHub documents that scheduled events can be delayed or dropped under load, but that is only a possible explanation here, not a diagnosed cause. See [GitHub's schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). If a timely signed claim has no running job, the operator can inspect its existing report and resume that original comment through `research.yml`; never blindly rebroadcast an unknown transaction or reroll failed consensus. Before unattended launch, observe actual scheduled execution and add an alert for missing runs or use an independently monitored dispatcher. Changing a cron expression or seeing an active flag is not validation.
