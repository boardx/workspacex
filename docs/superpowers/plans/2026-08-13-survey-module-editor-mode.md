# Survey Module Editor Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make questionnaire-module creation and editing show only the question editor, without the five-step workflow timeline.

**Architecture:** Reuse `SurveyWorkflowShell` and introduce an explicit `mode=module` route flag. The shell derives a module-editor presentation that hides workflow navigation and returns to the module list, while the standard survey workflow remains unchanged.

**Tech Stack:** Next.js 14, React, TypeScript, Vitest, Testing Library.

## Global Constraints

- Ordinary survey creation and editing must retain the five-step workflow.
- Module creation and module-card editing must preserve the selected module in the URL.
- No new dependencies.

---

### Task 1: Module editor routing and presentation

**Files:**
- Modify: `apps/web/components/survey/resource-library/survey-resource-library.tsx`
- Modify: `apps/web/app/studio/survey/[surveyId]/page.tsx`
- Modify: `apps/web/components/survey/workflow/survey-workflow-shell.tsx`
- Test: `apps/web/tests/ui/survey-resource-library.test.tsx`
- Test: `apps/web/tests/ui/survey-workflow-shell.test.tsx`

**Interfaces:**
- Consumes: query parameters `mode=module` and optional `module=<chapterId>`.
- Produces: `moduleEditor: boolean` passed to `SurveyWorkflowShell`.

- [ ] **Step 1: Write failing route tests**

Assert that the new-module button routes to `/studio/survey/new?step=design&mode=module`, a module card routes to `/studio/survey/new?step=design&mode=module&module=profile`, and module-editor rendering has no `survey-workflow-steps`.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter web exec vitest run tests/ui/survey-resource-library.test.tsx tests/ui/survey-workflow-shell.test.tsx`

Expected: failures caused by missing `mode=module` and the still-visible timeline.

- [ ] **Step 3: Implement the minimal module-editor mode**

Parse `mode` in the route, pass `moduleEditor`, hide the workflow navigation in that mode, return to `/studio/survey?tab=modules`, and preserve both `mode` and `module` when applicable.

- [ ] **Step 4: Verify focused and regression tests**

Run: `pnpm --filter web exec vitest run tests/ui/survey-resource-library.test.tsx tests/ui/survey-workflow-shell.test.tsx tests/ui/survey-template-editor-shell.test.tsx`

Expected: all tests pass; ordinary survey test still renders `survey-workflow-steps`.

- [ ] **Step 5: Run static verification**

Run: `pnpm --filter web exec tsc --noEmit --incremental false && pnpm --filter web lint:design && git diff --check`

Expected: exit code 0.

