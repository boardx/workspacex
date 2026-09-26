# Deep Research Reference Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the six-stage Deep Research desktop UI around the supplied reference while retaining WorkspaceX global navigation and the existing trustworthy research runtime.

**Architecture:** The shared shell will remove its duplicate research navigation and compose a stage-specific canvas beside the WorkspaceX rail. Small presentational stage panels consume the established runtime/draft state from `GuidedResearchLive`; all mutations keep using the existing structured commands and Markdown adapter. The existing report, sources, and trust-console components remain authoritative domain surfaces and are rearranged rather than reimplemented.

**Tech Stack:** Next.js, React, TypeScript, Tailwind, shadcn/ui, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-deep-research-six-step-markdown-ui-design.md`

## Global Constraints

- Do not introduce a second research-specific left navigation; WorkspaceX global navigation remains the sole left rail.
- Preserve runtime graph/version checks, server-owned evidence, source IDs, citations, conflict resolution, and resume behavior.
- Markdown remains the inspectable artefact; structured runtime commands remain the sole persistence path.
- Use existing semantic tokens, shadcn components, typography scale, and Tailwind spacing; no hard-coded colors, arbitrary pixels, or bare form controls.
- Every stage retains truthful loading, empty, error, disabled, and conflict states where applicable.
- Desktop reference fidelity is the primary acceptance target; 375px, 768px, and 1280px must not horizontally overflow.

## Review Focus

- A historical-stage visit must highlight the viewed step without treating it as a server checkpoint change — covered by Task 1 UI test.
- A brief Markdown save must survive reload because it dispatches the structured `save` command — covered by Task 2 UI test.
- Upload and voice entry points must truthfully state unavailable integration rather than simulate an attachment or transcript — covered by Task 2 UI test.
- A failed source task or evidence conflict must remain visible in the reference-style research layout — covered by Task 4 UI test.
- A report with incomplete evidence must keep its readiness limitation visible beside the report body — covered by Task 5 UI test.

---

### Task 1: Simplify the shared workflow shell

**Files:**
- Modify: `apps/web/components/research-studio/guided-research-six-step-shell.tsx`
- Modify: `apps/web/tests/unit/guided-research-six-step.test.tsx`

**Interfaces:**
- Consumes: `GuidedResearchVisualStage`, `GUIDED_RESEARCH_SIX_STEPS`, `onNavigate(stage)`.
- Produces: `GuidedResearchSixStepShell` with no internal research navigation and an optional assistant column only when `assistant` is supplied.

- [ ] **Step 1: Write failing shell tests**

Assert `研究导航` and `研究档案` are absent, six step buttons remain present, and the no-assistant desktop shell contains no reserved third column.

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `pnpm --filter web exec vitest run tests/unit/guided-research-six-step.test.tsx`

Expected: FAIL because the legacy Deep Research navigation still renders.

- [ ] **Step 3: Remove the duplicate rail from `GuidedResearchSixStepShell`**

Keep only the step bar and main canvas; use `cn` to select one- or two-column layouts based on `assistant`.

- [ ] **Step 4: Run the shell test to verify it passes**

Run: `pnpm --filter web exec vitest run tests/unit/guided-research-six-step.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/research-studio/guided-research-six-step-shell.tsx apps/web/tests/unit/guided-research-six-step.test.tsx
git commit -m "refactor(research): remove duplicate workflow navigation"
```

### Task 2: Compose reference-style import and topic-confirmation stages

**Files:**
- Create: `apps/web/components/research-studio/guided-research-entry-panel.tsx`
- Create: `apps/web/components/research-studio/guided-research-topic-panel.tsx`
- Modify: `apps/web/components/research-studio/guided-research-live.tsx`
- Test: `apps/web/tests/ui/guided-research-reference-layout.test.tsx`

**Interfaces:**
- Consumes: the brief `GuidedResearchRuntimeDraft`, `GuidedResearchMarkdownWorkspace`, `onSave(markdown)`, and existing `GuidedResearchConversation`.
- Produces: `GuidedResearchEntryPanel` and `GuidedResearchTopicPanel`, each with stable stage test IDs.

- [ ] **Step 1: Write failing stage tests**

Assert the import stage exposes text, upload, and voice choices with explicit unavailable states, and the topic stage renders the Markdown brief plus a right-side assistant region whose suggestion requires explicit apply.

- [ ] **Step 2: Run the stage test to verify it fails**

Run: `pnpm --filter web exec vitest run tests/ui/guided-research-reference-layout.test.tsx`

Expected: FAIL because these reference-specific panels do not exist.

- [ ] **Step 3: Implement the two panels and compose them in `GuidedResearchLive`**

Use the existing Markdown save callback and conversation handlers; do not add new persistence APIs. Use disabled buttons and explanatory copy for integrations that are not configured.

- [ ] **Step 4: Run the stage test to verify it passes**

Run: `pnpm --filter web exec vitest run tests/ui/guided-research-reference-layout.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/research-studio/guided-research-entry-panel.tsx apps/web/components/research-studio/guided-research-topic-panel.tsx apps/web/components/research-studio/guided-research-live.tsx apps/web/tests/ui/guided-research-reference-layout.test.tsx
git commit -m "feat(research): align brief stages with reference layout"
```

### Task 3: Present the research-plan stage as the reference plan workspace

**Files:**
- Create: `apps/web/components/research-studio/guided-research-plan-panel.tsx`
- Modify: `apps/web/components/research-studio/guided-research-live.tsx`
- Test: `apps/web/tests/ui/guided-research-reference-layout.test.tsx`

**Interfaces:**
- Consumes: directions/outline drafts, `GuidedResearchMarkdownDocument`, `ResearchDirectionsEditor`, `ResearchOutlineEditor`, and intent plan state.
- Produces: `GuidedResearchPlanPanel` with plan summary, key questions, method/source scope, and an explicit confirmation action.

- [ ] **Step 1: Write failing plan-stage test**

Assert headings for plan content, core questions, and source scope appear together, and disabled/locked plan actions remain unavailable until server state permits them.

- [ ] **Step 2: Run the stage test to verify it fails**

Run: `pnpm --filter web exec vitest run tests/ui/guided-research-reference-layout.test.tsx`

Expected: FAIL because the reference-plan composition is absent.

- [ ] **Step 3: Implement `GuidedResearchPlanPanel` and compose it for direction/outline nodes**

Reuse the existing editors and Markdown previews; do not duplicate heading or source-scope serialization rules.

- [ ] **Step 4: Run the stage test to verify it passes**

Run: `pnpm --filter web exec vitest run tests/ui/guided-research-reference-layout.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/research-studio/guided-research-plan-panel.tsx apps/web/components/research-studio/guided-research-live.tsx apps/web/tests/ui/guided-research-reference-layout.test.tsx
git commit -m "feat(research): add reference-style research plan workspace"
```

### Task 4: Recompose source research around live task progress and insights

**Files:**
- Create: `apps/web/components/research-studio/guided-research-source-workspace.tsx`
- Modify: `apps/web/components/research-studio/guided-research-live.tsx`
- Test: `apps/web/tests/ui/guided-research-reference-layout.test.tsx`

**Interfaces:**
- Consumes: runtime tasks, sources, evidence, `GuidedResearchRuntimeProgress`, `GuidedResearchTrustConsole`, `GuidedResearchSources`, and the generated research Markdown document.
- Produces: `GuidedResearchSourceWorkspace` with progress, activity, findings, and risk/insight regions.

- [ ] **Step 1: Write failing research-stage test**

Assert task progress, activity, source evidence, and a failed-task/evidence-gap state remain visible in their named regions.

- [ ] **Step 2: Run the stage test to verify it fails**

Run: `pnpm --filter web exec vitest run tests/ui/guided-research-reference-layout.test.tsx`

Expected: FAIL because the source workspace does not expose reference regions.

- [ ] **Step 3: Implement `GuidedResearchSourceWorkspace` and compose the existing live components**

Use responsive three-region layout at desktop width and collapse to one column below desktop. Keep source additions, removals, retries, steering, and conflicts wired to their existing handlers.

- [ ] **Step 4: Run the stage test to verify it passes**

Run: `pnpm --filter web exec vitest run tests/ui/guided-research-reference-layout.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/research-studio/guided-research-source-workspace.tsx apps/web/components/research-studio/guided-research-live.tsx apps/web/tests/ui/guided-research-reference-layout.test.tsx
git commit -m "feat(research): compose live source research workspace"
```

### Task 5: Compose the report stage and verify the full reference journey

**Files:**
- Create: `apps/web/components/research-studio/guided-research-report-workspace.tsx`
- Modify: `apps/web/components/research-studio/guided-research-live.tsx`
- Modify: `apps/web/e2e/guided-research-trust-console.spec.ts`
- Test: `apps/web/tests/ui/guided-research-reference-layout.test.tsx`

**Interfaces:**
- Consumes: `GuidedResearchReportDocument`, readiness/limitations, report actions, and validated report Markdown.
- Produces: `GuidedResearchReportWorkspace` with table of contents, report body, action header, and quality/source metric regions.

- [ ] **Step 1: Write failing report-stage and responsive browser assertions**

Assert the report has its table of contents, source/quality metrics, and visible evidence limitation. Extend the browser assertion to verify no horizontal overflow at desktop, tablet, and mobile widths.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm --filter web exec vitest run tests/ui/guided-research-reference-layout.test.tsx && pnpm --filter web exec playwright test e2e/guided-research-trust-console.spec.ts`

