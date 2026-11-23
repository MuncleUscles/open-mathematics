# Research directions, provenance and future forecasts

The platform pursues P vs NP through verifiable contributions. A research side is a declaration of direction, not evidence that a conjecture is true and not a factor in formal validity or contribution merit. No percentage-complete estimate is defined.

## Protocol v3 activation

Three wallet affiliations are supported: `p-equals-np`, `p-not-equals-np`, and `shared`. Each wallet changes its own affiliation with a signed native call. The history remains inspectable. A contribution separately records its direction at submission; changing a wallet's affiliation does not rewrite earlier work. An unaffiliated wallet can contribute.

The new dashboard reads finalized native affiliations, contribution records, provenance, external authors, correction cases and problem status. It activates only when deployment metadata identifies protocol v3. Earlier deployments show the feature as unavailable and retain their historical contribution ledger. Missing reads never become invented counts or synthetic affiliations. Accepted activity means credited contributions, not proximity to solving P vs NP.

## Submission schema version 2

Every new record has `research_direction` and `provenance`, alongside the existing required `prior_art` field. Provenance modes distinguish:

- **Discovery:** a claimed new result, with an honest search basis and explicit limitations; this does not establish global novelty.
- **Formalization:** a formal proof of a result from an identified external source.
- **Extension:** a stated addition to prior work, identifying exactly what changes.
- **Integration:** incorporation of existing results into the research component.

Up to four sources may be declared. Each contains an actual HTTPS reference, title, one to eight author names, its relationship to this contribution, and evidence relevant to priority. Sources contain no wallet fields. URLs and all prose remain untrusted evidence. The UI escapes text and offers source links without treating a linked page as an instruction or a verified solution.

Formalization and integration require at least one actual source. An empty source list requires an honest `discovery_basis` of at least 40 characters, including the limits of the search. Discovery always requires that basis. The submission template defaults to `shared` and `integration` with an empty source list; it intentionally fails validation until the author adds actual sources or changes the mode and supplies an appropriate basis. Do not substitute placeholder URLs or claim discovery just to pass validation.

External authors appear separately from the importing wallet. Source declarations cannot assign author wallets. Unclaimed native author credit remains unclaimed until an independently verified authorship process associates the applicant's own wallet. Displaying a name does not prove that person's identity.

## Corrections and external solutions

A separate, auditable native correction process can revisit attribution after the original contribution challenge window. Original awards, current awards, evidence, verdicts and correction history must remain distinguishable. An allegation does not itself transfer points or change authorship.

External solution submissions enter review. A URL, headline, model judgment about a page, or valid proof of an unrelated statement cannot resolve P vs NP. A complete, separately reviewed target statement and independently verified evidence are prerequisites for resolution. This pilot does not currently enroll such a complete P/NP target, so external claims remain under review or inconclusive.

## Future only: forecasts

Forecasting is a later research experiment. No odds, forecast positions, prediction markets, prediction payouts or forecast-based merit multipliers are active. Before implementation, specify the resolution criterion, evidence policy, manipulation controls, participant disclosures and evaluation method. Keep forecasts separate from proof validity, research-side membership and contribution credit.

## Activation checks

Deploy and independently test the new native views and write methods, migrate earlier records with explicit provenance limitations, run the complete PR/evidence/adjudication path, and then publish matching metadata and UI. Schema validation and browser display tests alone do not prove native consensus, migration correctness or a real external author's identity.
