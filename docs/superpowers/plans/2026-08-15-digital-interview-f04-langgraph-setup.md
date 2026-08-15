# Digital Interview F04 LangGraph Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Mock-only topic, expert, question, and Skill refinement flow with explicit-confirmation APIs backed by PostgreSQL business tables and a TypeScript LangGraph PostgreSQL checkpoint.

**Architecture:** `apps/api` owns a LangGraph whose human-interrupt nodes are `confirm_topic`, `confirm_experts`, and `confirm_questions`. Each confirmation executes an idempotent business transaction first and then checkpoints small orchestration state; the browser keeps unconfirmed edits in component state only. Skill chat is persisted immediately, but its proposal only changes the local draft after an explicit apply and only becomes durable workflow data after the step confirmation.

**Tech Stack:** TypeScript, NestJS, Zod contracts, PostgreSQL/RLS, `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`, Next.js, React, Vitest, Testing Library

## Global Constraints

- Use TypeScript LangGraph inside `apps/api`; do not call the legacy Python user-research graph.
- Use PostgreSQL Checkpointer plus normalized business tables; checkpoints contain identifiers and orchestration state, never full answers or report bodies.
- Use `thread_id = interviewId` and `checkpoint_ns = digital-interview:v1`.
- No input debounce or autosave: only an explicit step confirmation persists topic, experts, or questions.
- Warn before leaving a dirty unconfirmed step; discard only after explicit user confirmation.
- Every write accepts `requestId` and `expectedVersion`; retries are idempotent and concurrent changes return `CONCURRENT_MODIFICATION`.
- Skill messages persist immediately; proposals require preview and apply, cannot silently mutate confirmed data, and retain their own `skillThreadId` context.
- An upstream confirmed-step change creates a new revision and marks downstream current versions `superseded` without deleting history.
- Preserve tenant isolation with RLS, composite `(org_id, …)` foreign keys, and permission rechecks before model calls, after model calls, and before writes.
- This plan is one F04 issue and one PR; it must not include F05 execution or F06 report generation.

---

## File Map

- Modify `packages/contracts/src/interview.ts`: make create input name/tags-only and add F04 read models and confirmation/Skill operations.
- Create `apps/api/src/application/interview/workflow/digital-interview-state.ts`: LangGraph state and command types.
- Create `apps/api/src/application/interview/workflow/digital-interview-effects.port.ts`: transaction boundary for node effects.
- Create `apps/api/src/application/interview/workflow/digital-interview-runtime.port.ts`: invoke/resume/read API used by controllers.
- Create `apps/api/src/application/interview/workflow/digital-interview-nodes.ts`: F04 node functions.
- Create `apps/api/src/application/interview/workflow/digital-interview-graph.ts`: graph edges and interrupts.
- Create `apps/api/src/infrastructure/interview/workflow/pg-digital-interview-effects.ts`: versioned business writes and receipts.
- Create `apps/api/src/infrastructure/interview/workflow/langgraph-digital-interview-runtime.ts`: PostgresSaver configuration and graph adapter.
- Modify `apps/api/src/application/interview/digital-interview-ports.ts`: normalized read repository interfaces.
- Modify `apps/api/src/infrastructure/interview/pg-digital-interview-repository.ts`: F04 read projections.
- Modify `apps/api/src/interface/controllers/digital-interview.controller.ts`: formal F04 endpoints.
- Modify `apps/api/src/kernel.module.ts`: bind runtime/effects/checkpointer providers.
- Create `apps/api/migrations/20260815xxxxxx_f04_digital_interview_workflow.sql`: revisions, versions, questions, Skill context, receipts, RLS, and cross-org FKs.
- Modify `apps/web/lib/interview-api.ts`: replace F04 Mock functions with contract-backed requests.
- Modify `apps/web/components/itv/digital-interview-workflow.tsx`: local dirty buffers, confirmation calls, recovery, leave prompt.
- Modify `apps/web/components/itv/interview-skill-assistant.tsx`: persisted message/proposal states.
- Modify `apps/web/app/itv/[interviewId]/setup/page.tsx`: load the server read model.
- Add/modify focused tests under `packages/contracts/tests`, `apps/api/tests/itv`, and `apps/web/tests/ui`.

