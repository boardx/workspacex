# Deep Research Six-Step Markdown UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved six-stage desktop Deep Research workspace with Markdown as the visible and editable artefact format while preserving runtime evidence and approval guarantees.

**Architecture:** A pure Markdown adapter serializes existing structured runtime state and turns permitted edits back into validated command payloads. A reusable desktop shell and Markdown workspace replace the current ad-hoc per-step presentation; stage components compose the adapter while the API continues to own citations, source identity, graph versions, and execution.

**Tech Stack:** Next.js/React, TypeScript, Tailwind, shadcn/ui, Zod contracts, Vitest, existing Guided Research API/runtime.

**Spec:** `docs/superpowers/specs/2026-09-26-deep-research-six-step-markdown-ui-design.md`

## Global Constraints

- Keep sources, source IDs, evidence quotes, citations, human conflict resolution, graph-version checks, and report validation server-owned structured data.
- Every generated researcher-facing artefact is displayed and edited through a canonical Markdown document.
- Do not add a second source of truth for headings or parsing rules; one Markdown adapter owns serialization and parsing.
- Preserve existing runtime route compatibility and node/checkpoint authorization.
- Use semantic design tokens and shadcn components only; provide loading, empty, error, and success feedback states plus stable test IDs.
- PR creation requires focused tests, type checks, design lint, and browser validation before the PR is opened.

## Review Focus

- A user deletes a required Markdown heading: save must explain the failed section and retain their editor text.
- A stale client submits a Markdown change after another researcher saved: the local document remains available rather than being overwritten.
- A Markdown edit attempts to alter a source ID or inline report citation: it must not bypass existing evidence and citation validation.
- A session still at an earlier checkpoint is opened directly on a later visual stage: the six-stage navigation must remain locked.
- A narrow viewport must collapse auxiliary rails before the main document gains horizontal overflow.

### Task 1: Markdown artefact adapter

**Files:**
- Create: `apps/web/lib/guided-research-markdown.ts`
- Create: `apps/web/tests/unit/guided-research-markdown.test.ts`
- Modify: `apps/web/lib/guided-research-api.ts`

**Interfaces:**
- Produces `serializeGuidedResearchMarkdown(input: GuidedResearchMarkdownInput): GuidedResearchMarkdownDocument`.
- Produces `parseGuidedResearchMarkdown(input: GuidedResearchMarkdownParseInput): GuidedResearchMarkdownParseResult`.
- `GuidedResearchMarkdownDocument` contains `node`, `title`, `markdown`, and an immutable `provenance` projection; parse results contain either a typed permitted draft payload or field-level errors.

- [ ] **Step 1: Write failing serialization and parsing tests**

Add cases for brief, topic/plan, source-research evidence log, and report Markdown. Assert stable headings, required-section rejection, local-text preservation in parse errors, and rejection of source-ID/citation mutation.

- [ ] **Step 2: Run the focused unit test to verify it fails**

Run: `pnpm --filter web exec vitest run tests/unit/guided-research-markdown.test.ts`

Expected: FAIL because the Markdown adapter is absent.

- [ ] **Step 3: Implement the typed Markdown adapter**

Implement the two exported functions in `apps/web/lib/guided-research-markdown.ts`. Derive documents from existing Guided Research API types and parse only editable fields; preserve source provenance outside user-controlled Markdown.

- [ ] **Step 4: Run the focused unit test to verify it passes**

Run: `pnpm --filter web exec vitest run tests/unit/guided-research-markdown.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the adapter**

```bash
git add apps/web/lib/guided-research-markdown.ts apps/web/tests/unit/guided-research-markdown.test.ts apps/web/lib/guided-research-api.ts
git commit -m "feat(research): add markdown artifact adapter"
```

### Task 2: Six-stage shell and safe stage mapping

**Files:**
- Create: `apps/web/components/research-studio/guided-research-six-step-shell.tsx`
- Create: `apps/web/lib/guided-research-six-step.ts`
- Create: `apps/web/tests/unit/guided-research-six-step.test.ts`
- Modify: `apps/web/components/research-studio/guided-research-flow.tsx`

**Interfaces:**
- Produces `GUIDED_RESEARCH_SIX_STEPS` and `toGuidedResearchVisualStage(runtime): GuidedResearchVisualStage`.
- `GuidedResearchSixStepShell` accepts current stage, availability, navigation callback, main content, and optional assistant content.
- Consumes the adapter contract from Task 1 only through stage components, not through navigation.

- [ ] **Step 1: Write failing stage-mapping and shell tests**

Test six Chinese stage labels, completion/lock behavior derived from runtime availability, and that a late-stage route cannot make a locked stage selectable.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm --filter web exec vitest run tests/unit/guided-research-six-step.test.ts`

