# Actual reference inspection

Read-only inspection on 22 November 2026. These were existing working trees with unrelated changes; HEAD hashes identify baselines, not a claim that every inspected byte was committed there. No code was copied and no existing checkout was modified.

| Project | Baseline | Observed source and resulting design choice |
|---|---|---|
| Rally (`genlayerlabs/Rally`, local Rally2) | `a5a2a4e51d18ad7e40a4fd7a4661e101319a9862` | `intelligent-contracts/CampaignFactory/CampaignIC.py`: originality comparison, zero/nonzero merit gates, integer reward proportions, delayed idempotent distribution. Adopted explicit merit and duplicate gates. `app/docs/Rally_Design_System_Documentation.md`: clear submission/score/reward structure. |
| Venturewake (`genlayer-foundation/venturewake`, local merchant-voyages) | `27d680c7aa1c725fb2477e88367e6a80931920df` | `src/crypto.mjs`, `src/gateway.mjs`: signed action nonces. `src/studio.mjs:29`, `src/court.mjs:185`: FINALIZED + successful execution, correct identity/contract, independent validator and exact evidence digest. Adopted explicit authority separation. Its optional game-held keys were not adopted. |
| Mergeproof (`genlayerlabs/mergeproof`) | `790f6cf34bacb80a7f5f2747ba1dadcaad77b98e` | `contracts/genlayer/BountyRegistry.py:697`: commit-bound submissions. `:844`: unresolved reports block payout. Adopted review windows. Its aggregate green check-run gate (`:1521`) and already-merged PR expectation (`:881`) do not meet this project's proof/merge requirements and were not adopted. `apps/web/src/app/page.tsx`: understandable contribution lifecycle. |

Current official references consulted:

- [GenLayer Studio](https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio): Studionet environment and chain identity.
- [Contract testing](https://docs.genlayer.com/developers/intelligent-contracts/testing): direct mode versus actual consensus.
- [Lean 4.19.0 release](https://github.com/leanprover/lean4/releases/tag/v4.19.0): pinned compiler used for the fixture.
