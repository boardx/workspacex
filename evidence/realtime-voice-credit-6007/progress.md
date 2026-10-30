# Credit billing implementation — 2026-10-30

Confirmed scope: develop is the development and integration target. The user approved inline implementation and skipped agent registration. No registry identity, lease, historical feature passing state or human signoff was fabricated. One worktree was reused throughout.

Implemented: permanent purchased credits; 20,000 monthly paid credits with unused monthly expiry; fixed personal request admission at balance >= 0; admitted request completion into debt; enterprise overdraft; cumulative physical-request token receipts; verified Stripe grants and resumable operator backfill; self and organization consumption queries and UI; trusted realtime voice WebSocket accounting.

Verification: combined payment/usage/voice regression passed 45 files / 398 tests on 8994e4ba7. Actual Next/API/PostgreSQL/loopback merchant browser coverage passed 8 tests for recharge, grant, usage, expiry, personal debt denial and enterprise continuation. These fixtures do not certify production merchant/model charging. After synchronizing existing develop cancellation/management changes, billing/voice UI passed 114 tests; related real PostgreSQL/WebSocket/durable/Stripe revalidation passed 90 tests in 5 files on e7587c3ea (develop-api.md and develop-ui.md).

Independent source review through 8994e4ba7 found no remaining Critical/Important findings. Earlier findings were reproduced and fixed: incomplete backfill inventory, late-fragment ledger query loss, disconnect while admission was pending, discarded unknown terminal receipt, and compatible late terminal diagnostics. Tests and GitHub checks remain the merge authority.

Integration snapshot: task 1 PR #5998, task 2 replacement PR #6008 and subscription grants PR #6009 reached develop (c6440c11e). External concurrent operations subsequently merged #6010/#6011/#6012 into feature branches, so those merges do not deliver their changes to develop. Recovered separate branches are worker/credit-backfill-final, worker/credit-usage-final and worker/realtime-credit-final. Only create the next PR directly against develop after its predecessor is actually merged; no more temporary stacked PRs. Each current head must pass the repository classifier. Final merge outcomes belong in GitHub PR records.

## Rulings retained from the session ledger

- A physical provider voice WebSocket is one admitted request. Distinct server response.done usage accumulates by response ID; browser token reports never authorize charges. A new personal connection at negative balance is refused before opening the provider socket.
- Missing/interrupted usage remains pending. Confirmed partial debit is retained alongside an unknown terminal event; no free completion is fabricated. Transport freezes before the final accounting snapshot.
- Debit queries read immutable financial transactions correlated with the admitted actor/payer and receipt mapping at the query cutoff. Late zero-delta fragments cannot erase an earlier charge or change an older snapshot.
- Late diagnostics only fill missing fields when compatible. Known quantity, identity and known pricing facts remain immutable; conflicting enrichment fails.
- Backfill inventories both subscriptions and bindings, including missing/newer uncertain snapshots. Unmapped, annual, trial and unverifiable records block cutover for an operator decision. No per-user bypass weakens fixed personal admission.
- Backfill uses the authoritative current latest invoice, reviewed monthly plan IDs and the same idempotent grant store as webhooks. Checkpoints bind mode/database/plans/high-water and advance only when a page has no blocked records.
- Existing develop changes were merged into the integration stack, preserving both renewal-credit and cancellation tests/UI behavior. Separate PRs preserve one-feature review scope; no squash merge is used across prerequisite ancestry.
- A batch push was rejected because external merges moved remote refs during pre-push checks. No force push or rollback was used. Recovery merged actual develop into locally verified feature scopes on fresh branch names; git diff confirmed identical final source. Pre-push20/20 typecheck/lint checks passed before the rejection. Future PRs are opened one at a time directly on develop to eliminate feature-base ambiguity.
- Host resource admission was respected during a load spike; no unrelated process was killed and no test isolation or pre-push gate was bypassed.

Production inventory, backfill apply, deployment and main promotion were not performed. See deploy/credit-subscription-migration.md for the required cutover sequence.
