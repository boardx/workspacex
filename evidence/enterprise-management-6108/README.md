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
