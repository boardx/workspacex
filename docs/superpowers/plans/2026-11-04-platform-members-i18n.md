# Platform Members Internationalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Completely localize the real platform members screen, preserving canonical permission and mutation behavior.
**Architecture:** Page-owned semantic display state and namespace use the existing i18n provider, shared role keys and HTTP fallback. Canonical fixture prerequisites support a real API/PostgreSQL browser journey.
**Tech Stack:** React, TypeScript, existing i18n, Vitest, Playwright, Nest/PG fixtures.
**Spec:** docs/design/platform-members-i18n/spec.md; verification-design.md provides the proposed real-case matrix.

## Global Constraints

- Issue6224, one PR targeting develop; reuse this worktree. Quota6227 has actually merged as4b3263aa; this branch reuses that accepted baseline. Main owns CI/queue/merge; root repairs the first actual failure.
- No changes to production API/contracts/guards, role IDs, request paths/bodies, mutation timing, locale-independent data effects or existing role-authority derivation.
- Preserve raw names/emails/organization names/braces, canonical timestamps and numeric values. Translate known semantic causes on render; private exception detail must not become product copy.
- Keep existing 4000ms notice lifetime; locale switches must not reset the timer, refetch the roster, restart a mutation or clear an open selection.
- GET/PATCH use PlatformOperatorGuard; POST/DELETE require PlatformSuperuserGuard. Same reasonCode is rendered by operation context. Do not invent a confirmation dialog.
- Reuse shared role.* and adminNavigation.item.platform keys; new page meaning belongs to one namespace. Loading/empty/denial/failure remain distinct.
- All heavy tests/type/lint/build/init/browser/push hooks are root-only and serialized with FIRST/SECOND. Workers may inspect/write files only until root grants an actual gate.
- Native browser budgets/retries remain unchanged; no forceclick/mutation interception/auth bypass. Never upgrade existing ordinary fixture actors to platform superuser.
- Raw artifacts remain private; only curated receipts and individually inspected final images are committed.

## Review Focus

- Deferred replies and locale switches preserve pending ownership and exact request counts.
- Banner role labels and raw names retranslate without resetting the4000ms timer.
- Platform operator permission differs from superuser grant/revoke; failure copy must respect operation context.
- Unknown/network/server failures never leak exception strings or masquerade as an empty roster.
- Narrow viewports retain long names, popover items, action labels and inline errors.

### Task 1: Complete page localization and semantic component acceptance

Own `apps/web/components/admin/platform-members-screen.tsx`, a small page-owned helper if useful, new `lib/i18n/namespaces/platform-members.ts`, en/zh registries, new `tests/ui/platform-members-i18n.test.tsx`, and minimal semantically necessary updates to existing `admin-platform-members.test.tsx`. Avoid general layout redesign or unrelated refactors.

- [x] Read the spec, actual screen/SDK/guards and existing9 mocked-fetch cases; retain existing behavior assertions.
- [x] StageA: write meaningful English/locale-transition failing tests only. Cover full text/roles/count/dates/raw braces; deferred load/pending; known LAST_ADMIN/MEMBER_NOT_FOUND/operation-specific403, unknown/network/server failures; exact path/body/no extra calls; semantic success notice and fake-timer4000ms lifetime; actual superuser/operator/ordinary display matrix.
- [x] Stop for root to run one native intended RED gate before production edits. Report exact test names and files; no import/collection failure counts as RED.
- [x] StageB: minimum production implementation. Translate all visible page copy/controls/aria/empty/error/status, use shared roles/date display, retain canonical actions and semantic failure/notice state. Locale stays out of request effects; expiry depends on notice identity only.
- [x] Root runs same tests GREEN plus existing9/resource checks, scoped lint/type/init as appropriate. Supply files/risks and self-review; root commits then independent task review.

### Task 2: Canonical real-role browser acceptance and delivery

Own canonical entity-localization fixture, API fixture seed, fullstack env mappings and existing entity-localization browser chain. Use dedicated synthetic superuser plus dedicated target and two private organizations per verification-design.md; preserve every old actor credential/membership/login context and all existing cases. Finalize the proposed16-image matrix against actual controls and route before implementation. Root owns all commands/Git/resources/evidence.

- [x] Add fixture prerequisites only, wire synthetic email to actual API superuser env setting, never seed expected platform_admin mutation outcomes.
- [x] Add real case: locale continuity; exact PATCH/readback/reload; actual LAST_ADMIN409 and unchanged state; UI grant/readback; operator role mutation allowed, protected POST/DELETE403; UI revoke/readback, revoked GET403; ordinary-admin page denial. Parse strict canonical response schemas and use independent readbacks.
- [x] Root runs relevant static/focused/type/init/testID/discovery gates, then one native original case under canonical isolation/budgets. Record actual exit and cleanup all owned containers/volumes/listeners; release peer slot immediately before archival/QA.
- [x] Inspect every planned final image. Fix actionable findings with scoped counterexamples; preserve original failed evidence truthfully and do not claim external-model or whole-project coverage.
- [ ] Independent task and final whole-branch reviews, canonical tracked credential scan, normal hooks/push, automatically create PR Closes6224. Main exclusively owns CI/queue/merge; root repairs first real failure, no passing claim before actual delivery.

## Actual validation and delivery boundary

Product source6eec6508908617d54a168241ada9a35fb6f4bbc5, browser freeze28059050e6315e8ab3384ca10569811e89fdfe67. Canonical real API/PG case passed17.903s (runner445.258s), retry/skip/flaky0. Root individually inspected all16 final375/1280 viewport images and accepted them. Exact receipts, historical first failure/second visual findings, final image hashes and independent reviews are in evidence/platform-members-i18n-6224/.

Interrupted-grant reseeding remains source-reviewed only; no native restart claim. CI/queue/server merge remain main-owned; delivery is pending an actual green merge. No wholeB8/B4/B7/B9, model, billing or deployment completion is asserted.
