# Survey AppShell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the WorkspaceX global rail and Survey secondary navigation visible across Survey lists and editors.

**Architecture:** Add one route-level `SurveyAppShell` wrapper under `/studio/survey`, with a focused secondary navigation component. Strip duplicate full-page chrome from Survey content components so they render only inside `AppShell`'s main region.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- Do not change Survey mock data or workflow behavior.
- Reuse `AppShell`, `IconRail`, and existing design tokens.
- The Survey secondary menu contains exactly three entries.
- All Survey child routes share the same shell.

---

### Task 1: Shared Survey shell and navigation

**Files:**
- Create: `apps/web/components/survey/shell/survey-app-shell.tsx`
- Create: `apps/web/app/studio/survey/layout.tsx`
- Test: `apps/web/tests/ui/survey-app-shell.test.tsx`

**Interfaces:**
- Produces: `SurveyAppShell({ children }: { children: React.ReactNode })`
- Consumes: `AppShell`, `mockIdentity`, `usePathname`, `useSearchParams`

- [ ] Write a failing test asserting global rail, shell left panel, exactly three Survey nav entries, and child content coexist.
- [ ] Run the focused test and confirm it fails because no route shell exists.
- [ ] Implement `SurveyAppShell` and the route-level layout with pathname/query-based active states.
- [ ] Run the focused test and confirm it passes.

### Task 2: Convert Survey screens into shell content

**Files:**
- Modify: `apps/web/components/survey/resource-library/survey-resource-library.tsx`
- Modify: `apps/web/components/survey/workflow/survey-workflow-shell.tsx`
- Modify: `apps/web/components/survey/templates/survey-template-editor-shell.tsx`
- Test: `apps/web/tests/ui/survey-resource-library.test.tsx`
- Test: `apps/web/tests/ui/survey-workflow-shell.test.tsx`
- Test: `apps/web/tests/ui/survey-template-editor-shell.test.tsx`

**Interfaces:**
- Consumes: the route-level `SurveyAppShell`
- Produces: content-only list and editor roots that fit `shell-main`

- [ ] Update tests to reject duplicate BoardX Survey full-page chrome and require content roots.
- [ ] Run tests and confirm they fail against existing full-page components.
- [ ] Remove duplicate global header/sidebar wrappers while preserving buttons, cards, editor navigation, and return behavior.
- [ ] Run all Survey UI tests and confirm they pass.

### Task 3: Verification and delivery

**Files:**
- Verify only; no additional product files unless a failing check identifies a scoped defect.

**Interfaces:**
- Consumes: Tasks 1 and 2
- Produces: test, typecheck, lint, and browser evidence

- [ ] Run all Survey UI tests.
- [ ] Run `pnpm --filter web exec tsc --noEmit --incremental false`.
- [ ] Run `pnpm --filter web lint:design` and `git diff --check`.
- [ ] Start an isolated Next dev build and verify list plus editor routes retain both navigation columns.
- [ ] Commit, request independent exact-SHA review, push, and open a PR that closes issue #1151.
