# Digital Interview F05 LangGraph Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute one resumable LangGraph subgraph per selected digital expert, persist answers and source pointers, and expose reliable progress, retry, and timeline recovery.

**Architecture:** The parent interview graph fans out immutable expert-run inputs after questions are confirmed. Each run has its own durable business row and LangGraph checkpoint namespace; model output is permission-rechecked and committed idempotently before the parent graph observes completion. The browser reads progress from business projections and resumes the timeline with an SSE cursor.

**Tech Stack:** TypeScript LangGraph, NestJS, PostgreSQL/PostgresSaver, Context Pack API, model provider port, SSE, Next.js, React, Vitest

## Global Constraints

- F04 persistent setup must already be merged into `main`; this is a separate F05 issue and PR.
- Each expert run is independently retryable and has no shared mutable answer buffer.
- Recheck interview and Context Pack permission before model call, after model call, and before commit.
- If permission is revoked midway, persist no answer and return `PERMISSION_REVOKED_MIDWAY`.
- Answers and exact source pointers live only in business tables; checkpoints store IDs and run state.
- Every write accepts `requestId` and `expectedVersion`; duplicate starts and retries are idempotent.
- Timeline reconnect uses a durable monotonic event cursor; it must not infer progress from the client clock.
- Failure of one expert does not erase completed expert results or block safe retry.
- No report generation belongs in F05.

---

## File Map

- Modify `packages/contracts/src/interview.ts`: run, retry, timeline, answer, and progress schemas.
- Create `apps/api/migrations/20260815xxxxxx_f05_digital_interview_runs.sql`: runs, answers, timeline events, RLS/FKs.
- Create `apps/api/src/application/interview/workflow/digital-expert-run-graph.ts`: per-expert subgraph.
- Modify `apps/api/src/application/interview/workflow/digital-interview-graph.ts`: parent fan-out/join.
- Extend `apps/api/src/application/interview/workflow/digital-interview-effects.port.ts`: run commit operations.
- Extend `apps/api/src/infrastructure/interview/workflow/pg-digital-interview-effects.ts`: run/answer/event transactions.
- Modify `apps/api/src/interface/controllers/digital-interview.controller.ts`: start/retry/read endpoints.
- Create `apps/api/src/interface/controllers/digital-interview-events.controller.ts`: SSE with cursor.
- Modify `apps/web/lib/interview-api.ts` and F05 workflow UI for progress/retry/recovery.

### Task 1: Define F05 run and timeline contracts

**Files:**
- Modify: `packages/contracts/src/interview.ts`
- Test: `packages/contracts/tests/digital-interview-contract.test.ts`

**Interfaces:**
- Consumes: F04 `DigitalInterviewWorkflowView` and confirmed question version ID.
- Produces: `DigitalInterviewRun`, `DigitalInterviewAnswer`, `DigitalInterviewTimelineEvent`; operations `startDigitalInterviewRuns`, `retryDigitalExpertRun`, `listDigitalInterviewEvents`.

- [ ] **Step 1: Write failing schema tests**

Assert start/retry require `interviewId`, `requestId`, and `expectedVersion`; event cursor is an opaque string; source pointers require `runId`, `segmentId`, and `artifactVersionId`.

- [ ] **Step 2: Run the contract test**

Run: `pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts`

Expected: FAIL because F05 operations are absent.

- [ ] **Step 3: Implement strict schemas and operations**

Run states are `queued|running|completed|failed|permission_revoked`; progress is server-derived counts plus the immutable question version ID.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts && pnpm --filter @repo/contracts typecheck`

Expected: PASS.

```bash
git add packages/contracts
git commit -m "feat(interview): define resumable run contracts"
```

### Task 2: Add run, answer, and event persistence

**Files:**
- Create: `apps/api/migrations/20260815xxxxxx_f05_digital_interview_runs.sql`
- Test: `apps/api/tests/itv/digital-interview-runs-migration.test.ts`

**Interfaces:**
- Consumes: F04 interview revisions and question versions.
- Produces: `digital_interview_runs`, `digital_interview_answers`, `digital_interview_timeline_events` with composite tenant FKs and RLS.

- [ ] **Step 1: Write a failing migration test**

Assert one run per expert/question-version/attempt, answer uniqueness per run/question, event cursor monotonicity, exact source-pointer JSON validation, and cross-org FK rejection.

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter api test -- digital-interview-runs-migration.test.ts`

Expected: FAIL because tables do not exist.

- [ ] **Step 3: Implement the migration and policies**

Store raw answer text, model/run provenance, `permission_decision_id`, source pointers, failure code, attempt, and timestamps. Do not store report Markdown.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter api test -- digital-interview-runs-migration.test.ts && pnpm --filter api run migrate:check`

Expected: PASS.

```bash
git add apps/api/migrations apps/api/tests/itv/digital-interview-runs-migration.test.ts
git commit -m "feat(interview): persist expert runs and timeline"
```

### Task 3: Implement the per-expert LangGraph subgraph

**Files:**
- Create: `apps/api/src/application/interview/workflow/digital-expert-run-graph.ts`
- Modify: `apps/api/src/application/interview/workflow/digital-interview-graph.ts`
- Modify: `apps/api/src/application/interview/workflow/digital-interview-effects.port.ts`
- Test: `apps/api/tests/itv/digital-expert-run-graph.test.ts`

**Interfaces:**
- Consumes: immutable expert snapshot, question version, Context Pack reader, model provider, effect port.
- Produces: nodes `authorize_run -> load_material -> answer_questions -> recheck_permission -> commit_answers -> complete_run` and parent fan-out/join.

- [ ] **Step 1: Write failing graph tests**

Cover successful run, two experts completing out of order, material unavailable, model failure, permission revoked after model response, and replay after commit.

- [ ] **Step 2: Run the graph test**

Run: `pnpm --filter api test -- digital-expert-run-graph.test.ts`

Expected: FAIL with missing subgraph.

- [ ] **Step 3: Implement the graph without SQL**

The model prompt contains the expert snapshot, confirmed questions, and authorized material content. Build source pointers only from material actually included in the prompt. Model response remains in node memory until the post-model permission check succeeds.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter api test -- digital-expert-run-graph.test.ts && pnpm --filter api typecheck`

