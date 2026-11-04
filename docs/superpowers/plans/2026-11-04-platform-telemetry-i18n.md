# Platform Telemetry Internationalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Localize the complete real platform telemetry settings page while preserving consent/reporting behavior.
**Architecture:** Page-owned semantic failure state and a namespace reuse the provider, safe shared HTTP copy and canonical Chinese consent authority. Canonical fixtures support real authenticated consent/history acceptance with reporter disabled.
**Tech Stack:** React, TypeScript, Vitest, Playwright, existing Nest/PG contracts/fixtures.
**Spec:** docs/design/platform-telemetry-i18n/spec.md and verification-design.md.

## Global Constraints

- Issue6237; same worktree/branchworker/i18n-platform-telemetry-6237. Parent715d/PR6234 may be an explicitly unaccepted stack; actual accepted develop fetchedddf must be normally incorporated before gates. Parent pending => Draft stack; actual parent merge => develop target/new CI. First6234 CI failure preempts after protecting WIP.
- Preserve canonical GET/PUT methods, bodies, guards, defaults/version, reporter worker/transport/timing and raw report JSON/IDs/epochs. No production API/contracts changes.
- Chinese consent copy remains single-source from TELEMETRY_CONSENT_COPY. English is display localization only; locale never enters data effects or resets save state.
- Root alone runs Git/native gates/resources/evidence. All heavy commands and normal hooks/commits require fresh sole peer handoff; actual exit/owned cleanup then immediate release before archival. No new worktree.
- Canonical browser120s/expect20s/workers1/retries0 and startup budgets remain unchanged. Raw artifacts private; only individually reviewed final PNGs/curated receipts public. Test reporter disabled; no actual sending claim.

## Review Focus

- Locale changes during deferred settings/last-report/PUT keep pending ownership and exact call counts.
- All four independent flags and authoritative server response survive failure/reload; only one item is written by each UI action.
- Contract-owned privacy/consent wording and omitted labels stay faithful and exhaustive, without copied Chinese facts or JSON localization.
- API schema parsing versus raw JSON property order must not create a false byte oracle.
- Full375/1280 label/control bounds and the existing JSON scroll panel must not hide clipping or global overflow.

### Task 1: Complete page localization and semantic component acceptance

**Files:** modify apps/web/components/admin/telemetry-settings-screen.tsx; create apps/web/lib/i18n/namespaces/telemetry-settings.ts and tests/ui/telemetry-settings-i18n.test.tsx; register in messages/en.ts and zh-CN.ts. Existing tests/ui/telemetry-settings-screen.test.tsx remains byte-preserved unless a specifically obsolete display assertion must be minimally strengthened. Root alone owns any actually required one-file ratchet reduction; there is currently no telemetry baseline entry.

**Interfaces:** consume instanceTelemetry operations/enums/defaults/copy and useI18n/httpFailureText; preserve existing test IDs and exported TelemetrySettingsScreen({state}). Produce translated semantic display without new runtime/API abstractions.

- [ ] Read spec, actual source/contracts/controller, existing three tests and namespace patterns.
- [ ] StageA tests only: meaningful English/locale transitions after real mocked branch entry, deferred GET/PUT ownership/exact counts, all reporter/outcome states, one-key PUT/independent flags, known/unknown/network/server failures, omitted labels/date and exact raw JSON. Use installed matcher APIs; no nonexistent namespace import or invalid fixture counts as RED.
- [ ] Stop for root's native intended RED before any production edit.
- [ ] StageB minimum page/namespace implementation; semantic failures translate onrender, locale stays out of effects, contract Chinese is referenced, booleans/raw data/behavior unchanged. Perform consolidated page width/label/truncate audit.
- [ ] Root runs focused tests + existing three/resources GREEN, scoped lint/type/init and actual raw-error checks; commit and independent task review.

### Task 2: Canonical real consent/history browser acceptance and publication

**Files:** existing apps/web/e2e/entity-localization-fixture.ts, entity-localization.spec.ts, playwright.fullstack-smoke.config.ts and apps/api/scripts/fixtures/seed-entity-localization.ts only; root owns docs/evidence/publication. Preserve all original fixture/case/import/environment bytes except strictly additive wiring.

**Interfaces:** consume Task1 IDs/copy and parent PLATFORM_MEMBERS_E2E accounts; canonical settings/PUT/last-report schemas and real login. One synthetic history authority plus optional validated seed, test-only disabled reporter.

- [ ] Finalize actual history shape and seed/reset support; no expected mutation outcomes or raw installation secret output. Preserve all existing actors/cases/environment values and evaluate canonical raw JSON order correctly.
- [ ] Append real UI/API/PG journey per verification-design, exact statuses/methods/schemas/readback/reloads and operator/ordinary/revoked roles; plan16 viewport images and strong label/control bounds.
- [ ] Root runs source/API/web/static/discovery/init gates then one native canonical case, records actual exit/cleanup and releases peers before QA.
- [ ] Individually inspect all16 images, privacy/dimensions/chunks/hashes; retain every real failure/finding separately and fix boundedly without weakening budgets/assertions.
- [ ] Independent runtime and most-capable final whole-branch review, product-byte binding, canonical credential scan, normal hooks/push and automatic PR. Main owns CI/queue/actual merge; do not mark delivery before actual green integration.
