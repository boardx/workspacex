# Interview Create Modal and Skill Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the new-interview page entry with a compact modal and deliver a persistent, clickable Mock interview workflow with a consent-based Skill assistant.

**Architecture:** Keep the Studio and setup screens as client components. Extend the existing browser-local draft repository into the single state boundary for workflow content, current step, Skill messages, pending suggestions, and undo snapshots. Separate modal, workflow steps, and Skill assistant into focused components so their observable behavior can be tested independently.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Vitest, Testing Library, localStorage.

## Global Constraints

- Only digital experts are in scope; no real people or user personas.
- Mock content must be visibly labeled and never represented as real evidence.
- Skill suggestions require an explicit Apply action and support undo.
- Name maximum is 100 characters; tags are optional, unique, and limited to five.
- Do not add dependencies or change backend contracts in this slice.

---

### Task 1: Local Draft State Model

**Files:**
- Modify: `apps/web/lib/mock/digital-interview-drafts.ts`
- Test: `apps/web/tests/ui/interview-setup-workflow.test.tsx`

**Interfaces:**
- Produces: `createMockDigitalInterviewDraft({ name, tags })`, `updateMockDigitalInterviewDraft(interviewId, updater)`, and a draft containing `topic`, `currentStep`, `selectedExpertIds`, `questions`, `skillMessages`, `pendingSuggestion`, and `undoSnapshot`.

- [ ] Write a failing test that creates a name-only draft, updates the topic and selected experts, reloads it, and observes the same state.
- [ ] Run the test and confirm it fails because the current creator requires `topic` and no update API exists.
- [ ] Implement normalized tag handling and immutable draft updates with safe localStorage parsing.
- [ ] Re-run the test and confirm it passes.

### Task 2: Studio Create Modal

**Files:**
- Create: `apps/web/components/itv/digital-interview-create-modal.tsx`
- Modify: `apps/web/components/itv/interview-studio-home.tsx`
- Modify: `apps/web/app/itv/new/page.tsx`
- Test: `apps/web/tests/ui/interview-studio-home.test.tsx`

**Interfaces:**
- Consumes: `createMockDigitalInterviewDraft({ name, tags })`.
- Produces: modal test anchors `itv-create-dialog`, `itv-create-name`, `itv-create-tag-input`, `itv-create-submit`; pushes `/itv/<id>/setup`.

- [ ] Write failing tests for opening the modal, disabled submit without a name, Enter-added tags, the five-tag ceiling, removing a tag, and successful navigation.
- [ ] Run the focused test and confirm failure because the current element is a link to `/itv/new`.
- [ ] Implement the accessible dialog, keyboard behavior, validation and navigation.
- [ ] Change `/itv/new` into a compatibility redirect to `/itv?create=1`.
- [ ] Re-run the focused test and confirm it passes.

### Task 3: Clickable Five-Step Mock Workflow

**Files:**
- Modify: `apps/web/components/itv/digital-interview-setup.tsx`
- Create: `apps/web/components/itv/digital-interview-workflow.tsx`
- Test: `apps/web/tests/ui/interview-setup-workflow.test.tsx`

**Interfaces:**
- Consumes: persistent Mock draft and Persona catalog.
- Produces: clickable `itv-workflow-step-1` through `itv-workflow-step-5`, topic confirmation, expert selection, expert-specific questions, run status, Markdown report and timeline.

- [ ] Write failing tests that confirm the topic, navigate through all five steps, remove/add an expert, edit a question, and see the report timeline.
- [ ] Run the test and confirm failure because setup currently shows only a saved-draft card.
- [ ] Implement the workflow shell and minimal deterministic Mock data transitions.
- [ ] Persist every accepted transition through the draft repository.
- [ ] Re-run the workflow test and confirm it passes.

### Task 4: Skill Assistant With Apply and Undo

**Files:**
- Create: `apps/web/components/itv/interview-skill-assistant.tsx`
- Modify: `apps/web/components/itv/digital-interview-workflow.tsx`
- Modify: `apps/web/lib/mock/digital-interview-drafts.ts`
- Test: `apps/web/tests/ui/interview-skill-assistant.test.tsx`

**Interfaces:**
- Consumes: current draft and `onDraftChange`.
- Produces: deterministic suggestions with `target: "topic" | "experts" | "questions" | "report"`, explicit apply and one-level undo.

- [ ] Write failing tests proving a sent prompt does not change the topic, Apply changes it, and Undo restores the literal previous topic.
- [ ] Run the focused test and confirm it fails because the assistant does not exist.
- [ ] Implement assistant messages, quick prompts, deterministic suggestion generation, Apply and Undo.
- [ ] Persist messages and suggestion state with the draft.
- [ ] Re-run the focused test and confirm it passes.

### Task 5: Integrated Verification

**Files:**
- Modify only files required by failures discovered in this task.

- [ ] Run `pnpm --filter web run lint:design` and fix only issues introduced by this feature.
- [ ] Run `pnpm --filter web exec tsc --noEmit --pretty false`.
- [ ] Run the four interview UI test files with one fork worker.
- [ ] Run `git diff --check` and inspect the feature-only diff for unrelated changes.
- [ ] Record exact commands and results in the sprint progress/handoff without marking F04 passing unless the full authoritative verification succeeds.
