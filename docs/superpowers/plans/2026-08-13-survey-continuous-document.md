# Survey Continuous Document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make questions and report chapters continuously scrollable while keeping left navigation as synchronized anchors, and persist an independent output mode plus chart type for every report-template chapter.

**Architecture:** Add one small client hook that owns anchor scrolling and visible-section synchronization, then consume it in the design and report steps. Keep the Survey workflow model as the single source of template state by extending the section schema with optional `chartType` and passing `setModel` into the template editor.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Zod, Vitest, Testing Library.

## Global Constraints

- Preserve the existing five-step Survey route and responsive shell.
- Do not add dependencies or real HTTP operations.
- Keep the existing signed Survey contract unchanged; implement against the confirmed `survey-continuous-document` design delta.
- Write failing behavior tests before production changes.

---

### Task 1: Continuous navigation behavior tests

**Files:**
- Modify: `apps/web/tests/ui/survey-workflow-shell.test.tsx`

**Interfaces:**
- Consumes: `SurveyWorkflowShell` and its public `initialStep` prop.
- Produces: assertions for all-question/all-section rendering, anchor navigation, and independent template output settings.

- [ ] Add a test that renders the design step, proves Q01 and Q16 coexist, clicks the Q16 directory button, and observes `scrollIntoView` on the Q16 card.
- [ ] Add a test that renders the report step, proves summary and boundary chapters coexist, clicks the gap directory button, and observes `scrollIntoView` on the gap section.
- [ ] Add a test that selects chart/radar for one template chapter, text for another chapter, then switches back and observes the first chapter's independent selection.
- [ ] Run `pnpm --filter web test -- survey-workflow-shell.test.tsx` and confirm the new tests fail because continuous cards and editable chapter output settings do not exist.

### Task 2: Survey model and scroll-navigation primitive

**Files:**
- Modify: `packages/contracts/src/survey.ts`
- Modify: `apps/web/lib/survey/workflow-model.ts`
- Create: `apps/web/components/survey/workflow/use-section-navigation.ts`

**Interfaces:**
- Produces: `SurveyChartTypeSchema`, optional `SurveyReportSection.chartType`, and `useSectionNavigation(ids)` returning `activeId` plus `navigateTo(id)`.
- Consumes: stable question and report section IDs already present in the Survey model.

- [ ] Extend the schema with the five signed chart-type enum values and add literal chart defaults to chart-output mock sections.
- [ ] Implement reduced-motion-aware `scrollIntoView` navigation.
- [ ] Observe visible anchors with `IntersectionObserver` and synchronize `activeId`; safely retain click navigation where the API is unavailable.
- [ ] Run contract typecheck and the focused UI test to confirm the model compiles while view tests remain red.

### Task 3: Continuous question editor

**Files:**
- Modify: `apps/web/components/survey/workflow/survey-design-step.tsx`

**Interfaces:**
- Consumes: `useSectionNavigation`, `model.questions`, and `setModel`.
- Produces: stable `survey-design-question-Qxx` cards and `survey-design-nav-Qxx` anchor buttons.

- [ ] Render one editor card per question in model order with unique input labels.
- [ ] Make directory buttons call `navigateTo`, add `aria-current="location"`, and keep active styling synchronized.
- [ ] Update individual questions by ID without affecting neighboring cards.
- [ ] Keep the AI panel aligned to the active question and preserve readonly behavior.
- [ ] Run the focused test and confirm the design behavior is green.

### Task 4: Per-section report output settings

**Files:**
- Modify: `apps/web/components/survey/workflow/survey-workflow-shell.tsx`
- Modify: `apps/web/components/survey/workflow/report-template-step.tsx`

**Interfaces:**
- Consumes: `setModel` and `SurveyReportSection.chartType`.
- Produces: `survey-template-output-*` and `survey-template-chart-type-*` controls whose values are scoped to the selected section.

- [ ] Pass `setModel` to the template step and update only the selected report-template section.
- [ ] Make text/chart/image controls interactive and disabled in readonly mode.
- [ ] Conditionally render all five signed chart types only for chart output.
- [ ] Reflect both output mode and chart type in the right preview.
- [ ] Run the focused test and confirm independent section state is green.

### Task 5: Continuous analysis report

**Files:**
- Modify: `apps/web/components/survey/workflow/analysis-report-step.tsx`

**Interfaces:**
- Consumes: `useSectionNavigation` and `model.report.sections`.
- Produces: stable `survey-report-section-*` anchors while retaining summary-only evidence components.

- [ ] Render every report section inside one article in template order.
- [ ] Make TOC buttons navigate to anchors and expose the current location through styling and `aria-current`.
- [ ] Keep summary cards, gap table, and fact/inference/recommendation callouts inside the summary section.
- [ ] Run the focused test and confirm report navigation is green.

### Task 6: Verification and visual evidence

**Files:**
- Update: `phases/phase-02-visible-outcomes/ui-preview/survey-v2/01-design.png`
- Update: `phases/phase-02-visible-outcomes/ui-preview/survey-v2/02-template.png`
- Update: `phases/phase-02-visible-outcomes/ui-preview/survey-v2/05-report.png`

**Interfaces:**
- Consumes: the running local app at `/studio/survey/sv-1`.
- Produces: current screenshots and executable verification evidence.

- [ ] Run `pnpm --filter web test -- survey-workflow-shell.test.tsx`.
- [ ] Run `pnpm --filter web typecheck` and `pnpm --filter @repo/contracts typecheck`.
- [ ] Run the Survey model and route tests plus design lint.
- [ ] Inspect design, template, and report steps in a browser at desktop and narrow widths; exercise directory jumps and per-section persistence.
- [ ] Replace the three affected signed screenshots with the verified UI.
- [ ] Run `git diff --check`, review scope, and commit the implementation with its tests and evidence.
