# Organization Management V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved organization management UI and personal/enterprise credit rules without discarding historic payments.
**Architecture:** Keep existing authenticated platform APIs and enterprise operation state machine. Add explicit credit-cap accounting independently of Token quota; UI only displays values backed by canonical APIs. Persist payer and monthly cycle per physical request.
**Tech Stack:** Next.js, React, shadcn/Radix, Zod contracts, TypeScript, PostgreSQL, Vitest and Playwright.
**Spec:** `phases/phase-21-billing-payment/design-deltas/organization-management-v2/design.md`; human approval source in adjacent `approval-evidence.md`; issue #6256.

## Global Constraints

Use existing sidebar, fonts, buttons and black/white/warm-grey design tokens. One existing worktree. Ordinary requests use initiator personal credits; enterprise defaults to organization, legal overdraft retained. Null member cap means unlimited, zero means personal; natural month in organization timezone. Preserve immutable request payer, in-flight completion, replay idempotency, personal Pro20k/topups and all historic paid records. No production migration or historic renewal cancellation without a defined compatibility decision. Do not fabricate signoff frontmatter or live balances/caps.

## Review Focus

- Switching org/account while reads are pending must not disclose stale data (Task 1/3).
- Pagination must not filter only the current page while pretending a global type filter (Task 2).
- Generic plan setter must not bypass real enterprise upgrade or pending-operation recovery (Task 3).
- Concurrent cap admissions and month boundaries must preserve one payer and one debit (Task 5).
- Existing paid Team terms, late payments and renewal obligations must not disappear (Task 6).

### Task 1 — approved interaction shell (#6259, first PR)
**Files:** modify `apps/web/components/admin/platform-organizations-screen.tsx`; create focused organization drawer component next to it; tests `apps/web/tests/ui/platform-organizations-screen.test.tsx`. Preserve actual existing data, scope keys and error handling.
**Interfaces:** consume `OrganizationDetail` and `getPlatformOrganization(orgId)`; produce accessible drawer controlled by selected org id and close handler, retaining existing read panels without invented data.
- [ ] Record approval evidence and resolve actual repository bundle-signoff/consistency requirements without faking status.
- [ ] Add failing tests for drawer role, close/Escape/focus restoration, pending-org switch and account scope change.
- [ ] Run isolated focused web UI tests and retain red output.
- [ ] Implement right drawer with existing Sheet primitives, existing design tokens and actual detail reads; remove bottom section.
- [ ] Run focused tests/typecheck/lint within the coordinated local resource window; obtain independent exact-SHA review, normal CI and develop integration.

### Task 2 — canonical organization catalog projection (separate issue/PR)
**Files:** locate and extend `packages/contracts` platformOrganizations operation, platform organization application/repository/controller, `apps/web/lib/live-platform-organizations.ts`, list screen and corresponding API/SQL/UI tests.
**Interfaces:** list query gains optional type=ordinary|enterprise; list row gains nullable enterprise credit balance with explicit applicability. Ordinary balance is inapplicable, never fabricated zero.
- [ ] Create issue and define exact Zod API/UC mapping before source changes.
- [ ] Add red tests for global filtering across cursor pages, tenant/platform authorization and missing/negative enterprise wallet facts.
- [ ] Implement server-side filter and real balance projection, then approved list columns/search/filter.
- [ ] Verify actual PG and UI contracts; independently review and integrate normally.

### Task 3 — one authoritative organization-type entry (separate issue/PR)
**Files:** `enterprise-management-panel.tsx`, `live-enterprise-management.ts`, platform organization screen, canonical enterprise upgrade contract/application/repository and generic setPlan boundary.
**Interfaces:** one type UI invokes existing enterprise upgrade operation with expected version, idempotency and persisted pending recovery; change reason must reach canonical audit. Enterprise-to-ordinary is not enabled by implication.
- [ ] Add red tests for duplicate entries, generic setter bypass, stale version, permissions, lost acknowledgement and account/org-switch recovery.
- [ ] Reuse real upgrade flow, add audited reason contract if absent, remove separate upgrade card while retaining enterprise grant controls.
- [ ] Preserve historical paid grant schedule and real operation needs_review state; independently verify/review/integrate.

### Task 4 — member credit-cap domain, APIs and approved tabs (separate issue/PR)
**Files:** new credit-cap contracts/domain/store/migration under billing and existing org-auth guards; focused member cap panel and own-usage view.
**Interfaces:** credit amounts in canonical smallest unit; cap=null|nonnegative integer, cycle start/end/timezone, used/reserved/resetAt, version. Self API obtains user from authentication; admin list/update requires existing organization admin or explicit platform boundary.
- [ ] Define exact routes/schema and tests for self-only reads, cross-org denial, admin editing, null/zero, precision and CAS.
- [ ] Implement authenticated read/write/audit and approved member table/editor using real data; never repurpose Token quotas as credits.
- [ ] Verify real PG permissions and browser behavior before integration.

### Task 5 — payer selection and concurrency (separate issue/PR)
**Files:** billing payer admission/receipt, new member-cycle counters/holds and shared physical model request paths; real PG concurrency tests.
**Interfaces:** admission stores immutable payer, cycle id and cap version per request; organization usage counters count only organization-funded actual credits. Reservation uses bounded remaining cap; uncertain receipts keep holds.
- [ ] Add red tests: ordinary always personal despite old wallet; enterprise debt allowed; cap null/zero/reached; concurrent remaining cap; stale/replayed request; in-flight overrun and month rollover.
- [ ] Implement ordinary personal and enterprise member-cap selection with fixed payer; keep current request completion and personal negative-balance refusal.
- [ ] Test model/image/audio shared coverage, no split/duplicate debit, unknown-facts refusal, lease lock order and independent security review.

### Task 6 — compatibility and real acceptance (separate issue/PR where changes needed)
- [ ] Inventory historic Team terms, remaining grants, subscriptions, pending/late payments without modifying production.
- [ ] Obtain only necessary outstanding disposition decisions; retain paid rights until a reviewed explicit migration exists.
- [ ] Verify approved UI visually against reference, organization/member permissions, concurrent sessions, in-flight refresh and immutable payer ledger on released version.
- [ ] Update evidence/progress and report tested vs outstanding boundaries; no fake passing or production deployment authorization.
