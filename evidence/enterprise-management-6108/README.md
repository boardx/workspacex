# Enterprise management #6108

Baseline: b3e9977de08b056a564058ca0419d85d421fdd4a (develop).

Implementation in progress. No passing claim. Dependencies: signed billing-team contracts,
capacity migration organization_plans.billing_generation. Root accounting generation and epoch helpers were verified at baseline; approved design and capacity commits are explicit local dependencies.

Grant write lock order: active epoch shared lock, organization row, Plan row, wallet.
Grant receipt is itself an immutable tenant audit record, with actor, reason and generation.
Atomic transaction includes wallet update, ledger and immutable audit/idempotency receipt.

Pending verification: HTTP/PG authorization, overflow/audit rollback, version conflict,
recovery and browser evidence. Paid Team provider adapter not yet available; upgrades
must stay dependency_unavailable until verified paid-term and real cancellation facts exist.

Verified: init.sh passed; eight upgrade/absence unit cases and eight UI component cases passed (logs alongside). These do not substitute for PG/HTTP/browser evidence.

First isolated PG attempt: cold migration exceeded the 60s setup hook; all seven cases skipped. No business pass/fail claim. Wrapper cleaned the stack. Preserved `pg-initial-setup-timeout.txt`; setup allowance raised to 180s based on observed migration duration, awaiting rerun slot.

UI error recovery: a definitive overflow originally trapped the request with disabled inputs. Targeted red preserved in `ui-overflow-red.txt`; amount is now editable only after the server definitively rejected that transaction. Unknown network failures still retain the original key and parameters. Latest targeted UI run: 6/6.

Confirmed receipt refresh regression: parent detail refresh used to unmount the financial panel and erase a successful grant receipt. Targeted red retained; same-organization refresh now preserves the panel. Latest UI selection is 7/7.

Prepared (not yet run): two real HTTP cases using bcrypt login, Redis bearer sessions and full Kernel composition; one real browser journey using an isolated API/Next runtime and dedicated catalog credential. These lanes contain no route interception and do not assert merchant settlement.

Signed UI confirmation is wired using the existing Dialog component: a new upgrade/grant request is sent only after confirming the organization and grant facts. Existing uncertain requests retry the original identity. Actual summary wallet balance is displayed without a fabricated default. Targeted confirmation red retained; current UI selection 8/8.

## Current unverified additions

Full paid-Team renewal/retention remains **issue #6116**, outside this deliverable's usable no-Team lane. Any canonical Team license row remains fail-closed.

Added authenticated-session recovery: canonical original request is held in sessionStorage under actor + target organization + bearer SHA256 fingerprint. Raw tokens are not stored. Mount/reload restores parameters only; it never posts automatically. Explicit retry uses the original request; identity/organization changes unmount the old panel. New recovery/error cases expand UI selection to 11; these additions have **not yet run**. Last executed UI output is the preceding 8-case selection.

Current owned backend selection is 19 targeted cases: Enterprise PG 7, precision PG 8, real HTTP 2, two generator-source checks. Admission was interrupted at the coordinator's instruction before any stack/Vitest startup; `pg-admission-interrupted.txt` is queue output, not verification. Wait for an explicit resource release; do not allow admission timeout to force-start under load. No full typecheck/browser is running.

Browser acceptance now includes a deterministic test-only transport fault after the real grant commit: the runtime closes the first successful response, then the real browser reloads and explicitly retries the same key. Actual wallet/ledger/audit must remain unchanged by replay. This is a real backend plus a fault-injection runtime, not a merchant-payment or production-deployment claim. Browser run is still pending.

## Independent review follow-up (pending execution)

- Response correlation: a schema-valid grant must still match requested organization/credits; upgrades also match requested version and known authenticated actor; operation reads match organization/reference. Mismatches remain unknown and retain the original request. Detail reads bind the returned organization before it can become a financial target. Seven pure client counterexamples are prepared.
- Cache policy: the three financial operations and the existing directory reads now carrying real wallet data use `private, no-store`; the existing filter applies it before guard failures too. Only the three new routes convert their reviewed permission code to the Team billing envelope; legacy directory error semantics remain unchanged. Real HTTP assertions cover success and 403.
- Session transitions: financial requests pass the captured bearer instead of silently selecting another account's current global token; directory state uses the existing authenticated session scope to unmount old financial read data.

These source changes have not run while the coordinator's one normal push group owns heavy resources. Planned next selections: owned backend 19, UI recovery 11 plus pure client 7, then a separate browser slot. No standalone typecheck has been started.

## Verified batches and retained-history review

On the preceding schema/source: `backend-19.txt` exited 0 (Enterprise PG 7 + precision PG 8 + authenticated HTTP 2 + source checks 2), and `ui-client-final.txt` exited 0 (UI 11 + client correlation 7). The owned stack was removed; a precise compose-label `docker ps -a` check returned no containers. Raw logs were scanned for bearer/DSN/password/sessionToken fields with no matches.

Independent review then rejected adapting financial audit retention to fixture deletion. The unpublished 032000 migration now removes the two organization FKs, matching wallet/ledger historical retention; the permanent audit UPDATE/DELETE rejection and app_rw privileges remain unchanged. Live service writes/reads still lock and verify the organization. Runtime source search found no organization-delete API. A new eighth PG case proves owner tenant teardown retains grant/ledger/operation history, direct audit mutations remain rejected before/after teardown, deleted-org service operations return not-found, and another org is unchanged. It also declares exact owned fixture IDs retained until the disposable database is destroyed.

This retention delta has not run. `vitest.enterprise-retention-pg.config.ts` selects the eight cases with the actual default `db-file-cleanup` hook and isolation global setup for a sequential warm-stack follow-up. No trigger disabling/replica mode, CASCADE exception or cold rerun of the verified 19 is used. Database-backed dedicated configs now require the existing isolation global setup, so a bare shared-DB invocation fails before fixture mutation.

## Warm browser sequence prepared (not executed)

The dedicated Playwright runtime will migrate one owned stack. Its global setup then runs the retention PG 8 and authenticated HTTP 2 with the real default seeded-organization cleanup hook, sequentially, before the browser journey. Both fixture files preserve and restore their entry epoch marker, so the default suite cannot leak activation and the browser's pre-seeded active marker is preserved. Runtime financial history remains declared by exact owned IDs until database destruction.

The browser journey uses the real UI and backend with a single test-runtime response loss after COMMIT, then reloads and explicitly retries the original request. An optional coordinator-supplied `ENTERPRISE_INVENTORY_SQL_SMOKE` draft is read only in global teardown after a fresh success marker for this isolation ID. It runs via trusted asOwner with default transaction read-only and row_security off, recording an isolated syntax-smoke result; it is never a remote inventory or a data-cleanup claim. No stack is created for that optional draft.