Expected: FAIL because the six-stage mapper and shell do not exist.

- [ ] **Step 3: Implement stage mapping and the responsive desktop shell**

Build the left research rail, top progress, main canvas, and optional right assistant rail with semantic components and collapsible small-screen behavior. Recompose the flow through the shell without changing runtime node authorization.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `pnpm --filter web exec vitest run tests/unit/guided-research-six-step.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit shell and mapping changes**

```bash
git add apps/web/components/research-studio/guided-research-six-step-shell.tsx apps/web/lib/guided-research-six-step.ts apps/web/tests/unit/guided-research-six-step.test.ts apps/web/components/research-studio/guided-research-flow.tsx
git commit -m "feat(research): add six-stage desktop shell"
```

### Task 3: Reusable Markdown workspace

**Files:**
- Create: `apps/web/components/research-studio/guided-research-markdown-workspace.tsx`
- Create: `apps/web/tests/ui/guided-research-markdown-workspace.test.tsx`
- Modify: `apps/web/components/research-studio/guided-research-live.tsx`

**Interfaces:**
- `GuidedResearchMarkdownWorkspace` accepts `document`, `onSave(markdown)`, `saving`, `parseError`, and optional read-only provenance panels.
- Emits `data-testid` values for preview, editor, dirty state, save success, and error state.
- Consumes Task 1's serializer/parser and returns no raw mutable source or citation metadata.

- [ ] **Step 1: Write failing workspace interaction tests**

Cover initial Markdown preview, explicit edit transition, dirty state, failed parse keeping editor text, successful save feedback, and disabled duplicate-save behavior.

- [ ] **Step 2: Run the focused UI test to verify it fails**

Run: `pnpm --filter web exec vitest run tests/ui/guided-research-markdown-workspace.test.tsx`

Expected: FAIL because the workspace component is absent.

- [ ] **Step 3: Implement the accessible Markdown preview/editor**

Use existing `Textarea`, `Button`, `Card`, and Markdown rendering primitives. Render provenance and evidence panels separately from editable text, preserving focus and errors during failed saves.

- [ ] **Step 4: Connect the workspace to live runtime commands**

Update `guided-research-live.tsx` to serialize the active node, parse permitted edits before command construction, and preserve graph-version conflict recovery behavior.

- [ ] **Step 5: Run focused UI tests to verify they pass**

Run: `pnpm --filter web exec vitest run tests/ui/guided-research-markdown-workspace.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the Markdown workspace**

```bash
git add apps/web/components/research-studio/guided-research-markdown-workspace.tsx apps/web/tests/ui/guided-research-markdown-workspace.test.tsx apps/web/components/research-studio/guided-research-live.tsx
git commit -m "feat(research): add editable markdown workspace"
```

### Task 4: Stage-specific composition and trusted research activity

**Files:**
- Modify: `apps/web/components/research-studio/guided-research-intent-plan.tsx`
- Modify: `apps/web/components/research-studio/guided-research-runtime-progress.tsx`
- Modify: `apps/web/components/research-studio/guided-research-sources.tsx`
- Modify: `apps/web/components/research-studio/guided-research-report-document.tsx`
- Modify: `apps/web/components/research-studio/guided-research-trust-console.tsx`
- Modify: `apps/web/tests/ui/guided-research-live.test.tsx`

**Interfaces:**
- Consumes `GuidedResearchMarkdownWorkspace` from Task 3.
- Produces complete visual composition for import, topic, plan, source-research, and report stages.
- Conflict actions retain the existing `onResolveConflict({ conflictId, action, sourceId, rationale })` contract.

