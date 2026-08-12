# Survey Five-Step Workflow Implementation Plan

**Goal:** Replace the legacy Survey four-tab workspace with the approved five-step UI prototype.

**Architecture:** A canonical query-driven route renders one workflow shell. Five focused steps consume a contract-derived model; selectors derive all repeated counts and gates.

## Tasks

- [x] Add a Zod Survey workflow contract and RED/GREEN tests for the five closed steps and answer referential integrity.
- [x] Add a contract-validated mock model and RED/GREEN tests for derived metrics, publish blockers, and review counts.
- [x] Replace the legacy route with `/studio/survey/[surveyId]?step=...` and a five-step shell.
- [x] Implement design, report template, publish/recovery, response review, and analysis report screens.
- [x] Add loading, empty, error, success, and readonly UI boundaries.
- [x] Verify five direct URLs and 375/768/1280 viewport overflow in a real browser.
- [x] Capture six Survey UI material screenshots and make `lint-ui-material` pass 6/6.
- [x] Create the Survey bundle support material with signoff status left pending.
- [ ] Human confirms Survey bundle UI/use cases/contract and Phase 02 coherence review.
- [ ] After signoff, split F31-F36 real backend integration into individual issue/PR delivery units.

## Verification

```bash
pnpm --filter @repo/contracts exec vitest run tests/survey.test.ts
pnpm --filter @repo/contracts run typecheck
pnpm --filter web exec vitest run tests/survey/survey-mock-structure.test.ts tests/ui/survey-workflow-model.test.ts tests/ui/survey-workflow-shell.test.tsx
pnpm --filter web run typecheck
pnpm --filter web run lint:design
pnpm --filter web run contrast
node .harness/scripts/lint-ui-material.mjs
```

`pnpm -w run verify:base` must be rerun when the shared host load guard admits a stack. The 2026-08-12 attempt was queued before tests because load-per-core exceeded the 2.5 admission threshold.
