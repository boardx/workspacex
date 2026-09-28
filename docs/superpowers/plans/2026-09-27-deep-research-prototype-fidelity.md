# Deep Research Prototype Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live Deep Research home and six-stage workspace visually and structurally faithful to the approved desktop prototype while preserving the existing research runtime.

**Architecture:** Introduce a focused presentation layer for the home, progress strip, and each stage composition. Existing runtime, Markdown adapters, and domain components remain authoritative; new layout components only arrange their real data and actions into the reference's visual regions. Tests assert each composition and browser visual QA verifies the rendered route.

**Tech Stack:** Next.js, React, TypeScript, Tailwind, shadcn/ui, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-deep-research-prototype-fidelity-design.md`

## Global Constraints

- Preserve WorkspaceX's global product rail and do not introduce a second research navigation rail.
- Use existing semantic design tokens and shadcn components; no hard-coded colors, arbitrary pixels, or bare form controls.
- Preserve real runtime, Markdown persistence, evidence/citation, conflict, and route behavior.
- Preserve truthful loading, empty, error, saved, disabled, and responsive states.
- Treat browser screenshot comparison at the matching desktop state as the visual acceptance gate.

## Review Focus

- The research home must remain usable with no sessions and with long titles/tags.
- Locked and completed steps must stay distinguishable and inaccessible where runtime disallows navigation.
- Upload and voice choices remain explicitly unavailable rather than pretending to work.
- The right assistant/risk rail must collapse without creating an empty desktop column.
- Report actions and evidence limitations must stay visible without obscuring the report document.

### Task 1: Establish prototype layout primitives and visual contracts

**Files:**
- Modify: `apps/web/components/research-studio/guided-research-six-step-shell.tsx`
- Modify: `apps/web/components/research-studio/guided-research-step-layout.tsx`
- Test: `apps/web/tests/unit/guided-research-six-step.test.tsx`
- Test: `apps/web/tests/ui/guided-research-reference-layout.test.tsx`

**Interfaces:**
- Produces a compact, branded six-step strip with active, complete, and locked variants.
- Produces a shared stage canvas with optional contextual rail and stable test IDs.

- [ ] Write failing tests for branded progress variants, stage canvas regions, and absent reserved rail.
- [ ] Run the focused tests and observe the missing visual-contract assertions fail.
- [ ] Implement the shared progress strip and canvas layout using semantic tokens and responsive grid tracks.
- [ ] Run the focused tests and confirm they pass.
- [ ] Commit the task.

### Task 2: Recompose the research home and requirement/topic stages

**Files:**
- Modify: `apps/web/components/research-studio/guided-research-flow.tsx`
- Modify: `apps/web/components/research-studio/guided-research-entry-panel.tsx`
- Modify: `apps/web/components/research-studio/guided-research-topic-panel.tsx`
- Test: `apps/web/tests/ui/guided-research-reference-layout.test.tsx`

**Interfaces:**
- Produces reference-style research cards, filters, and primary entry action.
- Produces three symmetric intake cards and structured topic work beside an assistant rail.

- [ ] Write failing tests for home card composition, import choice parity, and topic workspace/assistant regions.
- [ ] Run the focused tests and observe failures.
- [ ] Implement the home, import, and topic compositions while reusing existing handlers and Markdown workspaces.
- [ ] Run the focused tests and confirm they pass.
- [ ] Commit the task.

### Task 3: Recompose plan, source research, and report surfaces

**Files:**
- Modify: `apps/web/components/research-studio/guided-research-plan-panel.tsx`
- Modify: `apps/web/components/research-studio/guided-research-source-workspace.tsx`
- Modify: `apps/web/components/research-studio/guided-research-report-workspace.tsx`
- Modify: `apps/web/components/research-studio/guided-research-live.tsx`
- Test: `apps/web/tests/ui/guided-research-reference-layout.test.tsx`

**Interfaces:**
- Produces reference-style plan cards, live research progress/activity/risk regions, and a report frame with contents/document/metrics/actions.

- [ ] Write failing tests for the reference compositions and responsive rail behavior.
- [ ] Run the focused tests and observe failures.
- [ ] Implement the stage compositions using existing runtime content and callbacks.
- [ ] Run the focused tests and confirm they pass.
- [ ] Commit the task.

### Task 4: Browser visual verification and regression coverage

**Files:**
- Modify: `apps/web/e2e/guided-research-trust-console.spec.ts`
- Create: `apps/web/e2e/guided-research-prototype-fidelity.spec.ts`
- Create: `design-qa.md`

**Interfaces:**
- Produces browser screenshots for home, intake, topic, source research, and report states at desktop viewport.

- [ ] Write failing Playwright assertions for the visible prototype regions and overflow-free desktop canvas.
- [ ] Run the new spec and observe failures before the visual work is complete.
- [ ] Add screenshot capture and interaction coverage using stable test IDs.
- [ ] Run focused UI tests, Playwright visual coverage, design lint, and the affected workspace test suite.
- [ ] Compare reference and rendered captures; record and fix all P0/P1/P2 findings in `design-qa.md`.
- [ ] Commit the task.

## Self-Review

- Task 1 owns shared step/canvas hierarchy; Tasks 2 and 3 consume it without duplicating navigation.
- Task 2 owns the first three prototype states; Task 3 owns the remaining workflow content regions.
- Task 4 covers the cross-stage screenshot contract and is the only task that may declare visual acceptance.
- All six reference stages, markdown persistence, global-rail constraint, and visual QA have an owning task.
