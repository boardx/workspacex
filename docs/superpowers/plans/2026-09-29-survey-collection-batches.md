# Survey Collection Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make stopped surveys safely republishable through immutable collection batches and align the publish workspace with the approved full-width prototype.

**Architecture:** Introduce a batch record beside the legacy publication projection, associate each answer with its batch, and add a closed-only republish command that creates a fresh token and snapshot. The Web workspace derives status, statistics, sharing, settings and activity from a selected batch while keeping draft and ready flows unchanged.

**Tech Stack:** TypeScript, Zod contracts, NestJS, React, Tailwind, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-survey-collection-batches-design.md`

## Global Constraints

- Published batch snapshots, links, deadlines, anonymity and answers are immutable.
- Republish creates a fresh link and batch; it never reopens an old link.
- Legacy `publication` payloads remain readable and migrate only on a later mutation.
- No public response may be attributed to the wrong batch or accepted through a closed token.

## Review Focus

- A stale `expectedVersion` republish must fail without creating a second batch; Task 2 service test owns this.
- A closed token must remain rejected after republish; Task 3 public-submission test owns this.
- Legacy surveys with only `publication` must render and mutate safely; Task 1 contract/service regression owns this.
- The selected historical batch must be read-only in the workspace; Task 4 UI test owns this.
- Narrow desktop width and small mobile view must retain the expected two-column/single-column hierarchy; Task 4 visual regression owns this.

## File structure

- `packages/contracts/src/survey-runtime.ts`: batch and response schema contracts.
- `apps/api/src/domain/survey/state-machine.ts`: closed-only `republish` transition.
- `apps/api/src/application/survey/survey-service.ts`: batch creation, compatibility hydration, batch-token lookup and attribution.
- `apps/api/src/interface/controllers/survey.controller.ts`: `POST /surveys/:id/republish`.
- `apps/api/tests/survey/*`: lifecycle and public submission regression coverage.
- `apps/web/components/survey/live/collection-overview.tsx`: selected-batch metrics/activity display.
- `apps/web/components/survey/live/survey-workspace.tsx`: full-width prototype layout, batch selector and republish action.
- `apps/web/tests/ui/survey-live-publishing.test.tsx`: publish workspace interaction coverage.

### Task 1: Define batch-compatible survey contracts

**Files:**
- Modify: `packages/contracts/src/survey.ts`
- Modify: `packages/contracts/src/survey-runtime.ts`
- Test: `packages/contracts/src/survey-runtime.test.ts`

**Interfaces:**
- Produces `SurveyCollectionBatchSchema`, `SurveyRuntime.collectionBatches`, `SurveyRuntime.activeCollectionBatchId`, and `SurveyResponse.collectionBatchId` for Tasks 2–4.

- [ ] **Step 1: Write failing contract tests**

Assert that a runtime with two immutable batches and responses tagged by each batch parses, and that a legacy runtime containing only `publication` remains valid.

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `pnpm --filter @repo/contracts vitest run src/survey-runtime.test.ts`

Expected: FAIL because batch fields are absent.

- [ ] **Step 3: Add Zod batch and response attribution schemas**

Define `SurveyCollectionBatchSchema` using the current publication snapshot shape plus `id`, `createdAt`, `closedAt`; add optional legacy-compatible batch fields to `SurveyRuntimeSchema` without making older persisted `publication` invalid.

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `pnpm --filter @repo/contracts vitest run src/survey-runtime.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat(survey): add collection batch contracts"`

### Task 2: Implement immutable close and republish lifecycle

**Files:**
- Modify: `apps/api/src/domain/survey/state-machine.ts`
- Modify: `apps/api/src/application/survey/survey-service.ts`
- Modify: `apps/api/src/interface/controllers/survey.controller.ts`
- Test: `apps/api/tests/survey/state-machine-four.test.ts`
- Test: `apps/api/tests/survey/survey-source-lifecycle.test.ts`

**Interfaces:**
- Consumes Task 1 batch fields.
- Produces `SurveyService.republish(orgId, actor, id, expectedVersion, expiresAt?)` and `POST /surveys/:id/republish` for Task 4.

- [ ] **Step 1: Write failing lifecycle tests**

Add tests proving `closed → republish → collecting` creates a second batch with a fresh token, preserves the first batch snapshot and answers, and rejects a stale republish request.

- [ ] **Step 2: Run the API tests to verify they fail**

Run: `pnpm --filter @repo/api vitest run tests/survey/state-machine-four.test.ts tests/survey/survey-source-lifecycle.test.ts`

Expected: FAIL because `republish` does not exist.

- [ ] **Step 3: Add the state transition, service method and controller endpoint**

Create one batch in the existing publication start helper, close the active batch without mutation, and have `republish` validate only a closed survey before creating its new active batch. Use `SurveyPublishInputSchema` for the endpoint body.

- [ ] **Step 4: Run lifecycle tests to verify they pass**

Run: `pnpm --filter @repo/api vitest run tests/survey/state-machine-four.test.ts tests/survey/survey-source-lifecycle.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat(survey): support immutable collection republishing"`

### Task 3: Attribute public answers to the resolved batch

**Files:**
- Modify: `apps/api/src/application/survey/survey-service.ts`
- Modify: `apps/api/src/infrastructure/survey/pg-survey-attachment-repository.ts`
- Create: `apps/api/tests/survey/survey-public-submission.test.ts`

**Interfaces:**
- Consumes Task 1 `collectionBatchId` and Task 2 batch-token lifecycle.
- Produces batch-safe public lookup and submission behavior used by reports and Task 4 metrics.

- [ ] **Step 1: Write failing public submission tests**

Submit through the first token, close and republish, then submit through the second token. Assert answers receive different batch ids and the closed first token is rejected.

- [ ] **Step 2: Run the public submission test to verify it fails**

Run: `pnpm --filter @repo/api vitest run tests/survey/survey-public-submission.test.ts`

Expected: FAIL because token resolution only examines one publication.

- [ ] **Step 3: Resolve tokens against batch history and stamp response attribution**

Update public lookup, duplicate/browser-proof checks and attachment checks to use the matched collecting batch; persist its id on the response.

- [ ] **Step 4: Run the public submission test to verify it passes**

Run: `pnpm --filter @repo/api vitest run tests/survey/survey-public-submission.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat(survey): attribute answers to collection batches"`

### Task 4: Rebuild the published collection workspace

**Files:**
- Modify: `apps/web/components/survey/live/collection-overview.tsx`
- Modify: `apps/web/components/survey/live/survey-workspace.tsx`
- Test: `apps/web/tests/ui/survey-live-publishing.test.tsx`
- Test: `apps/web/tests/ui/survey-live-workspace.test.tsx`

**Interfaces:**
- Consumes Task 1 runtime batch fields and Task 2 `POST /republish` endpoint.
- Produces the prototype-aligned collection UI.

- [ ] **Step 1: Write failing UI tests**

Assert that closed collection renders a visible `再次发布` action, sends the current version to `/republish`, updates to the new active batch, exposes historical-batch selection as read-only, and uses the same desktop width as sibling workspace steps.

- [ ] **Step 2: Run UI tests to verify they fail**

Run: `pnpm --filter web vitest run tests/ui/survey-live-publishing.test.tsx tests/ui/survey-live-workspace.test.tsx`

Expected: FAIL because the stopped workspace has no republish action or batch selector.

- [ ] **Step 3: Implement selected-batch view and lifecycle actions**

Replace the `max-w-7xl` publish wrapper with the shared workspace width; arrange left status/metrics/share and right frozen settings/history/activity cards. Show `停止回收` only for the active collecting batch and `再次发布` only when the active batch is closed.

- [ ] **Step 4: Run UI tests to verify they pass**

Run: `pnpm --filter web vitest run tests/ui/survey-live-publishing.test.tsx tests/ui/survey-live-workspace.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat(survey): align collection workspace with prototype"`

### Task 5: Verify, document evidence and deliver

**Files:**
- Modify: `.agents/skills/mod-survey/SKILL.md`
- Test: affected API, contracts and Web suites from Tasks 1–4

- [ ] **Step 1: Run the affected verification suites**

Run: `pnpm --filter @repo/contracts vitest run src/survey-runtime.test.ts && pnpm --filter @repo/api vitest run tests/survey/state-machine-four.test.ts tests/survey/survey-source-lifecycle.test.ts tests/survey/survey-public-submission.test.ts && pnpm --filter web vitest run tests/ui/survey-live-publishing.test.tsx tests/ui/survey-live-workspace.test.tsx && pnpm --filter web typecheck && pnpm --filter web lint`

Expected: every command exits 0.

- [ ] **Step 2: Record the verified batch-model lesson**

Append the tested compatibility/immutability lesson and its PR/issue evidence to `mod-survey`.

- [ ] **Step 3: Commit, push, open a PR and monitor all CI checks**

Use `Closes #4611`; respond to review findings and merge only after required checks are green.

## Plan self-review

- Spec coverage: Tasks 1–3 cover batch data, lifecycle, compatibility and public attribution; Task 4 covers the approved UI; Task 5 covers verification and knowledge return.
- Type consistency: `SurveyCollectionBatchSchema`, `collectionBatchId`, and `SurveyService.republish` are the only new cross-task interface names.
- Review focus: every listed risk is assigned to a concrete test task.
- Proportion: the plan specifies interfaces and tests but leaves implementation bodies to the executor.
