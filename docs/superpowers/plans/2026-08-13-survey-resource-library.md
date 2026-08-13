# Survey Resource Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed Survey redirect with a questionnaire/template resource library whose cards open the existing questionnaire designer or a dedicated template editor.

**Architecture:** Keep the route pages thin and render one client-side `SurveyResourceLibrary` from typed local prototype data. Reuse the signed five-step workflow for questionnaire cards and reuse its report-template editor inside a small dedicated template shell. URL query state remains the source of truth for the selected resource tab.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, shadcn-style UI primitives, Vitest, Testing Library.

## Global Constraints

- Implement only mock UI and frontend navigation; add no HTTP API or persistence.
- Preserve the existing questionnaire workflow at `/studio/survey/:surveyId?step=design`.
- Template cards open `/studio/survey/templates/:templateId` and return to `/studio/survey?tab=templates`.
- Provide loading, empty, error and responsive states without new dependencies.
- Use stable `data-testid` selectors for verification.

---

### Task 1: Resource library behavior contract

**Files:**
- Create: `apps/web/tests/ui/survey-resource-library.test.tsx`
- Create: `apps/web/lib/survey/resource-library.ts`

**Interfaces:**
- Produces: `SurveyResourceTab`, typed survey/template card records, filters and count helpers.
- Consumes: no server API; all records are local prototype data.

- [ ] Write failing tests for the default questionnaire tab, template-tab URL synchronization, questionnaire navigation, template navigation, search filtering and all three page states.
- [ ] Run the focused test and confirm failure because the resource-library component is absent.
- [ ] Add the minimum typed mock model needed by the tests.

### Task 2: Resource library screen

**Files:**
- Create: `apps/web/components/survey/resource-library/survey-resource-library.tsx`
- Modify: `apps/web/app/studio/survey/page.tsx`

**Interfaces:**
- Consumes: `SurveyResourceTab`, local resource records, `useRouter`.
- Produces: stable `survey-resource-*` test IDs and card navigation.

- [ ] Implement the two left navigation entries, contextual filters and questionnaire/template card grids.
- [ ] Keep `tab=templates` synchronized with router navigation while `/studio/survey` remains the canonical questionnaire tab.
- [ ] Implement loading, empty and error variants selected by `state` query input.
- [ ] Run the focused test until green.

### Task 3: Dedicated template editor and return routes

**Files:**
- Create: `apps/web/components/survey/templates/survey-template-editor-shell.tsx`
- Create: `apps/web/app/studio/survey/templates/[templateId]/page.tsx`
- Modify: `apps/web/components/survey/workflow/survey-workflow-shell.tsx`
- Modify: `apps/web/tests/ui/survey-workflow-shell.test.tsx`

**Interfaces:**
- Consumes: existing `createSurveyWorkflowMock` and `ReportTemplateStep`.
- Produces: dedicated template editor route and working list return buttons.

- [ ] Add failing tests for questionnaire return and template return.
- [ ] Implement questionnaire return with `router.push('/studio/survey')`.
- [ ] Implement the template shell with return to `/studio/survey?tab=templates` and reuse the existing per-section report-template editor.
- [ ] Run both focused test files until green.

### Task 4: Verification and evidence

**Files:**
- Use: `phases/phase-02-visible-outcomes/design-deltas/survey-resource-library/ui-preview/*.png`

**Interfaces:**
- Consumes: implemented local pages.
- Produces: automated and visual verification evidence for issue #1107.

- [ ] Run focused Survey tests, web typecheck and design lint.
- [ ] Start the worktree app on an unused port and inspect questionnaire list, template list, questionnaire return and template editor return in a browser.
- [ ] Capture current implementation screenshots without replacing the two signed concept images.
- [ ] Run `git diff --check` and review the scope against the design delta.
