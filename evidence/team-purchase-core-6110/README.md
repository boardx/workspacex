# #6110 shared Team buying core — work in progress

Branch: worker/team-purchase-core-6110. Baseline origin/develop 001f84d3ab2763b79f18e8e792b20270cb46d5a3 plus accepted provider prep cherry-pick 95b55d6e1 (original 1cbfa2159), then contracts checkpoint 46780598f263f12597048b8016f957a9e762def2. Backend core depends on both checkpoints.

No sales activation, production change, passing status, or end-to-end completion claim. Runtime composition deliberately keeps new sales closed pending complete HTTP, paid admission, UI and independent review.

## Current verified evidence

- `pure-core-green.txt`: 14 pure files / 65 passed. Coverage includes configured quote totals, actual target admin membership/container kind, original-key recovery, original UTC first month, expired first grant zero, commercial mismatch reconciliation decisions, common user/Team ledger core, bounded worker and shutdown drain.
- `pg-checkout-settlement.txt`: 3 real PG cases passed after adding the fixture's actual admin membership. Initial fixture failed `forbidden`; production membership checks were retained.
- `pg-crossowner-all-lanes.txt`: 4 real PG cases passed with personal and legacy monthly/order claim rejection.
- `pg-claim-replay-default-core.txt`: 2 files / 6 real PG cases passed. Team initial purchase under concurrent retries, atomic settlement once, cross-owner claims across personal receipts and legacy monthly/order/paid-period lanes; both new migrations replayed twice over paid facts. Existing default-user credit-period PG case passed unchanged. Wrapper cleanup 1 second, no remaining owned stack.
- `lint:contract-route-coverage` and `lint:rewrite-coverage` passed after five Team routes and exact proxy rules were added.

## Current implementation boundaries

Price/credit facts read `credit_packages`; quote and purchase snapshots freeze those facts. Purchase reserve commits before any provider call, preserves independent checkout deadline, rechecks actual membership/capacity and commercial version in the epoch -> organization -> license -> wallet order. Receipt INSERT triggers claim provider cash globally across account lanes.

Trusted real cash with a mismatch or changed commercial facts is retained for manual reconciliation without rights. Team merchant read verifies merchant, app, attachment and purchase identity, then carries actual amount/currency to settlement for this purpose. A delayed first grant never changes to a later month; expired first grant is zero with no invented ledger. Subsequent current monthly grants derive from the same original-anchor calendar and survive Enterprise until the original paid end.

## Still unverified / incomplete

- `pg-http-admission-baseline-red.txt`: HTTP 2 passed with real PrincipalGuard/PG identity, strict input, configured 7-seat quote, Native checkout, signed merchant read recovery, actual fulfillment and entitlement. The baseline credit-admission negative control correctly failed expiry (1 red); Enterprise and personal defaults passed. The strengthened fixture now uses separate merchant/platform RSA keys, outbound merchant request verification and explicit closed error-envelope assertions; these passed in the final group below.
- `pg-http-edge-replay.txt`: settlement edge 3 and intents/replay/seed 6 passed. HTTP was not run in that first fixture attempt because an invalid fixture role failed setup; the role was corrected to canonical consultant and HTTP then passed separately.
- New bounded due-owner SQL function and seed migration passed the 6-case replay run. The later canonical Team receipt backfill UNION also passed final replay.
- `pg-ai-admission-green.txt`: 3 passed after the real baseline red: paid expiry rejects new Team AI despite permanent cash; old request replay and receipt settlement finish; current Enterprise and default personal requests remain admitted through the existing accounting path. Shared policy/reserve entry points now acquire epoch before old quota/organization/budget locks; pure lock-order negative controls failed before the change and passed afterward.
- `pg-unreserved-http-final.txt`: 2 files / 9 passed, including final HTTP signature/error-envelope checks, Team receipt claim backfill and replay, seed non-overwrite, every shared unreserved-error branch with no new purchase/receipt/ledger/merchant call, and original-key recovery after quote TTL with sales closed. Wrapper command 2m5s, cleanup 2s, no remaining owned stack.
- Full typecheck, normal hooks, real Team UI integration, current paid platform-summary adapter, final sales enable and independent security review remain. No hook/Next/fulltype run without the coordinator's heavy slot.
