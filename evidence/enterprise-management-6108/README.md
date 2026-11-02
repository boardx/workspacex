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