Expected: PASS.

```bash
git add apps/api/src/application/interview/workflow apps/api/tests/itv/digital-expert-run-graph.test.ts
git commit -m "feat(interview): add per-expert run subgraph"
```

### Task 4: Persist run effects and fast recovery

**Files:**
- Modify: `apps/api/src/infrastructure/interview/workflow/pg-digital-interview-effects.ts`
- Modify: `apps/api/src/infrastructure/interview/workflow/langgraph-digital-interview-runtime.ts`
- Test: `apps/api/tests/itv/digital-interview-run-recovery.test.ts`

**Interfaces:**
- Consumes: subgraph commands from Task 3 and tables from Task 2.
- Produces: idempotent start/answer/fail/retry/event effects and recovered parent progress.

- [ ] **Step 1: Write failing PostgreSQL recovery tests**

Kill/recreate the runtime after one expert completes, resume with the same `thread_id`, assert completed answers are not regenerated, failed experts remain retryable, and duplicate retry request IDs return the same attempt.

- [ ] **Step 2: Run the recovery test**

Run: `pnpm --filter api test -- digital-interview-run-recovery.test.ts`

Expected: FAIL because effects are not implemented.

- [ ] **Step 3: Implement transactional effects**

Use the F04 receipt pattern. Append one timeline event in the same transaction as every run state transition. Parent completion is derived from business rows, not a client callback.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter api test -- digital-interview-run-recovery.test.ts && pnpm --filter api typecheck`

Expected: PASS.

```bash
git add apps/api/src/infrastructure/interview/workflow apps/api/tests/itv/digital-interview-run-recovery.test.ts
git commit -m "feat(interview): recover expert runs idempotently"
```

### Task 5: Expose run commands and cursor-based timeline

**Files:**
- Modify: `apps/api/src/interface/controllers/digital-interview.controller.ts`
- Create: `apps/api/src/interface/controllers/digital-interview-events.controller.ts`
- Modify: `apps/api/src/kernel.module.ts`
- Test: `apps/api/tests/itv/digital-interview-runs-controller.test.ts`

**Interfaces:**
- Consumes: F05 runtime/effects.
- Produces: start, retry, progress GET, and `GET /interviews/digital/:interviewId/events?after=<cursor>` SSE.

- [ ] **Step 1: Write failing HTTP/SSE tests**

Assert idempotent double start, concurrent start, retry of only failed expert, exact 404 concealment, SSE replay after cursor, and no event leakage across orgs.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter api test -- digital-interview-runs-controller.test.ts`

Expected: FAIL with missing routes.

- [ ] **Step 3: Implement controllers and provider binding**

Use heartbeat comments only to keep the SSE connection open; progress and event content come from durable rows. Close subscriptions on disconnect.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter api test -- digital-interview-runs-controller.test.ts && pnpm --filter api typecheck`

Expected: PASS.

```bash
git add apps/api/src/interface/controllers apps/api/src/kernel.module.ts apps/api/tests/itv/digital-interview-runs-controller.test.ts
git commit -m "feat(interview): expose resumable run timeline"
```

### Task 6: Connect the run UI and prove F05

**Files:**
- Modify: `apps/web/lib/interview-api.ts`
- Modify: `apps/web/components/itv/digital-interview-workflow.tsx`
- Test: `apps/web/tests/ui/interview-run-workflow.test.tsx`

**Interfaces:**
- Consumes: F05 HTTP/SSE operations.
- Produces: persistent per-expert status, retry, refresh recovery, and automatic transition to report pending.

- [ ] **Step 1: Write failing UI tests**

Assert start uses a stable request ID, reload restores mixed completed/failed states, retry targets one expert, SSE reconnect supplies the last cursor, and leaving the page never discards completed results.

- [ ] **Step 2: Run UI tests**

Run: `pnpm --filter web test -- interview-run-workflow.test.tsx`

Expected: FAIL because `RunStep` immediately fabricates a Mock report.

- [ ] **Step 3: Implement API/SSE-backed run UI**

Render status from the server view. On SSE failure show reconnecting state and continue polling the GET projection; never regress a completed run to queued based on stale events.

- [ ] **Step 4: Run all F05 gates**

Run: `pnpm --filter web test -- interview-run-workflow.test.tsx && pnpm --filter web typecheck && pnpm --filter api test -- digital-interview-run && pnpm --filter api run migrate:check`

Expected: PASS.

- [ ] **Step 5: Commit and deliver one F05 PR**

```bash
git add apps/web
git commit -m "feat(interview): show resumable expert runs"
```

Run `pnpm harness verify --sprint 04/01` and `pnpm harness doctor --phase 04`, record evidence, then open one PR with `Closes #<F05 issue>`.
