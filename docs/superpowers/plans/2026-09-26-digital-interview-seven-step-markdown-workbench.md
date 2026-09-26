# Digital Interview Seven-Step Markdown Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a seven-step digital-interview workbench where every AI stage produces durable, versioned Markdown while structured research facts remain authoritative.

**Architecture:** Add one typed artifact projection keyed by the workflow step and persist append-only versions beside the existing aggregate. Replace the large workflow component with a workbench shell, a shared Markdown artifact panel, and focused step components.

**Tech Stack:** TypeScript, NestJS, PostgreSQL, Zod, Next.js/React, Tailwind/shadcn UI, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-digital-interview-seven-step-markdown-workbench-design.md`

## Global Constraints

- Structured expert, question, answer and evidence identifiers remain authoritative; never parse Markdown back into business facts.
- Regeneration creates a new artifact version and cannot overwrite confirmed content.
- Existing evidence eligibility, simulated-research disclosure, failure recovery, and Word/PDF export remain enforced.
- All interactive controls have stable `data-testid` values; narrow screens retain every step through vertical navigation.
- Continue using `InterviewReportMarkdown` as the only Markdown renderer.

## Review Focus

- Partial Markdown survives a model failure and exposes retry: Task 3 API recovery test.
- A confirmed artifact survives regeneration: Task 2 repository/version test.
- Simulated content never grants report approval: Task 3 eligibility test.
- Leaving an edited intake/outline warns before discard: Task 5 UI test.
- Keyboard users can traverse every step and operate retry/generation: Task 6 E2E test.

## File Structure

- `packages/contracts/src/interview.ts`: six workflow-stage values and `DigitalInterviewArtifact` schemas.
- `apps/api/src/infrastructure/db/migrations/*digital-interview-artifacts*.sql`: append-only artifact versions.
- `apps/api/src/infrastructure/interview/pg-digital-interview-repository.ts`: recovery-view artifact projection.
- `apps/api/src/infrastructure/interview/workflow/{langgraph-digital-interview-runtime,pg-digital-interview-effects}.ts`: generated Markdown persistence.
- `apps/web/components/itv/digital-interview-workbench.tsx`: shell and step navigation.
- `apps/web/components/itv/digital-interview-artifact-panel.tsx`: shared Markdown/version/failure display.
- `apps/web/components/itv/digital-interview-*-step.tsx`: intake, analysis, expert, outline, run and report interactions.
- Existing API, UI and E2E tests: contract, recovery, accessibility and complete journey proof.

### Task 1: Add seven-stage artifact contracts

**Files:**
- Modify: `packages/contracts/src/interview.ts`
- Test: existing interview-contract test file under `packages/contracts`

**Interfaces:**
- Produces `DigitalInterviewArtifact` with `artifactId`, `step`, `title`, `markdown`, `version`, `status`, `generatedAt`, `failure`, `evidenceMode`.
- Produces `DigitalInterviewWorkflowView.artifacts` as the sole browser-facing artifact projection.

- [ ] **Step 1: Write failing contract tests**

Test all six steps (`intake`, `analysis`, `experts`, `outline`, `runs`, `report`), reject duplicate current artifacts for a step, and reject empty Markdown for confirmed/completed artifacts.

- [ ] **Step 2: Run the focused contract test and verify it fails**

Expected: failure because the artifact schema and six-stage values do not yet exist.

- [ ] **Step 3: Implement additive Zod schemas**

Add the artifact schema and `artifacts` to the recovery view. Update workflow-step operation inputs, while retaining existing report fields during migration.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `pnpm --filter @repo/contracts typecheck` plus focused contract test. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(interview): add seven-step markdown artifacts"`

### Task 2: Persist immutable artifact versions

**Files:**
- Create: `apps/api/src/infrastructure/db/migrations/*digital-interview-artifacts*.sql`
- Modify: `apps/api/src/infrastructure/interview/pg-digital-interview-repository.ts`
- Test: `apps/api/tests/interview/pg-digital-interview-repository.test.ts`

**Interfaces:**
- Consumes `DigitalInterviewArtifact`.
- Produces `appendArtifactVersion(...)`, `readArtifacts(...)`, and a workflow view populated with artifacts.

- [ ] **Step 1: Write failing repository tests**

Prove regeneration creates analysis version 2 while version 1 stays confirmed and readable. Prove a failed running artifact retains partial Markdown and failure metadata.

- [ ] **Step 2: Run repository tests and verify they fail**

Expected: failure because no artifact table or projection exists.

- [ ] **Step 3: Add migration and projection**

Create an append-only table keyed by interview, step and version; map its current and historic rows through the Task 1 schema in the existing workflow transaction.

- [ ] **Step 4: Run repository tests and migration checks**

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(interview): persist markdown artifact versions"`

### Task 3: Generate and recover artifacts through the runtime

**Files:**
- Modify: `apps/api/src/infrastructure/interview/workflow/langgraph-digital-interview-runtime.ts`
- Modify: `apps/api/src/infrastructure/interview/workflow/pg-digital-interview-effects.ts`
- Modify: `apps/api/src/application/interview/workflow/digital-interview-graph.ts`
- Modify: `apps/api/src/interface/controllers/digital-interview.controller.ts`
- Test: `apps/api/tests/interview/digital-interview-workflow.test.ts`
- Test: `apps/api/tests/interview/digital-report-transport.test.ts`

**Interfaces:**
- Consumes Task 2 persistence functions.
- Produces artifact-bearing intake, analysis, expert recommendation, outline, run transcript and report responses.

- [ ] **Step 1: Write failing workflow tests**

Assert each confirmed transition emits its Markdown artifact. Assert partial report failure remains visible/retryable and simulated evidence cannot make a report approvable.

- [ ] **Step 2: Run focused workflow tests and verify they fail**

Expected: failure because only report Markdown is persisted today.

- [ ] **Step 3: Implement explicit creation and retry semantics**

Persist artifacts on confirmation; append run records after durable answers; retain the report stream’s additive behavior. Reuse optimistic version and idempotency checks for every write.

- [ ] **Step 4: Run focused API suites**

Expected: PASS, including partial-content recovery and evidence blocking.

- [ ] **Step 5: Commit**

`git commit -m "feat(interview): generate recoverable markdown artifacts"`

### Task 4: Build the seven-step workbench shell

**Files:**
- Create: `apps/web/components/itv/digital-interview-workbench.tsx`
- Create: `apps/web/components/itv/digital-interview-artifact-panel.tsx`
- Modify: `apps/web/components/itv/digital-interview-workflow.tsx`
- Test: `apps/web/tests/ui/interview-setup-workflow.test.tsx`

**Interfaces:**
- Consumes `DigitalInterviewWorkflowView.artifacts`.
- Produces `DigitalInterviewWorkbench` and `DigitalInterviewArtifactPanel` with active-step, Markdown, status, version and retry slots.

- [ ] **Step 1: Write failing UI tests**

Assert six steps, analysis Markdown, a visible simulated-evidence label, and failed-artifact retry control.

- [ ] **Step 2: Run focused UI test and verify it fails**

Run: `pnpm --filter web exec vitest run tests/ui/interview-setup-workflow.test.tsx`. Expected: failure because the five-step component has no artifact panel.

- [ ] **Step 3: Implement shell and shared panel**

Move navigation, dirty-buffer behavior and status header into the workbench. Render Markdown exclusively through `InterviewReportMarkdown`.

- [ ] **Step 4: Run focused UI test**

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(interview): add seven-step markdown workbench"`

### Task 5: Implement focused step experiences

**Files:**
- Create: `apps/web/components/itv/digital-interview-{intake,analysis,expert-selection,outline,run,report}-step.tsx`
- Modify: `apps/web/components/itv/digital-interview-workflow.tsx`
- Test: `apps/web/tests/ui/interview-setup-workflow.test.tsx`
- Test: `apps/web/tests/ui/interview-detail-report.test.tsx`

**Interfaces:**
- Consumes Task 4 workbench and panel.
- Produces the six workbench stages defined in the spec.

- [ ] **Step 1: Write failing focused-step tests**

Cover intake confirmation, analysis regeneration retaining prior version, two-column expert selection, editable outline, retry preserving content, report-to-source jump, and dirty navigation warning.

- [ ] **Step 2: Run focused UI suites and verify they fail**

Expected: failure because focused components and data bindings do not exist.

- [ ] **Step 3: Implement focused step components**

Use responsive comparison layouts for analysis/expert selection and vertical fallback navigation. Keep local drafts separate from confirmed server state and route all writes through existing request-id/version protection.

- [ ] **Step 4: Run UI suites and visual lint**

Run both UI suites and `pnpm --filter web lint`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(interview): redesign markdown interview steps"`

### Task 6: Verify export, accessibility and browser flow

**Files:**
- Modify: `apps/web/lib/interview-report-export.ts`
- Modify: `apps/web/tests/lib/interview-report-export.test.ts`
- Modify: `apps/web/e2e/digital-interview-research-quality.spec.ts`

**Interfaces:**
- Consumes the Task 5 artifact-bearing report step.
- Produces Word/PDF exports containing report Markdown, artifact provenance and evidence boundary without private IDs.

- [ ] **Step 1: Write failing export and E2E tests**

Assert exported Word includes Markdown and the evidence label. Add an isolated browser journey proving every step, Markdown display, keyboard navigation, recoverable failure and source link.

- [ ] **Step 2: Run focused tests and verify they fail**

Expected: failure because workbench artifacts and navigation are absent.

- [ ] **Step 3: Implement export provenance and stable browser hooks**

Extend the existing export builder and add only semantic test IDs required by E2E.

- [ ] **Step 4: Run complete verification**

Run:

`pnpm --filter web exec vitest run tests/ui/interview-setup-workflow.test.tsx tests/ui/interview-detail-report.test.tsx tests/lib/interview-report-export.test.ts`

`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test e2e/digital-interview-research-quality.spec.ts --config playwright.fullstack-smoke.config.ts --project=seeded-github-import`

`pnpm --filter web typecheck`

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

`git commit -m "test(interview): verify markdown workbench journey"`

## Plan Self-Review

- Tasks 1–3 cover contracts, persistence, AI generation, recovery and evidence; Tasks 4–5 cover all screens and responsive interaction; Task 6 covers export, keyboard access and browser proof.
- `DigitalInterviewArtifact` and `DigitalInterviewWorkflowView.artifacts` originate in Task 1 and are used consistently by later tasks.
- Every Review Focus item has an assigned test task.
- Scope is limited to the existing digital-interview module and transport/export path; it creates no parallel interview system.
