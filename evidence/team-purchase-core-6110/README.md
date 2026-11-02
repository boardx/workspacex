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

## Checkpoint after first normal push gate and lifecycle recovery

- First normal push used the unchanged pre-push hook and official Turbo concurrency=1 wrapper. It exited 1 at API `lint-error-leak`: controller read generic Error.message before parsing. No push succeeded; 21/25 tasks completed and canceled type/lint tasks are not passing evidence. Raw output remains `/tmp/team-6110-normal-push-first.txt`.
- Interface now consumes only the application `TeamBillingError.code` closed vocabulary; unknown database/provider details become `dependency_unavailable` before HTTP. Two new boundary tests pass; `lint-error-leak` scans 201 interface files with no leaks.
- `pg-org-recovery-red.txt`: existing edge 3 passed; disabled-cash counterexample failed on `billing_team_receipts_org_frozen_ins`, and disabled new-checkout counterexample failed with the wrong refusal. The disabled branch failed before the missing-org loop could execute.
- `pg-org-recovery-green.txt`: 2 files / 12 real PG cases passed. Both disabled and physically deleted organizations retain actual immutable cash, original global ownership, and manual reconciliation without Plan/term/wallet rights; retry remains identical. Disabled new checkout refuses while the original key recovers. Existing cash mismatch, annual anchor, Enterprise retained grants, cross-owner claims, unreserved errors and forced migration replay remain green. Owned wrapper exited 0, cleanup 2s, exact compose project empty and no owned test processes.
- These new unpublished financial tables retain tenant RLS and immutable-column permissions while financial history outlives organization lifecycle. New quotes/checkouts use the canonical kernel writability function after a real organization lock. Settlement/sweep preserve epoch -> optional organization -> financial locks; missing/disabled organizations cannot receive rights, but cannot prevent authoritative cash retention.
- `pure-core-final.txt`: 15 files / 67 passed after the lifecycle and typed-error changes. Permission-path lint scans 2233 source files successfully. Sales remain deliberately disabled; independent financial review and normal hook rerun are pending.

## Independent financial review: legacy Enterprise generation

Reviewer found that the account read model promoted Enterprise with NULL billing_generation into current Enterprise rights. `legacy-enterprise-entitlement-red.txt` calls the actual PgTeamAccountRepository.entitlement and records that incorrect resolved result (one failure, four existing/current-generation cases passed). The source now derives currentEnterprise from both Plan.plan and exact active generation, rejects legacy Enterprise as dependency_unavailable, and uses that same joint value for the returned licenseStatus. `legacy-enterprise-entitlement-green.txt` has all five affected tests passing, including NULL/retired rejection and current Enterprise's actual complete result. Permission-path drift gate also passes after explicit reviewed digest regeneration. This increment used pure repository tests; previous PG evidence does not establish this new generation behavior. Sales stay closed; exact-source independent review and normal hook remain pending.

## Normal-hook API typecheck corrections

The next unchanged normal push passed 24/25 tasks (21 cache hits) and exited 1 after 11m41.718s at the final API typecheck: the Team recovery worker omitted required LoggerPort traceId/err fields, and four test array accesses lacked strict existence checks. No canceled/failed task was reported passing. Full raw output is `/tmp/team-6110-normal-push-fixtures.txt`.

`worker-log-shape-red.txt` records two actual worker logging failures before correction. Each sweep now owns a random correlation trace and uses the existing closed diagnostic stage under err; no raw dependency detail is added. `worker-log-shape-green.txt` passes the three affected worker cases plus two shared user/Team precision cases. Fixture array access now explicitly fails if the prerequisite quote/wallet call is absent rather than using a non-null assertion. No PG/source financial behavior changed in this increment. Independent incremental review and the subsequent complete normal hook remain required.

The fourth normal push exited 1 at the fixture gate after moving a pure SQL-string probe outside an expect expression. The probe now compares the shared SQL.periodEnsureTeamWallet / SQL.periodEnsureUserWallet authority directly, with an explicit missing-call failure, rather than appearing to execute a literal INSERT. No allowlist or false global-fixture declaration was added. The fixture gate and both affected pure cases pass. All four raw normal-push failure logs are now stored beside this README as normal-push-01 through normal-push-04; no attempt was skipped or reported green.
