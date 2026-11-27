# Delivery checkpoint — v3

Review unit: standalone `MuncleUscles/open-mathematics`, branch `feature/sides-provenance`, including the already accepted PR #5 merge `8ca73a5cf286fcf69ba3fc955ee8891ac78995ef`. The intended application base is `protocol` at `bf4e1aacdf9028442eac45e5dfc2a82f0cd587c7`. No GenLayer infrastructure repository, cross-repository stack or dependent service is changed.

The cut adds source-specific attribution, independent documentary adjudication and correction history, changeable research affiliations, a stricter mandatory submission record, a native agent helper and reliable transaction recovery. Rewards remain native nontransferable points. Research remains on its existing protected branch; maintenance changes do not bypass its merge rules.

Validated locally: 116 Node tests; 75 Python contract/proof tests with actual pinned Lean; GenVM lint/validation; static build; zero production dependency advisories; clean dedicated-key scan; source and deployment hashes agree. Fable 5 completed a read-only/high-effort correctness and UX review; dispositions and remaining limitations are in REVIEW.md.

Frozen native contract source SHA256: `00c3bbd3d4a4d075b20b4e8eb2da4636c97c2b77b558e623a349ef5d1f47bb8e`.
Policy: `9e8e13a652604f4cf3cc334e934301898bd7d888bcd73b26a71744b1b41f2965`.
Studio candidate: `0x6acF1e29790B2eE45c01184fFaa8F84f06ba9AAc`.
Deployment: `0x18b79ff566e4bc75c26978a026b8e96a9201627549a3d4d086753800d1a089c2`.
Migration: `0x58809dcbcc573cdaf394a15f89f975e4cfdf2c9c61df5a48791e00c903bd162c`.

Deployment and the exact replacement migration finalized successfully. Both accepted records carry their original 400/300 points; the ledger is 700 initial and zero later points at migration. `public/v3-migration-evidence.json` contains actual receipts. This bootstrap uses the enrolled verifier and frozen bytes, not an on-chain cross-contract proof. The older ledger must never be added to the replacement.

The native v3 later-impact trial uses the already accepted exact PR #5 result and a reviewed scoring change. Its v2 failed transaction remains archived and is not retried. Native trial outcomes are recorded in `public/v3-impact-evidence.json`; a provisional verdict is not a settled award. `public/deployment.json` selects the application release. Keep contract source frozen; any contract correction requires a fresh deployment and validation.

The already completed real research path is PR #1 (400 initial), PR #5 (300 initial), and negative PR #6 (actual Lean failure, no registration/merge/points). V3 release trials run against actual Studio consensus; the historical GitHub merges are preserved. Browser scenarios and historical fixture receipts remain explicitly illustrative. Full-target P vs NP enrollment, production identity/abuse controls, corrected-recipient impact routing and testnet deployment are future work.

Observed native release result: the review `0xba6d8a67d2eda462b365ddce9de3d15b93be996bbb705be35190ecc0e62f5bcb` reached independent agreement; settlement `0x7a5c2e23b95d64d783ef1642b70a6a350b2ac5b3f203472f39c130c399e00b99` finalized after the window. PR #1 now has 400 initial + 100 later points; PR #5 keeps 300 initial. Total 800. These release transactions used the enrolled local operator; both original merges were actual GitHub Actions outcomes. Native affiliation changes and report withdrawal also succeeded. At that release checkpoint the documentary reallocation/identity cases were pending; subsequent identity results are recorded below. Positive reallocation remains uncompleted.

Follow-up release PR #9 merged at `79adb97b061b7aacdd09b474c9383525cf413b94` and PR #10 at `3948d6eda00b739c8be40dbc029b151cbbebe88d`. The latter passed 141 Node tests, build and dedicated-key exclusion checks with unchanged native contract/policy bytes. Pages `e4d03ed8552c32878d85b56382ed0bf6dd3f085e` is the same source tree and deployed successfully in run `45102365040`.

Actual documentary negative run `45100799950` succeeded through settlement. Review `0xa32df4d42bc0aa48231c8b81381609307df570a640bf4cb274ce5bd54a479139` and settlement `0xf81cc5181e45b8ee01a366053204f828206e7b84ecc7df917a5423c9266cb04d` left P vs NP open and allocated no points. The separate author identity case settled after independent approval and its challenge window; full receipts are in `public/v3-identity-evidence.json`. This trial is explicitly limited to the pilot GitHub controller, with no external academic identity or discovery claim.

The next reviewed maintenance cut contains terminal native registration rejection recovery, a dated 16-read snapshot with honest fallback labels, native evidence-path confinement, and actual identity/impact recovery receipts. Combined validation: 162 Node tests; 37 pinned-Lean proof-gate and direct consensus tests; static build; unchanged frozen contract/policy. The earlier full 75-test Python/native suite remains applicable to unchanged contract source. PR #11 recovery will inspect its existing transaction once after this cut is live; no duplicate broadcast or new reward is authorized by that recovery.
