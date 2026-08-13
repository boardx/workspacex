# Interview Expert and Question Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit searchable expert picker and preserve three generated questions per expert while allowing manual questions in the Mock batch interview workflow.

**Architecture:** Keep the feature browser-only and reuse the existing Mock draft store. Add stable question identity/origin plus pure reconciliation helpers, then render a focused picker dialog and expert-grouped question editor from the workflow component.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, existing UI primitives, Vitest, Testing Library.

## Global Constraints

- No new dependency or backend API.
- Keep Mock and exploratory boundaries visible.
- Preserve existing draft data and user-edited questions across step navigation.
- At least one expert; each new expert starts with three generated questions, all of which remain user-editable and deletable.

---

### Task 1: Question identity, default generation, and reconciliation

**Files:**
- Modify: `apps/web/lib/mock/digital-interview-drafts.ts`
- Test: `apps/web/tests/digital-interview-drafts.test.ts`

**Interfaces:**
- Produces: `createDefaultMockInterviewQuestions(expertId)` returning three generated questions.
- Produces: `reconcileMockInterviewQuestions(selectedExpertIds, questions)` preserving existing selected-expert questions and filling missing defaults.
- Extends: `MockInterviewQuestion` with `questionId` and `origin`.

- [ ] **Step 1: Write failing tests** for three defaults, preservation of edited/manual questions, removal of unselected-expert questions, and legacy stored questions.
- [ ] **Step 2: Run tests and verify RED** with missing helper/fields assertions.
- [ ] **Step 3: Implement minimal helpers and read migration** using deterministic generated question IDs and fresh manual UUIDs only at user action time.
- [ ] **Step 4: Run tests and verify GREEN.**
- [ ] **Step 5: Commit** draft model and tests.

### Task 2: Expert directory selection dialog

**Files:**
- Create: `apps/web/components/itv/expert-picker-dialog.tsx`
- Modify: `apps/web/components/itv/digital-interview-workflow.tsx`
- Test: `apps/web/tests/ui/interview-setup-workflow.test.tsx`

**Interfaces:**
- Consumes: `MOCK_DIGITAL_EXPERTS`, `MOCK_EXPERT_CATEGORIES`, current selected IDs.
- Produces: `onConfirm(expertIds)` with the complete deduplicated selection.

- [ ] **Step 1: Write a failing UI test** that opens the dialog, searches for an expert, selects them, confirms, and observes the expert in the workflow without duplicates.
- [ ] **Step 2: Run the targeted UI test and verify RED** because no dialog exists.
- [ ] **Step 3: Implement the dialog** with search, category filters, selected markers, scrollable results, cancel, and confirm.
- [ ] **Step 4: Wire `ExpertStep` to the dialog** and persist the confirmed selection.
- [ ] **Step 5: Run the targeted UI test and verify GREEN.**
- [ ] **Step 6: Commit** the picker and workflow wiring.

### Task 3: Grouped three-question editor and manual questions

**Files:**
- Modify: `apps/web/components/itv/digital-interview-workflow.tsx`
- Test: `apps/web/tests/ui/interview-setup-workflow.test.tsx`

**Interfaces:**
- Consumes: reconciled `MockInterviewQuestion[]` grouped by `expertId`.
- Produces: add/update/delete callbacks keyed by stable `questionId`.

- [ ] **Step 1: Write failing UI tests** asserting exactly three initial questions per expert and a fourth manual question after clicking that expert's add button.
- [ ] **Step 2: Add a failing round-trip test** proving edited questions survive expert-step navigation and a newly added expert receives only their own defaults.
- [ ] **Step 3: Run tests and verify RED** against the current single-question editor.
- [ ] **Step 4: Implement reconciliation on expert confirmation** and stable question update/add/delete handlers.
- [ ] **Step 5: Render grouped expert cards** with numbered textareas, generated/manual labels, per-expert add, and item-by-item delete with generated-question tombstones.
- [ ] **Step 6: Run tests and verify GREEN.**
- [ ] **Step 7: Commit** the question editor behavior.

### Task 4: Verification and delivery

**Files:**
- Modify: `phases/phase-04-digital-expert-interview-studio/sprints/sprint-04/evidence/F04.verify.log` only if the harness selects that path.
- Modify: relevant Phase 04 progress/handoff files only through the repository's supported closeout flow.

- [ ] **Step 1: Run targeted tests:** `pnpm --filter web exec vitest run tests/ui/interview-setup-workflow.test.tsx tests/digital-interview-drafts.test.ts`.
- [ ] **Step 2: Run Web typecheck:** `pnpm --filter web typecheck`.
- [ ] **Step 3: Run design lint** required by the Research/Studio module.
- [ ] **Step 4: Inspect the diff** for scope, generated files, accidental status edits, and test false positives.
- [ ] **Step 5: Push the branch and open a PR** with `Closes #1131`.
- [ ] **Step 6: Merge only after checks/review pass**, then verify the merge SHA is an ancestor of `origin/main`.