### Task 1: Reconcile and re-sign the F04 contract bundle

**Files:**
- Modify: `phases/phase-04-digital-expert-interviews/contracts/digital-interview/domain.md`
- Modify: `phases/phase-04-digital-expert-interviews/contracts/digital-interview/usecases.md`
- Modify: `phases/phase-04-digital-expert-interviews/contracts/digital-interview/api.md`
- Read only: `phases/phase-04-digital-expert-interviews/contracts/digital-interview/design-signoff.md`

**Interfaces:**
- Consumes: approved UI behavior: create modal persists `name` and `tags`, then step 1 confirms `topic`.
- Produces: signed contract text that names explicit confirmation, dirty-step warning, Skill proposal lifecycle, `requestId`, and `expectedVersion`.

- [ ] **Step 1: Update the three contract documents without changing signoff status**

Specify `createDigitalInterview.in = { name, tags, scope, requestId }`, initial status `topic_pending`, and topic persistence only through `confirmDigitalInterviewTopic`.

- [ ] **Step 2: Run the design consistency checks**

Run: `pnpm --filter web run lint:design`

Expected: PASS. If the bundle requires human re-signoff, stop before Task 2 and present the exact diff; an agent must not edit `design-signoff.md` status.

- [ ] **Step 3: Commit the contract reconciliation**

```bash
git add phases/phase-04-digital-expert-interviews/contracts/digital-interview
git commit -m "docs(interview): reconcile explicit confirmation contract"
```

### Task 2: Add contract schemas for F04 persistence

**Files:**
- Modify: `packages/contracts/src/interview.ts`
- Test: `packages/contracts/tests/digital-interview-contract.test.ts`

**Interfaces:**
- Consumes: bundle from Task 1.
- Produces: `DigitalInterviewWorkflowView`, `DigitalInterviewQuestion`, `DigitalInterviewSkillMessage`, `DigitalInterviewSkillProposal`, and operations `confirmDigitalInterviewTopic`, `confirmDigitalInterviewExperts`, `confirmDigitalInterviewQuestions`, `appendDigitalInterviewSkillMessage`, `applyDigitalInterviewSkillProposal`, `rejectDigitalInterviewSkillProposal`.

- [ ] **Step 1: Write failing contract tests**

Add assertions equivalent to:

```ts
expect(interview.operations.createDigitalInterviewDraft.in.parse({
  name: "采购决策链", tags: ["采购"], scope, requestId: "req-create-1",
})).not.toHaveProperty("topic");

expect(interview.operations.confirmDigitalInterviewTopic.in.parse({
  interviewId: "itv-1", topic: "谁拥有否决权", expectedVersion: 1, requestId: "req-topic-1",
})).toMatchObject({ expectedVersion: 1 });

expect(() => interview.operations.confirmDigitalInterviewQuestions.in.parse({
  interviewId: "itv-1", questions: [], expectedVersion: 3, requestId: "req-q-1",
})).toThrow();
```

- [ ] **Step 2: Verify the tests fail for missing operations**

Run: `pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts`

Expected: FAIL because confirmation and Skill operations are undefined.

- [ ] **Step 3: Implement the schemas and operation registry entries**

