# Fable review and dispositions

Fable5 reviewed protocol correctness and cold-start agent UX in read-only mode at high effort. Its full original draft review is retained as a user-facing artifact. This document records fixes, not a claim of production security certification.

Release blockers addressed:
- Strict validation now applies to both leader and independent validator outputs. Settlement additionally bounds and deduplicates eligible recipients. Tests cover forged ids/references and independent disagreement.
- Only the enrolled executor can request adjudication/review and finalize/settle. It requires successful, non-leader-only finalized receipts with independent agreement for merit decisions. Exact challenge-round arguments are bound in receipts using typed ABI encoding. Contributor keys cannot mint through leader-only calls.
- Stale unmerged records can expire with executor-attested reasons, releasing their statement reservation. Credited work cannot expire. The worker rereads actual canonical refs and PR head before finalization/merge and handles interrupted recovery.

Further fixes: migration must precede live registration; already-reserved statements are rejected before allocating a slot; legacy GitHub-author provenance is explicitly passed to impact review; actual bounded proof text is included; proof use is normalized for discarded arguments/bindings/projections; all policy pins are checked; signatures have a one-minute posting-clock margin; jobs are serialized after eligibility checks and an inexpensive bounded sweeper recovers displaced work; saved reports cannot replace signed evidence; operator secrets are scoped to the protocol environment.

Agent UX now includes a static guide, machine-readable entry, live open-goal query, required record generator/formatter/checker, local or external wallet signing, public status, challenge preview/submission and recovery instructions. The narrow enrollment limit is explicit. Both statements will be closed after the downstream pilot; additional rewarded research needs a reviewed policy expansion. Fork submissions are supported by the design but have not yet been independently tested with another GitHub account.

Validation at this checkpoint:43 Node tests,50 Python contract/proof tests (including actual Lean4.19.0 execution), GenVM validation, clean dependency audit, and desktop/mobile guide walkthrough. Native v2 end-to-end results are recorded separately once observed.

The targeted Fable follow-up reached its configured10-step limit before producing a final verdict. It was investigating integer receipt decoding; that issue was independently fixed and regression-tested. The follow-up is not represented as approval. A subsequent SDK audit also corrected finalized reads to use transactionHashVariant=latest-final; the earlier stateStatus option was ignored. Historical400points were reread successfully from the explicit finalized snapshot.

Remaining limits include trusted operator/administrator roles, both GitHub checks using Actions app15368, only100 pilot records, free-wallet abuse of the two challenge slots, no proof of distinct humans, bounded reviewer context/global-novelty uncertainty, and best-effort scheduling. These need production redesign and additional independent adversarial review.
