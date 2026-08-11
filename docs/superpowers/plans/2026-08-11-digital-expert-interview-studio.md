# Digital Expert Interview Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `/itv` template/persona prototype with the confirmed digital-expert Interview Studio: history and expert tabs, full-page quick interviews, a resumable five-step batch workflow, interview detail, and traceable reports.

**Architecture:** Keep `/itv` as the canonical top-level route and use nested App Router pages for durable navigation (`/itv`, `/itv/new`, `/itv/quick/[interviewId]`, `/itv/[interviewId]/setup`, `/itv/[interviewId]`, `/itv/[interviewId]/report`). Extend `packages/contracts/src/interview.ts` as the schema single source, keep workflow invariants in `apps/api/src/domain/interview`, implement use cases in `apps/api/src/application/interview`, and persist state through a PostgreSQL repository. The frontend consumes only contract-derived API shapes; no new handwritten mock becomes a second fact source.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5.6, Tailwind CSS, shadcn-style components, NestJS, Zod, PostgreSQL migrations/RLS, Vitest/Testing Library, Playwright.

## Global Constraints

- Only digital experts are in scope; do not render real-person or user-persona choices.
- The home screen has exactly two primary tabs: `历史访谈` and `专家列表`.
- Core work opens as full pages; do not use modal dialogs or right-side drawers for quick interviews, creation, details, or reports.
- New interview step one requires interview name, at least one tag, and interview topic.
- Expert generation occurs only after explicit topic confirmation.
- History cards, detail status, workflow step, and primary action derive from one canonical interview status.
- Findings must trace to an expert and question; digital-expert conclusions remain explicitly exploratory.
- Primary buttons keep text on one line; when horizontal space is insufficient, the action group wraps as a unit.
- Reuse semantic design tokens and existing `components/ui`; do not add hard-coded colors or spacing rules.
- Use the user-confirmed 2026-07 WorkspaceX Standalone export only for shell, density, card/status, detail-workbench, and structured expert-answer presentation; do not copy its modal creation, real-person scheduling, respondent/persona selection, or template-first flow.
- Every user-visible interaction receives a stable `data-testid`; E2E tests navigate through real UI entry points.
- Phase 04 is the authoritative delivery phase. Harness PR boundaries are F01=(Tasks 1–2), F02=(Tasks 3–4), F03/F04/F05=(Task 5 split at quick/topic/run vertical checkpoints), F06=Task 6, and F07=Task 7; one feature still equals one issue and one PR.

---

## File Map

### Contract and backend

- Modify `packages/contracts/src/interview.ts`: canonical digital-expert, workflow, question, run, report schemas and operations.
- Create `apps/api/src/domain/interview/digital-workflow.ts`: status transitions and resumability invariants.
- Create `apps/api/src/application/interview/digital-interview-ports.ts`: repository and model-provider ports.
- Create `apps/api/src/application/interview/create-digital-interview-draft.ts`: step-one draft creation.
- Create `apps/api/src/application/interview/confirm-digital-topic.ts`: topic confirmation and expert generation.
- Create `apps/api/src/application/interview/update-digital-experts.ts`: expert add/remove/confirm.
- Create `apps/api/src/application/interview/update-digital-questions.ts`: per-expert question editing/confirmation.
- Create `apps/api/src/application/interview/run-digital-interviews.ts`: batch execution and partial retry.
- Create `apps/api/src/application/interview/generate-digital-report.ts`: traceable report generation.
- Create `apps/api/src/infrastructure/interview/pg-digital-interview-repository.ts`: PostgreSQL adapter.
- Create `apps/api/src/interface/controllers/digital-interview.controller.ts`: authenticated HTTP adapter.
- Create `apps/api/migrations/20260811213000_digital_interview_studio.sql`: tables, constraints, indexes, and RLS.

### Frontend