Use strict schemas. All confirmation responses return the full `DigitalInterviewWorkflowView` including `currentStep`, `status`, `version`, active revision/version IDs, confirmed data, and active applied Skill proposals. Add `REQUEST_REPLAY_MISMATCH` to `InterviewError` for a reused request ID with a different payload.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts && pnpm --filter @repo/contracts typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/interview.ts packages/contracts/tests/digital-interview-contract.test.ts
git commit -m "feat(interview): define persistent setup contracts"
```

### Task 3: Add the F04 normalized persistence schema

**Files:**
- Create: `apps/api/migrations/20260815xxxxxx_f04_digital_interview_workflow.sql`
- Test: `apps/api/tests/itv/digital-interview-workflow-migration.test.ts`

**Interfaces:**
- Consumes: schema identifiers from Task 2.
- Produces: versioned revisions/topic/expert/question tables, Skill threads/messages/proposals, and `digital_interview_step_receipts`.

- [ ] **Step 1: Write a migration test that starts from the prior migration**

Assert tenant RLS, composite tenant FKs, uniqueness of `(org_id, interview_id, operation_id)`, one current version per revision, proposal states `proposed|applied_to_draft|rejected|committed|stale`, and replay safety.

- [ ] **Step 2: Run the focused migration test**

Run: `pnpm --filter api test -- digital-interview-workflow-migration.test.ts`

Expected: FAIL because the tables do not exist.

- [ ] **Step 3: Implement the migration**

Create `digital_interview_revisions`, `digital_interview_topic_versions`, `digital_interview_expert_snapshot_versions`, `digital_interview_expert_snapshots`, `digital_interview_question_versions`, `digital_interview_questions`, `digital_interview_skill_threads`, `digital_interview_skill_messages`, `digital_interview_skill_proposals`, and `digital_interview_step_receipts`. Every child carries `org_id`; every parent reference uses a composite tenant FK. Enable and force RLS, then grant only required CRUD to `app_rw`.

- [ ] **Step 4: Run migration verification**

Run: `pnpm --filter api test -- digital-interview-workflow-migration.test.ts && pnpm --filter api run migrate:check`

Expected: PASS including forced replay and schema digest checks.

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations apps/api/tests/itv/digital-interview-workflow-migration.test.ts
git commit -m "feat(interview): add versioned setup persistence"
```