Expected: FAIL because the report workspace regions are absent.

- [ ] **Step 3: Implement `GuidedResearchReportWorkspace` and compose it in the report node**

Reuse existing cited report document and readiness components. Exports must remain attached to validated report actions only.

- [ ] **Step 4: Run focused tests and full affected checks**

Run: `pnpm --filter web exec vitest run tests/unit/guided-research-six-step.test.tsx tests/ui/guided-research-reference-layout.test.tsx tests/ui/guided-research-live.test.tsx tests/ui/guided-research-reference-workflow.test.tsx && pnpm --filter web lint && pnpm --filter web exec playwright test e2e/guided-research-trust-console.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/research-studio/guided-research-report-workspace.tsx apps/web/components/research-studio/guided-research-live.tsx apps/web/e2e/guided-research-trust-console.spec.ts apps/web/tests/ui/guided-research-reference-layout.test.tsx
git commit -m "feat(research): align report workspace with reference"
```

## Plan Self-Review

- Spec coverage: Tasks 1–5 cover no duplicate nav, reference stage compositions, contextual assistant, Markdown/structured persistence, runtime evidence safeguards, report quality, and responsive verification.
- Type consistency: stage panels consume existing runtime/draft types and handlers; no new API contract is introduced.
- Review focus coverage: each listed user-facing failure mode is explicitly assigned to Tasks 1, 2, 4, or 5.
- Proportion: five independently reviewable UI deliverables; backend research semantics stay unchanged.