- Modify `apps/web/app/itv/page.tsx`: canonical home page.
- Create `apps/web/app/itv/new/page.tsx`: full-page batch workflow.
- Create `apps/web/app/itv/[interviewId]/setup/page.tsx`: resumable five-step workflow.
- Create `apps/web/app/itv/[interviewId]/page.tsx`: detail page.
- Create `apps/web/app/itv/[interviewId]/report/page.tsx`: traceable report page.
- Create `apps/web/app/itv/quick/[interviewId]/page.tsx`: full-page quick interview.
- Create `apps/web/lib/interview-api.ts`: typed API client functions.
- Create `apps/web/components/itv/studio-home.tsx`: home shell and two tabs.
- Create `apps/web/components/itv/history-cards.tsx`: history filters and cards.
- Create `apps/web/components/itv/expert-cards.tsx`: expert filters and cards.
- Create `apps/web/components/itv/quick-interview.tsx`: independent chat page.
- Create `apps/web/components/itv/digital-interview-workflow.tsx`: five-step container.
- Create `apps/web/components/itv/workflow-topic-step.tsx`: name/tags/topic.
- Create `apps/web/components/itv/workflow-experts-step.tsx`: expert review.
- Create `apps/web/components/itv/workflow-questions-step.tsx`: expert-specific questions.
- Create `apps/web/components/itv/workflow-runs-step.tsx`: batch status and retry.
- Create `apps/web/components/itv/workflow-report-step.tsx`: sources and report.
- Create `apps/web/components/itv/interview-detail-page.tsx`: detail layout, status card, section navigation.

### Tests

- Create `packages/contracts/tests/digital-interview-contract.test.ts`.
- Create `apps/api/tests/itv/digital-workflow-transition.test.ts`.
- Create `apps/api/tests/itv/digital-interview-use-cases.test.ts`.
- Create `apps/api/tests/itv/digital-interview-controller.test.ts`.
- Create `apps/web/tests/ui/interview-studio-home.test.tsx`.
- Create `apps/web/tests/ui/interview-workflow.test.tsx`.
- Create `apps/web/tests/ui/interview-detail-navigation.test.tsx`.
- Create `apps/web/e2e/digital-interview-studio.spec.ts`.

---

### Task 1: Canonical contract and workflow state machine

**Files:**
- Modify: `packages/contracts/src/interview.ts`
- Create: `packages/contracts/tests/digital-interview-contract.test.ts`
- Create: `apps/api/src/domain/interview/digital-workflow.ts`
- Create: `apps/api/tests/itv/digital-workflow-transition.test.ts`

**Interfaces:**
- Produces: `DigitalInterviewStatus`, `DigitalInterviewSummary`, `DigitalExpert`, `DigitalQuestion`, `DigitalRun`, `DigitalReport`, `DigitalInterviewDetail`, and `digitalInterviewOperations` Zod schemas.
- Produces: `assertDigitalInterviewTransition(from, to): void` and `primaryActionForStatus(status): DigitalInterviewPrimaryAction`.
- Consumes: existing `InterviewScope` and shared error-envelope conventions from `packages/contracts/src/interview.ts`.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import { interview } from "../src/interview";

