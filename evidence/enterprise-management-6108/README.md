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

Verified: init.sh passed; seven upgrade unit cases and five UI component cases passed (logs alongside). These do not substitute for PG/HTTP/browser evidence.

First isolated PG attempt: cold migration exceeded the 60s setup hook; all seven cases skipped. No business pass/fail claim. Wrapper cleaned the stack. Preserved `pg-initial-setup-timeout.txt`; setup allowance raised to 180s based on observed migration duration, awaiting rerun slot.
