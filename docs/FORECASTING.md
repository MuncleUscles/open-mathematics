# The Ape Forecasting Desk

The existing pnp.fun dashboard now has a nonfinancial spectator layer: two fixed milestone questions, signed probability submissions and revisions, community medians and history, personal records, and a separate forecast scoreboard. Research submissions, Lean verification, native adjudication, protected merges, federation and PNP accounting are unchanged.

## Deployment boundary

The renderer can ship independently using `build-open-site.mjs PROBLEM OUTPUT --protocol-checkout PINNED_PROTOCOL`. The consumer's `.open-math/forecasts.json` supplies the public API origin. The research protocol remains pinned to `93c7d3fce28163b281a33fcdfeab00aed06c46f4`; this feature does not activate the later attribution contract revision.

`forecasting/` is a self-contained Cloudflare Worker service, with D1 migrations generated from `db/schema.ts`. Hosting provisions `DB`; migrations are applied before publication, never from a request handler. The deployed source copy uses the same files and lockfile. Question definitions are committed in `questions.json`, hashed and inserted once in D1. A changed hash or a removed question makes requests fail closed. Add new question IDs instead of rewriting published questions.

## Identity and records

A first submission creates a P-256 signing identity in IndexedDB. Its private key is nonextractable and never sent to the server. Browsing needs no account, wallet or GitHub login. Clearing browser data loses the ability to revise that identity's calls; its public records remain. Cross-device recovery is not part of this pilot.

Each signed envelope commits to the domain, question ID and definition hash, integer probability, public reasoning, revision, previous receipt and random nonce. The service verifies the signature, assigns its acceptance timestamp and appends a content-addressed receipt. Unique revision/nonces and an atomic expected-revision insert reject competing edits and replay. Retrying an identical accepted envelope returns the same receipt. A key may update a question once a minute; IP buckets allow 30 valid submissions per 15 minutes. The pilot accepts at most 10,000 revisions per question. There is no delete/edit endpoint.

`GET /api/audit` exposes the exact public keys, signatures, signed payloads, receipt hashes and timestamps, with a 100-record cursor. Optional `participant` and `question` filters preserve pagination. Keys identify pseudonyms, not independent humans. Sybil resistance is deliberately limited. User reasoning is rendered as text.

The service is a trusted timestamping and storage operator, not an onchain timestamp authority. Receipts protect signed content and revision links but do not make the server's time independently trustless. The consumer's checkpoint workflow archives registry/audit/score snapshots in Actions artifacts for 90 days. Public records remain available from the API.

## Aggregation and scoring

The community call is the median of each identity's latest accepted probability, collected over the fixed open window. It appears only at five identities. Daily snapshots show how it changed. No participants, probabilities or performance are seeded in production.

For binary outcome `y`, Brier loss is `(p-y)^2`. Integrate loss over the whole fixed open/close window. Before an identity's first submission, use `p=0.5`; revisions take effect at their server acceptance timestamps. At least 50% window coverage is required to rank. Average each participant's eligible resolved question losses equally; lower is better. Inconclusive questions have no score. Early rankings are explicitly provisional. Forecast scores never award PNP research points or other rewards.

## Resolution

The first two questions concern at least two credited formal records and a positive `total_impact_points` counter on the named existing Studio contract. Opening: November 24, 2026 14:00 UTC. Forecast close: November 30, 12:00 UTC. Resolution checkpoint: the first complete stable finalized read started December 1, 12:00 UTC and completed by 13:00 UTC. The native baseline at creation had one credited formal result and zero impact points.

`POST /api/checkpoint` accepts no outcome or evidence from its caller. It reads the precommitted chain and contract itself with `latest-final`, verifies the policy and full bounded registry, and checks unchanged federation revision before/after. Only this complete native capture can yield YES or NO. The full evidence, capture interval, question hash, evidence hash, native state revision and method are published with the resolution. Missing the window, capacity overflow, configuration drift or an unavailable ledger cannot become NO; after the deadline the question becomes inconclusive. Stored resolutions are immutable.

These objective milestones consume already finalized GenLayer research decisions. They need no new interpretation or contract transaction. New interpretive questions require their own explicit, reviewed GenLayer resolution adapter; the current registry rejects unsupported predicate types. Forecast submitters have no resolution privilege. No broad claim about solving P vs NP or original mathematical discovery is inferred from formal credit.

## Run and validate

From the protocol root: `npm test` includes real SQLite/Worker API tests for signatures, concurrent revisions, timing, scoring and fail-closed resolution. Build a local static preview with the existing `--preview` flag, then run `node forecasting/dev.mjs /absolute/path/to/preview`. It serves at `http://localhost:4178/#/forecasts` and stores disposable local data in `/tmp/pnp-forecast-preview.sqlite`, separate from production. Local demonstration calls are never uploaded.

For the service, copy `forecasting/` into its hosting checkout, preserve `.openai/hosting.json` and existing migrations, run `npm ci --ignore-scripts`, and `npm run build`. Generate future schema changes with `npm run db:generate`; never rewrite an applied migration. Source publication and API origin changes should be reviewed alongside the consumer workflow pin. Rolling back the renderer does not delete forecast records. Never roll back published question rules.

No new research-native E2E cycle is needed for a renderer and read-only forecast adapter. Existing protocol tests and lint still run before publication. Browser QA covers signing, publishing, revising, persistence and responsive rendering against a separate local database. Production verification checks anonymous API access, empty initial counts and native source consistency; no fabricated live calls are added.