describe("digital interview contract", () => {
  it("accepts the eight canonical states and rejects unknown states", () => {
    expect(interview.DigitalInterviewStatus.safeParse("running").success).toBe(true);
    expect(interview.DigitalInterviewStatus.safeParse("paused").success).toBe(false);
  });

  it("requires every report finding to point to an expert and question", () => {
    const finding = { findingId: "f-1", text: "交付 SLA 影响溢价", expertId: "e-1" };
    expect(interview.DigitalReportFinding.safeParse(finding).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts`

Expected: FAIL because the digital interview schemas are not exported.

- [ ] **Step 3: Add the exact contract types and operations**

Add strict Zod schemas with these canonical values:

```ts
export const DigitalInterviewStatus = z.enum([
  "draft", "topic_pending", "experts_pending", "questions_pending",
  "running", "report_pending", "completed", "failed",
]);

export const DigitalInterviewPrimaryAction = z.enum([
  "continue_creation", "continue_interview", "generate_report", "view_report", "retry",
]);

export const DigitalReportFinding = z.object({
  findingId: z.string(),
  text: z.string().min(1),
  expertId: z.string(),
  questionId: z.string(),
  exploratory: z.literal(true),
}).strict();
```

Define operations for list history, list experts, get detail, create/update draft, confirm topic, update experts, update questions, start/retry runs, append quick message, convert quick interview, and generate report. Reuse the existing `{ in, out, err }` operation shape.

- [ ] **Step 4: Write failing transition tests**

```ts
it("permits the five-step happy path", () => {
  expect(() => assertDigitalInterviewTransition("topic_pending", "experts_pending")).not.toThrow();
  expect(() => assertDigitalInterviewTransition("experts_pending", "questions_pending")).not.toThrow();
  expect(() => assertDigitalInterviewTransition("questions_pending", "running")).not.toThrow();
  expect(() => assertDigitalInterviewTransition("running", "report_pending")).not.toThrow();
  expect(() => assertDigitalInterviewTransition("report_pending", "completed")).not.toThrow();
});

it("does not skip expert confirmation", () => {
  expect(() => assertDigitalInterviewTransition("topic_pending", "questions_pending"))
    .toThrow("DIGITAL_INTERVIEW_TRANSITION_INVALID");
});
```

- [ ] **Step 5: Implement the transition table and primary-action projection**

Keep one `Record<DigitalInterviewStatusName, readonly DigitalInterviewStatusName[]>`; use the same status input to project card actions and detail actions.

- [ ] **Step 6: Run contract, domain, type, and architecture checks**

Run:

```bash
pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts
pnpm --filter api test -- digital-workflow-transition.test.ts
pnpm lint:arch-deps
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/contracts/src/interview.ts packages/contracts/tests/digital-interview-contract.test.ts apps/api/src/domain/interview/digital-workflow.ts apps/api/tests/itv/digital-workflow-transition.test.ts
git commit -m "feat(interview): define digital interview workflow contract"
```

---

### Task 2: Persistent draft, experts, questions, runs, and report use cases

**Files:**
- Create: `apps/api/migrations/20260811213000_digital_interview_studio.sql`
- Create: `apps/api/src/application/interview/digital-interview-ports.ts`
- Create: `apps/api/src/application/interview/create-digital-interview-draft.ts`
- Create: `apps/api/src/application/interview/confirm-digital-topic.ts`
- Create: `apps/api/src/application/interview/update-digital-experts.ts`
- Create: `apps/api/src/application/interview/update-digital-questions.ts`
- Create: `apps/api/src/application/interview/run-digital-interviews.ts`
- Create: `apps/api/src/application/interview/generate-digital-report.ts`
- Create: `apps/api/src/infrastructure/interview/pg-digital-interview-repository.ts`
- Create: `apps/api/tests/itv/digital-interview-use-cases.test.ts`

**Interfaces:**
- Consumes: Task 1 contract schemas and `assertDigitalInterviewTransition`.
- Produces: `DigitalInterviewRepository`, `DigitalExpertGenerator`, `DigitalQuestionGenerator`, `DigitalInterviewRunner`, and `DigitalReportGenerator` ports.
- Produces: use-case functions named after their files; all accept `{ deps, input }`-style typed arguments consistent with existing interview use cases.

- [ ] **Step 1: Write failing use-case tests with in-memory fakes**

Cover these assertions explicitly:

```ts
it("stores name, tags and topic before expert generation", async () => {
  const created = await createDigitalInterviewDraft(deps, {
    orgId, actorId, name: "德国采购决策链", tags: ["采购决策"], topic: "谁拥有否决权？",
  });
  expect(created.status).toBe("topic_pending");
  expect(generator.calls).toHaveLength(0);
});

it("blocks removing the final expert", async () => {
  await expect(updateDigitalExperts(deps, { orgId, actorId, interviewId, expertIds: [] }))
    .rejects.toThrow("DIGITAL_EXPERT_REQUIRED");
});

it("keeps completed runs when one expert retry fails", async () => {
  const result = await retryDigitalRun(deps, { orgId, actorId, interviewId, expertId: "e-2" });
  expect(result.runs.find(r => r.expertId === "e-1")?.status).toBe("completed");
});
```

- [ ] **Step 2: Run the use-case tests and verify they fail**

Run: `pnpm --filter api test -- digital-interview-use-cases.test.ts`

Expected: FAIL because ports and use cases do not exist.

- [ ] **Step 3: Add the database migration**

Create org-scoped tables for interviews, tags, selected experts, questions, quick messages, runs, answers, and report findings. Add foreign keys so a finding cannot reference a question from another expert. Add `updated_at`, unique ordering constraints, indexes for `(org_id, status, updated_at)`, and RLS policies using the same principal/org mechanism as existing interview tables. The application connection must not own these tables.

- [ ] **Step 4: Implement repository ports and use cases**

Enforce these source-level rules:

- `confirmDigitalTopic` changes `topic_pending → experts_pending` only after experts are stored.
- `updateDigitalExperts` rejects an empty confirmed roster.
- `updateDigitalQuestions` scopes every question to one selected expert.
- `runDigitalInterviews` updates experts independently and preserves successful runs on partial failure.
- `generateDigitalReport` refuses findings without `expertId + questionId` and marks every finding exploratory.

- [ ] **Step 5: Implement the PostgreSQL adapter and round-trip integration assertions**

Use parameterized SQL only. Verify draft reload, expert deletion, per-expert question ordering, partial run failure, and report source traceability after a fresh repository instance reads the rows.

- [ ] **Step 6: Run API tests, migrations, and dependency lint**

Run:

```bash
pnpm --filter api test -- digital-interview-use-cases.test.ts
pnpm --filter api run migrate
pnpm lint:arch-deps
pnpm --filter api typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/api/migrations apps/api/src/application/interview apps/api/src/infrastructure/interview apps/api/tests/itv/digital-interview-use-cases.test.ts
git commit -m "feat(interview): persist digital interview workflow"
```

---

### Task 3: Authenticated HTTP surface and typed web client

**Files:**
- Create: `apps/api/src/interface/controllers/digital-interview.controller.ts`
- Modify: API module that registers `InterviewScopeController` to also register `DigitalInterviewController`
- Create: `apps/api/tests/itv/digital-interview-controller.test.ts`
- Create: `apps/web/lib/interview-api.ts`
- Create: `apps/web/tests/interview-api.test.ts`

**Interfaces:**
- Consumes: Task 1 `digitalInterviewOperations` and Task 2 use cases.
- Produces: REST routes under `/digital-interviews` and typed web functions `listInterviewHistory`, `listDigitalExperts`, `getDigitalInterview`, `createDigitalInterviewDraft`, `confirmDigitalTopic`, `saveDigitalExperts`, `saveDigitalQuestions`, `startDigitalRuns`, `retryDigitalRun`, `appendQuickInterviewMessage`, `convertQuickInterview`, and `generateDigitalInterviewReport`.

- [ ] **Step 1: Write controller tests for validation, auth, and status conflicts**

Assert unauthenticated requests are rejected, invalid empty tags return 400, stale status updates return 409 `CONCURRENT_MODIFICATION`, and an unknown interview is indistinguishable from an inaccessible interview.

- [ ] **Step 2: Run the controller test and verify it fails**

Run: `pnpm --filter api test -- digital-interview-controller.test.ts`

- [ ] **Step 3: Implement the controller as a thin adapter**

Apply each Task 1 `.in` schema with `ZodBodyPipe`, derive `orgId` and `actorId` only from `CurrentPrincipal`, and delegate every rule to Task 2 use cases. Do not import the PG repository into the controller.

- [ ] **Step 4: Write failing web-client tests**

```ts
it("uses the canonical history endpoint", async () => {
  await listInterviewHistory({ status: "running" });
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/digital-interviews?status=running"), expect.any(Object));
});
```

- [ ] **Step 5: Implement the typed client with `apiRequest`**

Parse every response using the Task 1 output schema before returning it. Export no duplicate frontend-only status enum.

- [ ] **Step 6: Run focused and package checks**

Run:

```bash
pnpm --filter api test -- digital-interview-controller.test.ts
pnpm --filter web test -- interview-api.test.ts
pnpm --filter api typecheck
pnpm --filter web typecheck
```

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/api/src/interface apps/api/tests/itv/digital-interview-controller.test.ts apps/web/lib/interview-api.ts apps/web/tests/interview-api.test.ts
git commit -m "feat(interview): expose digital interview API"
```

---

### Task 4: Studio home, history cards, and expert cards

**Files:**
- Modify: `apps/web/app/itv/page.tsx`
- Modify: `apps/web/components/itv/itv-workspace.tsx`
- Create: `apps/web/components/itv/studio-home.tsx`
- Create: `apps/web/components/itv/history-cards.tsx`
- Create: `apps/web/components/itv/expert-cards.tsx`
- Create: `apps/web/tests/ui/interview-studio-home.test.tsx`

**Interfaces:**
- Consumes: Task 3 `listInterviewHistory` and `listDigitalExperts`.
- Produces: `StudioHome({ initialTab, history, experts })`, `HistoryCards`, and `ExpertCards`.

- [ ] **Step 1: Write failing UI tests**

```tsx
it("renders exactly two primary tabs and defaults to history", () => {
  render(<StudioHome initialTab="history" history={history} experts={experts} />);
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  expect(screen.getByTestId("interview-history-panel")).toBeVisible();
});

it("maps canonical status to the correct card action", () => {
  render(<HistoryCards items={history} />);
  expect(screen.getByTestId("interview-card-running-primary")).toHaveTextContent("继续访谈");
  expect(screen.getByTestId("interview-card-completed-primary")).toHaveTextContent("查看报告");
});
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run: `pnpm --filter web test -- interview-studio-home.test.tsx`

- [ ] **Step 3: Implement the confirmed home UI**

Remove the template/persona-first landing experience from the canonical `/itv` render path. Keep old components only if another signed route still references them; do not delete historical files speculatively. Add test IDs:

- `interview-studio-home`
- `interview-tab-history`
- `interview-tab-experts`
- `interview-create-primary`
- `interview-history-panel`
- `interview-expert-panel`
- `interview-card-<id>`
- `expert-card-<id>-quick`

- [ ] **Step 4: Implement loading, empty, error, and denied states**

Use existing `StateShell` patterns. History empty state contains the new-interview action; expert empty state states why experts are unavailable and provides retry.

- [ ] **Step 5: Run UI, design, and type checks**

Run:

```bash
pnpm --filter web test -- interview-studio-home.test.tsx
pnpm --filter web lint:design
pnpm --filter web typecheck
```

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/web/app/itv/page.tsx apps/web/components/itv apps/web/tests/ui/interview-studio-home.test.tsx
git commit -m "feat(interview): add history and expert studio tabs"
```

---

### Task 5: Full-page quick interview and five-step creation workflow

**Files:**
- Create: `apps/web/app/itv/quick/[interviewId]/page.tsx`
- Create: `apps/web/app/itv/new/page.tsx`
- Create: `apps/web/app/itv/[interviewId]/setup/page.tsx`
- Create: `apps/web/components/itv/quick-interview.tsx`
- Create: `apps/web/components/itv/digital-interview-workflow.tsx`
- Create: `apps/web/components/itv/workflow-topic-step.tsx`
- Create: `apps/web/components/itv/workflow-experts-step.tsx`
- Create: `apps/web/components/itv/workflow-questions-step.tsx`
- Create: `apps/web/components/itv/workflow-runs-step.tsx`
- Create: `apps/web/components/itv/workflow-report-step.tsx`
- Create: `apps/web/tests/ui/interview-workflow.test.tsx`

**Interfaces:**
- Consumes: all Task 3 mutation functions and Task 1 schemas.
- Produces: independent quick-chat page and resumable workflow components keyed by canonical status.

- [ ] **Step 1: Write failing workflow tests**

Cover: quick interview is a page rather than dialog; returning goes to `/itv?tab=experts`; topic step requires name/tag/topic; no real-person/persona options occur in the DOM; expert removal prevents zero experts; questions render per selected expert; a failed run exposes only that expert's retry; report findings render their expert/question source.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter web test -- interview-workflow.test.tsx`

- [ ] **Step 3: Implement quick interview routing**

`expert-card-<id>-quick` creates or resumes a quick-interview record and links to `/itv/quick/<interviewId>`. The back action links to `/itv?tab=experts`. `转为批量访谈` calls `convertQuickInterview`, then routes to `/itv/<newInterviewId>/setup` without losing messages. Creating a new batch interview starts at `/itv/new`; after the step-one draft is persisted, navigation replaces that URL with `/itv/<interviewId>/setup` so refresh and resume have a durable identifier.

- [ ] **Step 4: Implement topic, expert, and question steps**

Use real form controls and accessible labels. Topic confirmation is the only action that calls expert generation. Expert confirmation is disabled with an inline error when the roster is empty. Question tabs use expert IDs, not array indexes.

- [ ] **Step 5: Implement run and report steps**

Poll run status with bounded condition-based refresh; do not use a fixed “assume complete after N seconds” timer. Preserve completed expert rows when a peer fails. Report findings show an explicit source link labeled with expert and question.

- [ ] **Step 6: Run UI, design, and type checks**

Run:

```bash
pnpm --filter web test -- interview-workflow.test.tsx
pnpm --filter web lint:design
pnpm --filter web typecheck
```

- [ ] **Step 7: Commit Task 5**

```bash
git add apps/web/app/itv apps/web/components/itv apps/web/tests/ui/interview-workflow.test.tsx
git commit -m "feat(interview): add quick and batch interview flows"
```

---

### Task 6: Detail page, deterministic back navigation, and responsive actions

**Files:**
- Create: `apps/web/app/itv/[interviewId]/page.tsx`
- Create: `apps/web/app/itv/[interviewId]/report/page.tsx`
- Create: `apps/web/components/itv/interview-detail-page.tsx`
- Create: `apps/web/tests/ui/interview-detail-navigation.test.tsx`

**Interfaces:**
- Consumes: Task 3 `getDigitalInterview` and Task 1 `primaryActionForStatus` projection.
- Produces: `InterviewDetailPage({ interview })` with overview, experts/questions, records, materials/findings, and report sections.

- [ ] **Step 1: Write failing navigation and layout tests**

```tsx
it("returns to the history tab with a deterministic href", () => {
  render(<InterviewDetailPage interview={runningInterview} />);
  expect(screen.getByTestId("interview-back-history")).toHaveAttribute("href", "/itv?tab=history");
});

it("keeps header actions as non-wrapping labels", () => {
  render(<InterviewDetailPage interview={runningInterview} />);
  expect(screen.getByTestId("interview-detail-actions")).toHaveClass("flex-wrap");
  expect(screen.getByTestId("interview-detail-new")).toHaveClass("whitespace-nowrap");
  expect(screen.getByTestId("interview-detail-primary")).toHaveClass("whitespace-nowrap");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter web test -- interview-detail-navigation.test.tsx`

- [ ] **Step 3: Implement the detail layout and state card**

Display overall status, current step, expert completion count, last updated time, question count, and material count from the same detail payload. Do not reconstruct status from counts in the frontend.

- [ ] **Step 4: Implement deterministic return and complete button layout**

Use a Next `Link` to `/itv?tab=history`; do not call `router.back()`. Give both header buttons `whitespace-nowrap` and a stable minimum width; make the enclosing action group `flex flex-wrap` so it moves as a unit at narrow widths.

- [ ] **Step 5: Run focused tests and design checks**

Run:

```bash
pnpm --filter web test -- interview-detail-navigation.test.tsx
pnpm --filter web lint:design
pnpm --filter web typecheck
```

- [ ] **Step 6: Commit Task 6**

```bash
git add apps/web/app/itv/[interviewId] apps/web/components/itv/interview-detail-page.tsx apps/web/tests/ui/interview-detail-navigation.test.tsx
git commit -m "feat(interview): add resumable interview detail page"
```

---

### Task 7: Full-stack navigation, persistence, failure, and responsive verification

**Files:**
- Create: `apps/web/e2e/digital-interview-studio.spec.ts`
- Modify: the relevant Playwright full-stack configuration only if the existing config does not discover the new file
- Create: sprint `evidence/` screenshots and command logs through the harness-selected feature path

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: executable proof of the approved workflow from real navigation entry through persisted report.

- [ ] **Step 1: Write the failing end-to-end happy path**

The Playwright test must:

1. Log in through the real login page.
2. Reach Interview Studio by clicking the existing product navigation, not by direct URL only.
3. Verify history is the default tab and cards show running/pending/completed statuses.
4. Open a running card, click `interview-back-history`, and verify history cards are visible.
5. Switch to experts, open quick interview, send one message, convert it, and verify the new history record.
6. Create a batch interview with name/tag/topic, confirm experts, inspect different questions per expert, run the batch, and generate a report.
7. Reload after each durable transition and verify the current step survives.
8. Open one finding source and verify it identifies the exact expert/question.

- [ ] **Step 2: Add failure-path coverage**

Intercept or use sanctioned deterministic stubs to prove: expert generation retry preserves topic; one question-generation failure does not clear other experts; one run failure preserves completed runs; report retry preserves sources.

- [ ] **Step 3: Add desktop and narrow-width layout assertions**

At desktop width, assert both detail buttons are visible and their `scrollWidth <= clientWidth`. At the supported narrow breakpoint, assert the action group wraps without either button being clipped. Save screenshots for home history, experts, detail, quick chat, topic step, expert step, question step, run step, and report.

- [ ] **Step 4: Run the full verification set**

Run:

```bash
pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts
pnpm --filter api test -- digital-workflow-transition.test.ts digital-interview-use-cases.test.ts digital-interview-controller.test.ts
pnpm --filter web test -- interview-api.test.ts interview-studio-home.test.tsx interview-workflow.test.tsx interview-detail-navigation.test.tsx
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter api typecheck
pnpm --filter web e2e -- digital-interview-studio.spec.ts
pnpm harness doctor --phase 01
```

Expected: every command exits 0; the final harness command records evidence and advances only the assigned feature.

- [ ] **Step 5: Run counterproofs**

Temporarily break the history return href, allow an empty expert roster, remove `questionId` from a report finding, and force one failed run to clear completed peers. Each relevant test must fail for the intended reason. Revert each counterproof immediately after observing the failure.

- [ ] **Step 6: Commit Task 7**

```bash
git add apps/web/e2e/digital-interview-studio.spec.ts
git commit -m "test(interview): verify digital interview studio end to end"
```

---

## Execution Order and Review Gates

1. Phase 04 F01 executes Tasks 1–2 on one feature branch and merges the contract, state machine and persistence foundation together.
2. F02 executes Tasks 3–4 and merges the protected API/client plus real history/expert home; contract fixtures must be removed before its PR is reviewable.
3. Task 5 is three serial vertical features because it shares `/itv` files: F03 quick interview, F04 topic/expert/question setup, then F05 batch runs and retry.
4. F06 executes Task 6 plus the traceable report page after F05 has merged.
5. F07 runs Task 7 only after F01–F06 are on the integration base.

Before executing Task 1, run `pnpm harness readiness`, sync Phase 04 GitHub issues, create an isolated `worker/<owner>-04-<feature>` worktree, and confirm `digital-expert-interview` plus Phase 04 coherence are human-confirmed. Do not mutate `active-features.json` or signoff status manually.
