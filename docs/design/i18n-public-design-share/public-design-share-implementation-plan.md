# Public Design Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, with one whole-branch independent review at the end.

**Goal:** Localize the complete anonymous frozen design share page without changing snapshot or request semantics.

**Architecture:** Typed namespace plus render-time projection in SharedDesignView. Optional canvas chrome locale uses a separate context; humanTime adds an optional locale without duplicating its time calculation.

**Tech Stack:** React, TypeScript, existing i18n provider, Vitest/RTL, canonical seeded Playwright.

**Spec:** `docs/design/i18n-public-design-share/design.md`

## Global constraints

Only fixed UI/current locale/ARIA/necessary text layout; no API, permission, request, state-machine, raw design/HTML or execution changes. No new WT. Use issue #6260 and target develop. All local gates and normal publication require both peers' fresh sole grant. Raw artifacts stay private0700/0600; no disabled feature activation.

## Review focus

1. Switching locale after navigating must preserve frame/back-stack and never load again.
2. Missing/revoked shares remain indistinguishable and have no retry; temporary failure retries only explicitly.
3. Raw design HTML/srcdoc, labels, owner and chart data must not be translated or remounted.
4. Existing callers retain default Chinese and humanTime's injectable clock/thresholds.
5. Long phone metadata/footer and canvas chrome must be readable without leaking editor actions.

### Task 1: Complete display projection and provider regression

Files: SharedDesignView, PrototypeCanvas, human-time, a new pure `public-design-share` namespace, both message registries, `tests/ui/public-design-share-i18n.test.tsx` and focused time tests.

- [x] Write provider tests with actual typed SharedDesign and real canvas; cover the five review inputs, loading, empty/ungenerated, footer/iframe/chart/board ARIA and old default Chinese.
- [x] Fresh sole: run `WORKSPACEX_WEB_TEST_MAX_WORKERS=1 pnpm --filter web exec vitest run tests/ui/public-design-share-i18n.test.tsx`; expect genuine missing-English assertions, not fixture/collection errors.
- [x] Add minimal render-only namespace/projections after valid RED. Keep load/effect/callback semantics and iframe context unchanged.
- [x] Run new provider suite plus existing `tests/ui/design-share.test.tsx`, canonical resource tests, appropriate existing canvas/time suites discovered by rg, changed-file lint and canonical web typecheck. Expected all selected tests/commands exit0; preserve original warnings.
- [x] Normal safe source checkpoint under fresh grant; update ledger with actual commands/results and immutable source hashes.

### Task 2: Real anonymous flow and publication

- [x] Inspect canonical seeded login/API helpers and design-workbench contract operations. Add one narrowly scoped existing-lane spec: real authenticated create/update/publish, anonymous375/1280 EN/ZH raw snapshot, navigation/locale stability, revoke and missing-link UI. Explicit transient network-abort UI evidence, if added, is labeled fault injection.
- [x] Preserve canonical budgets/retries/workers/dependencies; exact discovery proves selection only. Add namespace registration to the existing messages, not a new runtime lane/config.
- [x] Run necessary source gates and exact canonical discovery under fresh sole; archive only safe receipts.
- [x] One independent whole branch review with existing reviewer; address actionable findings with genuine RED/GREEN and affected suite, no repeated whole reviews.
- [ ] Normal scan/hooks/push Draft PR Closes6260. Follow actual existing PR runtime, native case verdict and every PNG; author owns first failure to green. Main alone queues/merges.
- [ ] Verify actual merge/issue closure, exact own resource cleanup0 and hand off uncovered boundaries to the B3 stage review. Do not claim overall stage completion yourself.
