# Interview Persona Mock and Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the Interview Studio with the supplied expert personas, allow each mock expert to open a usable full-page quick conversation, and provide the signed full-page first step for creating a batch interview.

**Architecture:** Keep existing persisted history on the existing interview API. Add a clearly labelled frontend mock expert catalog derived from `experts_persona.json`; mock quick sessions and mock batch drafts use focused browser adapters so they remain usable without pretending the personas are production Agent Definitions. Add a full-page `/itv/new` mock form without changing the signed backend contract.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Zod-derived interview contracts, Vitest, Testing Library.

## Global Constraints

- Only digital experts are shown; no real-person or user-persona selector.
- Mock expert cards must be visibly marked as mock data.
- Quick interviews and new interview creation are full pages, never dialogs or drawers.
- Batch creation step one requires a name, at least one tag, and a topic.
- Existing interview history continues to use the real API and must not be replaced by mock history.
- No new dependency and no duplicate interview contract.

---

### Task 1: Persona catalog adapter and Studio cards

**Files:**
- Create: `apps/web/lib/mock/digital-expert-personas.ts`
- Modify: `apps/web/components/itv/interview-studio-home.tsx`
- Modify: `apps/web/tests/ui/interview-studio-home.test.tsx`

**Interfaces:**
- Produces: `MOCK_DIGITAL_EXPERTS: readonly DigitalExpertCatalogRow[]` and `MOCK_EXPERT_CATEGORIES`.
- Consumes: the contract-derived `DigitalExpertCatalogRow` type.

- [ ] Write a failing UI test asserting supplied persona names, category filters, mock label, and quick-interview href.
- [ ] Run `pnpm --filter web exec vitest run tests/ui/interview-studio-home.test.tsx` and confirm the new assertions fail.
- [ ] Normalize the supplied persona fields into the existing catalog row shape and render them when the experts tab is active.
- [ ] Run the focused test and confirm it passes.

### Task 2: Usable mock quick interview

**Files:**
- Create: `apps/web/lib/mock/quick-digital-interview.ts`
- Modify: `apps/web/lib/interview-api.ts`
- Modify: `apps/web/components/itv/quick-digital-interview.tsx`
- Modify: `apps/web/tests/ui/quick-digital-interview.test.tsx`

**Interfaces:**
- Produces mock implementations of start/load/append/convert selected by the reserved `mock-persona:` expert id prefix.
- Persists mock quick sessions in local storage under one namespaced key.

- [ ] Write failing tests that start a supplied persona, submit a question, see an exploratory response, and return to experts.
- [ ] Run the focused quick-interview test and confirm failure.
- [ ] Implement the minimal local mock adapter while leaving non-mock requests on the real API.
- [ ] Run focused quick-interview and Studio tests.

### Task 3: Full-page interview creation step one

**Files:**
- Create: `apps/web/app/itv/new/page.tsx`
- Create: `apps/web/components/itv/digital-interview-create.tsx`
- Modify: `apps/web/lib/interview-api.ts`
- Create: `apps/web/tests/ui/interview-setup-workflow.test.tsx`

**Interfaces:**
- Produces: `createDigitalInterviewDraft({name,tags,topic})` using the explicit browser Mock boundary.
- Produces the stable test ids `itv-create-page`, `itv-step-1`, `itv-create-name`, `itv-create-tags`, `itv-create-topic`, and `itv-create-submit`.

- [ ] Write a failing test for required fields, tag parsing, local Mock draft creation, and navigation to `/itv/[id]/setup`.
- [ ] Run `pnpm --filter web exec vitest run tests/ui/interview-setup-workflow.test.tsx` and confirm failure.
- [ ] Implement the full-page form with inline validation, busy state, local Mock persistence, and error preservation.
- [ ] Run the focused test and confirm it passes.

### Task 4: Regression verification

- [ ] Run focused UI tests, Web typecheck, and design lint.
- [ ] Exercise `/itv`, a mock quick conversation, and `/itv/new` in an authenticated browser.