### Task 4: Build the F04 LangGraph state, nodes, and idempotent effects

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/api/src/application/interview/workflow/digital-interview-state.ts`
- Create: `apps/api/src/application/interview/workflow/digital-interview-effects.port.ts`
- Create: `apps/api/src/application/interview/workflow/digital-interview-runtime.port.ts`
- Create: `apps/api/src/application/interview/workflow/digital-interview-nodes.ts`
- Create: `apps/api/src/application/interview/workflow/digital-interview-graph.ts`
- Test: `apps/api/tests/itv/digital-interview-graph.test.ts`

**Interfaces:**
- Consumes: operation DTOs from Task 2 and business identifiers from Task 3.
- Produces: `DigitalInterviewGraphState`, `DigitalInterviewCommand`, `DigitalInterviewEffects.commitStep(input)`, `DigitalInterviewRuntime.resume(input)`, and an F04 graph interrupted at all human confirmation nodes.

- [ ] **Step 1: Add failing graph transition tests**

Test `create_draft -> confirm_topic -> generate_expert_candidates -> confirm_experts -> generate_questions -> confirm_questions`, assert each human node interrupts, and assert `skill_refine` returns to its origin without changing confirmed version IDs.

- [ ] **Step 2: Run the graph test before adding dependencies**

Run: `pnpm --filter api test -- digital-interview-graph.test.ts`

Expected: FAIL with missing graph modules.

- [ ] **Step 3: Install exact compatible LangGraph packages**

Run: `pnpm --filter api add @langchain/langgraph@^0.4.9 @langchain/langgraph-checkpoint-postgres`

Expected: lockfile records the TypeScript packages; no Python dependency is added.

- [ ] **Step 4: Implement minimal state and nodes**

The state contains only `interviewId`, `orgId`, `actorId`, `revisionId`, `currentStep`, version IDs, `skillThreadId`, `lastOperationId`, and error metadata. Node effects use `operationId = interviewId:nodeName:revisionNumber:requestId` and call one effect port method; no SQL appears in graph files.

- [ ] **Step 5: Run graph tests and API typecheck**

Run: `pnpm --filter api test -- digital-interview-graph.test.ts && pnpm --filter api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/application/interview/workflow apps/api/tests/itv/digital-interview-graph.test.ts
git commit -m "feat(interview): add setup LangGraph"
```

### Task 5: Implement PostgresSaver and business effects

**Files:**
- Create: `apps/api/src/infrastructure/interview/workflow/pg-digital-interview-effects.ts`
- Create: `apps/api/src/infrastructure/interview/workflow/langgraph-digital-interview-runtime.ts`
- Modify: `apps/api/src/application/interview/digital-interview-ports.ts`
- Modify: `apps/api/src/infrastructure/interview/pg-digital-interview-repository.ts`
- Modify: `apps/api/src/kernel.module.ts`
- Test: `apps/api/tests/itv/digital-interview-langgraph-persistence.test.ts`

**Interfaces:**
- Consumes: graph/effect ports from Task 4 and tables from Task 3.
- Produces: PostgreSQL-backed `DigitalInterviewRuntime` with `PostgresSaver`, exactly-once business effects, recovery, and workflow read projection.

- [ ] **Step 1: Write failing integration tests**

Cover fresh create, explicit topic confirmation, replay of the same `requestId`, mismatched replay rejection, version conflict, crash after receipt but before checkpoint followed by safe resume, and process recreation followed by `getDigitalInterview` returning the same step/version.

- [ ] **Step 2: Run the integration test**

Run: `pnpm --filter api test -- digital-interview-langgraph-persistence.test.ts`

Expected: FAIL because runtime/effects providers are absent.

- [ ] **Step 3: Implement transaction and checkpoint adapters**

Configure `PostgresSaver` with schema `langgraph_interview`. Before every checkpoint operation, load the visible interview through the application permission path. In each effect transaction lock the interview row, compare `expectedVersion`, check/insert the receipt with a payload digest, write the versioned business rows, increment the interview version, and return the new read projection.

- [ ] **Step 4: Bind providers in `KernelModule`**

Expose symbols `DIGITAL_INTERVIEW_EFFECTS` and `DIGITAL_INTERVIEW_RUNTIME`; create one runtime over the configured API PostgreSQL pool. Checkpointer setup belongs to migrations/deployment and must not request DDL privilege during every application boot.

- [ ] **Step 5: Run persistence tests, migration check, and typecheck**

Run: `pnpm --filter api test -- digital-interview-langgraph-persistence.test.ts && pnpm --filter api run migrate:check && pnpm --filter api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/infrastructure/interview/workflow apps/api/src/application/interview/digital-interview-ports.ts apps/api/src/infrastructure/interview/pg-digital-interview-repository.ts apps/api/src/kernel.module.ts apps/api/tests/itv/digital-interview-langgraph-persistence.test.ts
git commit -m "feat(interview): persist setup graph and effects"
```

### Task 6: Expose confirmation and Skill APIs

**Files:**
- Modify: `apps/api/src/interface/controllers/digital-interview.controller.ts`
- Test: `apps/api/tests/itv/digital-interview-workflow-controller.test.ts`

**Interfaces:**
- Consumes: `DigitalInterviewRuntime` from Task 5.
- Produces: the six F04 write endpoints and expanded GET workflow view.

- [ ] **Step 1: Write failing HTTP tests**

Test authenticated create, all three confirmations, Skill send/apply/reject, refresh recovery, cross-org indistinguishable 404, dirty input absence from GET, and permission revocation between Skill generation and write returning `PERMISSION_REVOKED_MIDWAY` without a persisted assistant message/proposal.

- [ ] **Step 2: Run the controller tests**

Run: `pnpm --filter api test -- digital-interview-workflow-controller.test.ts`

Expected: FAIL with 404 for new routes.

- [ ] **Step 3: Implement thin controller methods**

Parse only with the shared Zod operations, derive `orgId/actorId` from `Principal`, invoke the runtime, and map domain errors to the existing safe HTTP error body. Do not reproduce state transition logic in the controller.

- [ ] **Step 4: Run API verification**

Run: `pnpm --filter api test -- digital-interview-workflow-controller.test.ts digital-interview-controller.test.ts && pnpm --filter api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/interface/controllers/digital-interview.controller.ts apps/api/tests/itv/digital-interview-workflow-controller.test.ts
git commit -m "feat(interview): expose setup confirmation APIs"
```

### Task 7: Replace Mock workflow persistence in the web app

**Files:**
- Modify: `apps/web/lib/interview-api.ts`
- Modify: `apps/web/app/itv/[interviewId]/setup/page.tsx`
- Modify: `apps/web/components/itv/digital-interview-setup.tsx`
- Modify: `apps/web/components/itv/digital-interview-workflow.tsx`
- Modify: `apps/web/components/itv/interview-skill-assistant.tsx`
- Test: `apps/web/tests/ui/interview-setup-workflow.test.tsx`
- Test: `apps/web/tests/ui/interview-skill-assistant.test.tsx`

**Interfaces:**
- Consumes: shared F04 operations from Task 2 and HTTP routes from Task 6.
- Produces: server-recovered workflow with local dirty edits and explicit persistence.

- [ ] **Step 1: Replace the test fixtures with mocked HTTP responses**

Assert typing does not call fetch; confirmation calls exactly once with `requestId/expectedVersion`; refresh uses GET; navigation from a dirty step opens the unsaved-change dialog; cancel stays; discard navigates; Skill send persists immediately; apply changes only the local buffer; step confirmation commits it.

- [ ] **Step 2: Run web tests and observe the Mock-path failure**

Run: `pnpm --filter web test -- interview-setup-workflow.test.tsx interview-skill-assistant.test.tsx`

Expected: FAIL because the component writes `localStorage` on every change.

- [ ] **Step 3: Implement API helpers and local buffers**

Keep one buffer per active step initialized from the server view. Mark dirty on edits. Generate a stable request ID per submit attempt and reuse it only for retry. After success replace the view and buffer with the server response. Render retryable dependency errors without discarding the buffer.

- [ ] **Step 4: Implement the unsaved-change and Skill proposal UI**

Intercept workflow-step buttons, the top-right return link, and `beforeunload` while dirty. Render proposal states from the server; applying a proposal patches the active buffer and keeps it dirty. Rejecting persists rejection. A committed/stale proposal cannot be applied again.

- [ ] **Step 5: Run web verification**

Run: `pnpm --filter web test -- interview-setup-workflow.test.tsx interview-skill-assistant.test.tsx && pnpm --filter web typecheck && pnpm --filter web run lint:design`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/interview-api.ts apps/web/app/itv apps/web/components/itv apps/web/tests/ui/interview-setup-workflow.test.tsx apps/web/tests/ui/interview-skill-assistant.test.tsx
git commit -m "feat(interview): connect setup UI to persistent graph"
```

### Task 8: F04 end-to-end proof and delivery

**Files:**
- Modify: the F04 issue comment/evidence paths required by the harness

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: reproducible evidence that only explicit confirmations persist and recovery is lossless.

- [ ] **Step 1: Run the complete focused suite**

Run: `pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts && pnpm --filter api test -- digital-interview && pnpm --filter web test -- interview-setup-workflow.test.tsx interview-skill-assistant.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run static and migration gates**

Run: `pnpm --filter api typecheck && pnpm --filter web typecheck && pnpm --filter api run migrate:check && pnpm --filter web run lint:design`

Expected: PASS.

- [ ] **Step 3: Run harness verification and doctor**

Run: `pnpm harness verify --sprint 04/01 && pnpm harness doctor --phase 04`

Expected: PASS or an explicit harness instruction identifying missing GitHub/evidence metadata; do not mark passing manually.

- [ ] **Step 4: Commit final evidence-only changes**

```bash
git add phases/phase-04-digital-expert-interviews
git commit -m "test(interview): record F04 persistence evidence"
```

- [ ] **Step 5: Push one F04 branch and open one PR**

The PR body must include `Closes #<F04 issue>`, the exact verification commands, migration risk, and the explicit boundary that F05/F06 remain separate.