- [ ] **Step 1: Write failing live-flow UI tests**

Cover stage-specific Markdown headings, plan/source activity panels, evidence-gap visibility, required conflict rationale, and cited report Markdown output.

- [ ] **Step 2: Run the focused live-flow test to verify it fails**

Run: `pnpm --filter web exec vitest run tests/ui/guided-research-live.test.tsx`

Expected: FAIL because the stages still use their legacy presentation.

- [ ] **Step 3: Compose the five session stages around Markdown artefacts**

Use the shared workspace for import, topic, plan, source-research, and report. Keep task/source cards as trusted operational context next to the source-research document; retain existing report source and citation behavior.

- [ ] **Step 4: Run the focused live-flow test to verify it passes**

Run: `pnpm --filter web exec vitest run tests/ui/guided-research-live.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit stage composition**

```bash
git add apps/web/components/research-studio/guided-research-intent-plan.tsx apps/web/components/research-studio/guided-research-runtime-progress.tsx apps/web/components/research-studio/guided-research-sources.tsx apps/web/components/research-studio/guided-research-report-document.tsx apps/web/components/research-studio/guided-research-trust-console.tsx apps/web/tests/ui/guided-research-live.test.tsx
git commit -m "feat(research): redesign markdown research stages"
```

### Task 5: End-to-end validation and PR evidence

**Files:**
- Modify: `apps/web/tests/ui/guided-research-home-live.test.tsx`
- Create: `apps/web/tests/e2e/guided-research-six-step.spec.ts`
- Modify: `.agents/skills/mod-user-research/SKILL.md`

**Interfaces:**
- Consumes the stable test IDs from Tasks 2–4.
- Produces browser evidence for the desktop six-stage happy path and responsive no-overflow check.

- [ ] **Step 1: Write the failing browser and home-flow tests**

Assert the research list opens a session into stage 2, all six labels are present, the main Markdown document is visible at desktop width, later stages stay unavailable until checkpoint confirmation, and the report preserves cited Markdown.

- [ ] **Step 2: Run the focused browser test to verify it fails**

Run: `pnpm --filter web exec playwright test tests/e2e/guided-research-six-step.spec.ts --project=chromium`

Expected: FAIL because six-stage anchors and Markdown surfaces are absent.

- [ ] **Step 3: Add only the minimal test selectors or state hooks needed by the browser test**

Keep selectors user-visible and stable; do not add test-only branches or bypass runtime confirmation.

- [ ] **Step 4: Run focused and full affected verification**

Run:
`pnpm --filter web exec vitest run tests/unit/guided-research-markdown.test.ts tests/unit/guided-research-six-step.test.ts tests/ui/guided-research-markdown-workspace.test.tsx tests/ui/guided-research-live.test.tsx tests/ui/guided-research-home-live.test.tsx`

Run:
`pnpm --filter web exec playwright test tests/e2e/guided-research-six-step.spec.ts --project=chromium`

Run:
`pnpm --filter web exec tsc --noEmit && pnpm --filter web lint && pnpm lint-design`

Expected: all commands exit 0.

- [ ] **Step 5: Perform a browser visual review and commit evidence**

At a desktop viewport, compare the list, brief, topic, plan, source-research, and report screens against the approved reference. Capture the visual evidence, append the verified module learning, and commit the test/evidence update.

```bash
git add apps/web/tests/ui/guided-research-home-live.test.tsx apps/web/tests/e2e/guided-research-six-step.spec.ts .agents/skills/mod-user-research/SKILL.md
git commit -m "test(research): verify six-step markdown workflow"
```

## Plan Self-Review

- Spec coverage: Tasks 1–4 cover the Markdown boundary, six-step layout, stage composition, trust constraints, errors, and accessibility. Task 5 covers desktop browser behavior and verification.
- Type consistency: Task 1 owns document and parse types; Task 2 owns only visual-stage types; Task 3 consumes document types; Tasks 4–5 compose stable components/test IDs.
- Review focus coverage: malformed Markdown and provenance mutation are Task 1; stale writes are Task 3; locked visual stages are Task 2/5; narrow viewport is Task 5.
- Scope: the plan is one frontend/API-adapter migration and does not alter source verification or report-generation services.
