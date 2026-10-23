# Unified Credit Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Attribute every model dispatch and debit actual usage once, with an audited global credit preflight switch and recharge guidance.
**Architecture:** Shared durable request boundaries reserve and settle one credit ledger. Model gateway and native/private transports share the same trusted payer and physical-request identity. Ledger transaction commits accompany authoritative usage; unknown usage retains its hold.
**Tech Stack:** TypeScript, NestJS, PostgreSQL, Next.js, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-10-22-unified-credit-consumption-design.md

## Global Constraints
- Reuse this checkout; fetch main before developing. No new worktree.
- 1000 tokens = 1 credit, rounded up per request to 0.01 credit. Integer hundredths internally.
- Global preflight defaults false, is platform-operator writable and audited. False still records real charges and unpaid balance.
- Personal/organization payer is server derived; never cross-wallet fallback. Do not invent token totals for native units.
- Existing quota admission, receipt identity, lease verification, payment snapshots and idempotence stay intact.
- Issue #5877 tracks this delivery. Do not merge or deploy without the established human handoff.

## Review Focus
- Request replay with changed payer/usage must reject, including after lost acknowledgements.
- Concurrent starts cannot overspend active holds; requests in different organizations cannot mix subjects.
- Background/auxiliary/private calls without HTTP or run context need trusted persisted ownership.
- Native duration/quantity or missing token totals cannot be interpreted as zero-price usage.
- Fractional/negative balances must not corrupt existing recharge addition, wire schemas or display.

## Task 1: Financial ledger and precision
Files: application/billing/credit-consumption.ts; infrastructure/billing/pg-credit-consumption.ts; additive migration; billing tests.
Interfaces: `PgCreditConsumption.reserveInSession(s, orgId, start)` and `.settleInSession(s, orgId, usage)` consume durable request metadata/TokenUsageRecord; `CreditConsumptionError` exposes stable code and ownerType/ownerId. `reserveInSession` resolves persisted organization kind, current setting and verified bound; settlements are idempotent under a wallet/request lock.
- [ ] Write and observe failing token rounding, replay, personal/org ownership, concurrency, OFF/debt, unknown usage, zero usage and native tariff tests.
- [ ] Implement exact precision migration, holds, settings/audit, native credit tariffs and consume ledger without changing order snapshots.
- [ ] Run isolated integration tests and recharge regression; retain evidence.
- [ ] Commit independently reviewable financial core.

## Task 2: Runtime coverage and trusted subjects
Files: shared model gateway, token usage repository, per-request observer, private-runtime starts, native services, kernel composition, provider coverage tests.
Interfaces: retain TOKEN_USAGE_METER; add optional trusted max token/native bounds to durable start input; call Task 1 inside existing start/terminal transactions. No second token ledger writer. Ancillary subjects must come from authenticated scope or persisted jobs.
- [ ] Write failing model-gateway tests for main/auxiliary/stream/retry and missing-subject denial.
- [ ] Integrate financial core into every durable start/record path; ensure replay does not overwrite callbacks or create a second receipt.
- [ ] Enable native/local/retrieval accounting independently of old rollout flags, cover direct provider constructions and background jobs.
- [ ] Test dispatch count, receipts and consumption for each supported provider family; maintain explicit live inventory and reject unaccounted dispatches.
- [ ] Commit verified integration.

## Task 3: Contracts, settings API and user actions
Files: packages/contracts/src/billing-consumption.ts, billing-credits.ts; platform operator controller/service; frontend billing/credit guidance and settings UI/tests.
Interfaces: GET /billing/consumption/settings (authenticated); GET and PATCH /platform/billing/consumption/settings (operator), `{creditPreflightEnabled:boolean}`. Wallet fields balance/credits/balanceAfter accept hundredths and signed balances; nonconsumption package/grant amounts remain integers. Structured `credit_required` errors carry ownerType/ownerId and rechargePath; `credit_accounting_unavailable` never becomes recharge advice.
- [ ] Write failing schemas, operator authorization/audit and accessible recharge/action tests.
- [ ] Implement one persisted setting, API, audited toggle and nonsecret authenticated read model.
- [ ] Render debt, fractional usage and negative ledger entries; handle HTTP/SSE/WS errors without clearing user input or retrying automatically.
- [ ] Run API/Web typecheck/lint and affected UI/contract tests.
- [ ] Commit verified user-facing change.

## Task 4: System acceptance and review
- [ ] Review whole branch for privacy, replay identity, concurrent holds, native tariffs, missing subjects and unmetered dispatch.
- [ ] Execute zero-balance ON/OFF, funded personal/org debit, concurrent starts, retry/crash recovery, cancel/partial failure and native pricing integrations.
- [ ] Run existing payment/cancellation tests and real browser recharge guidance; complete per-entry coverage evidence.
- [ ] Update issue/design/plan with tested vs unverified facts; create PR with Refs #5877 and follow checks/review to green.

## Decisions
- 2026-10-22: User explicitly confirmed native-unit tariffs and accounting unpaid amounts with preflight OFF. Proceed with that policy; token conversion is the previously approved contract.
- Financial core, runtime gateway and UI are assigned disjoint file ownership for parallel implementation. Parent owns public contracts/controller integration and cross-layer verification.
