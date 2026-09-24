# Digital Interview Research Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explainable research-quality gates and a traceable evidence-review workflow to the existing five-step digital expert interview without replacing it or presenting simulated experts as real users.

**Architecture:** Extend the shared Zod contract first, then add deterministic pure quality functions, versioned PostgreSQL projections, workflow commands, and focused React panels that consume one server-owned workflow view. Quality previews are derived from the current brief, expert snapshot, questions, runs, and report; only human decisions and version identities are persisted.

**Tech Stack:** TypeScript, Zod, NestJS, LangGraph, PostgreSQL, React/Next.js, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-digital-interview-research-quality-design.md`

## Global Constraints

- Keep the existing five steps: `topic | experts | questions | runs | report`; do not add a top-level route.
- Every quality object is strict, versioned, and scoped to the current `orgId`, `interviewId`, and `revisionId`.
- Deterministic gates never depend on model availability; model output may suggest copy but cannot lower severity or approve a human decision.
- `exploratory: true` and the copy `数字专家探索性证据，不代表真实用户样本` remain visible in workflow, report, and exports.
- An upstream confirmation supersedes readiness decisions, runs, reports, and report reviews from the previous revision without deleting them.
- Do not duplicate expert profiles, question text, answer text, or report text in quality tables.
- Persist human actor, version, timestamp, and rationale for warning acceptance and report review.
- No business source file may exceed 2,000 lines; split the current workflow component before adding the new panels.
- One issue and one PR implement issue #4082; the PR must include `Closes #4082`.
- Completion requires real-browser evidence plus `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`, all required checks green, and zero unresolved review threads.

## Review Focus

- A goal ID supplied from another brief must be rejected, not silently dropped; Task 1 pins cross-object validation and Task 4 pins the HTTP failure.
- A stale readiness decision after any upstream revision change must not permit runs; Task 3 pins supersession and Task 4 pins the server-side start gate.
- A quality preview outage must remain visibly unknown instead of appearing as zero findings; Task 6 pins the UI state.
- A report finding whose source answer belongs to another expert/question/revision must fail generation and preserve the previous report; Task 5 pins provenance validation and recovery.
- A legacy interview may remain readable and exportable but cannot become approved until its brief is explicitly confirmed; Tasks 3, 5, and 8 pin migration, review, and browser behavior.

---

### Task 1: Shared Quality Contracts

**Files:**
- Modify: `packages/contracts/src/interview.ts`
- Modify: `packages/contracts/tests/digital-interview-contract.test.ts`

**Interfaces:**
- Consumes: existing `DigitalInterviewQuestion`, `DigitalInterviewReportFinding`, `DigitalInterviewWorkflowView`, and operation contract conventions.
- Produces: `DigitalInterviewResearchBrief`, `DigitalInterviewModeratorPolicy`, `DigitalInterviewQualityProjection`, `DigitalInterviewReadinessDecision`, `DigitalInterviewReportReview`, and operation schemas used by every later task.

- [ ] **Step 1: Write failing strict-schema tests**

Add tests that parse a valid brief and reject duplicated goal IDs, unknown extra keys, more than five goals, empty role/scope entries, and invalid moderator limits:

```ts
expect(interview.DigitalInterviewResearchBrief.parse(validBrief)).toEqual(validBrief);
expect(() => interview.DigitalInterviewResearchBrief.parse({
  ...validBrief,
  learningGoals: [validBrief.learningGoals[0], validBrief.learningGoals[0]],
})).toThrow(/goalId must be unique/);
expect(() => interview.DigitalInterviewModeratorPolicy.parse({
  ...validPolicy,
  maxFollowUpsPerQuestion: 11,
})).toThrow();
```

- [ ] **Step 2: Run the focused contract test and confirm RED**

Run: `pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts`

Expected: FAIL because the research-quality schemas do not exist.

- [ ] **Step 3: Add strict schemas and cross-object refinements**

Define the exact enums and shapes from the approved spec. Extend questions with `section` and deduplicated `goalIds`; extend findings with deduplicated `goalIds`; extend the workflow view with nullable `researchBrief`, required `quality`, and nullable `reportReview`. Add `confirmDigitalInterviewBrief`, `previewDigitalInterviewQuality`, `decideDigitalInterviewReadiness`, and `reviewDigitalInterviewReport` operations. Keep `confirmDigitalInterviewQuestions` but require `moderatorPolicy` in its input.

Use a shared refinement to reject goal IDs that are not members of the accompanying brief:

```ts
function validateGoalReferences(
  values: readonly { readonly goalIds: readonly string[] }[],
  validGoalIds: ReadonlySet<string>,
  context: z.RefinementCtx,
) {
  values.forEach((value, index) => value.goalIds.forEach((goalId) => {
    if (!validGoalIds.has(goalId)) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [index, "goalIds"],
      message: "goalId must belong to the current research brief",
    });
  }));
}
```

- [ ] **Step 4: Add operation and workflow-view assertions**

Test warning rationale length, report-review states, strict command bodies, coverage states, and the cross-brief goal-ID case listed in Review Focus.

- [ ] **Step 5: Run contract tests and typecheck**

Run: `pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts && pnpm --filter @repo/contracts typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the contract slice**

```bash
git add packages/contracts/src/interview.ts packages/contracts/tests/digital-interview-contract.test.ts
git commit -m "feat(interview): define research quality contracts"
```

### Task 2: Deterministic Research Quality Domain

**Files:**
- Create: `apps/api/src/domain/interview/research-quality.ts`
- Create: `apps/api/tests/itv/digital-interview-research-quality.test.ts`

**Interfaces:**
- Consumes: inferred contract types from Task 1 and existing expert/run/report projections.
- Produces: `assessBrief`, `assessExpertCoverage`, `assessQuestionQuality`, `estimateInterviewDuration`, `assessReadiness`, `buildEvidenceCoverage`, and `canApproveReport`.

- [ ] **Step 1: Write table-driven failing tests for all quality rules**

Cover the eight question rule codes, including positive and negative examples. Add boundary tests for 8/35 minutes, 40% concentration, zero/two expert perspectives, failed runs, contradictory evidence, and a blocking evidence gap.

```ts
it.each([
  ["你是不是也认为这个流程太复杂？", "LEADING_WORDING"],
  ["你如何发现并解决这个问题？", "DOUBLE_BARRELLED"],
  ["你喜欢这个功能吗？", "YES_NO_ONLY"],
])("flags %s as %s", (text, code) => {
  expect(assessQuestionQuality(inputWith(text)).find((item) => item.code === code)).toBeTruthy();
});
```

- [ ] **Step 2: Run the domain test and confirm RED**

Run: `pnpm --filter api test -- digital-interview-research-quality.test.ts`

Expected: FAIL because `research-quality.ts` is absent.

- [ ] **Step 3: Implement brief, coverage, and duration functions**

Return structured findings with stable codes, severity, object identity, message, and deterministic suggested rewrite where possible. Expert coverage uses role/domains/goals/material boundary; duration uses section, text complexity, and policy depth without calling a model.

- [ ] **Step 4: Implement question, readiness, evidence, and approval functions**

`assessReadiness` combines findings without erasing their source; `buildEvidenceCoverage` retains run failures and explicit counterexamples; `canApproveReport` returns `{ allowed, blockingCodes }` and never mutates report state.

- [ ] **Step 5: Add fuzz-like malformed-input regression cases**

Exercise empty arrays, repeated intent after whitespace normalization, mixed Chinese/English punctuation, missing answers, duplicate findings, and a source answer attached to the wrong expert.

- [ ] **Step 6: Run domain tests and API typecheck**

Run: `pnpm --filter api test -- digital-interview-research-quality.test.ts && pnpm --filter api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the domain slice**

```bash
git add apps/api/src/domain/interview/research-quality.ts apps/api/tests/itv/digital-interview-research-quality.test.ts
git commit -m "feat(interview): assess research readiness and evidence"
```

### Task 3: Versioned Persistence and Legacy Projection

**Files:**
- Create: `apps/api/migrations/20260924120000_digital_interview_research_quality.sql`
- Modify: `apps/api/src/application/interview/digital-interview-ports.ts`
- Modify: `apps/api/src/infrastructure/interview/pg-digital-interview-repository.ts`
- Modify: `apps/api/tests/itv/digital-interview-persistence.test.ts`
- Modify: `apps/api/tests/itv/digital-interview-workflow-migration.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas and Task 2 derived assessment inputs.
- Produces: atomic load/write methods for brief, moderator policy, readiness decision, report review, and rule-version metadata.

- [ ] **Step 1: Write failing repository tests**

Assert org isolation, current-revision selection, idempotent repeated request IDs, superseded rows after upstream confirmation, and preservation of old runs/reports. Add a legacy fixture whose workflow view contains a migration draft and no confirmed brief.

- [ ] **Step 2: Run persistence tests and confirm RED**

Run: `pnpm --filter api test -- digital-interview-persistence.test.ts digital-interview-workflow-migration.test.ts`

Expected: FAIL because the version tables and repository mappings are missing.

- [ ] **Step 3: Add append-only quality tables**

Create tables for research briefs, moderator policies, readiness decisions, and report reviews with composite org/interview/revision foreign keys, unique version/request constraints, actor and timestamps, JSONB only for the strict contract payload, and indexes used by `loadWorkflow`. Do not copy question, answer, expert, or report text.

- [ ] **Step 4: Extend repository ports and transactional writes**

Add explicit methods:

```ts
saveResearchBrief(input: SaveResearchBriefInput): Promise<Guarded<DigitalInterviewWorkflowView>>;
saveReadinessDecision(input: SaveReadinessDecisionInput): Promise<Guarded<DigitalInterviewWorkflowView>>;
saveReportReview(input: SaveReportReviewInput): Promise<Guarded<DigitalInterviewWorkflowView>>;
```

Every write checks `expectedVersion`, current revision, actor access, and request-id payload equality inside one transaction.

- [ ] **Step 5: Project current quality and legacy migration state**

Extend `readDigitalInterviewWorkflow` to derive quality from the current facts and return `researchBrief: null` plus a legacy migration warning when no confirmed brief exists. Confirming any upstream step marks prior readiness/review rows superseded through revision identity, not destructive updates.

- [ ] **Step 6: Run migration and persistence verification**

Run: `pnpm --filter api test -- digital-interview-persistence.test.ts digital-interview-workflow-migration.test.ts && pnpm --filter api typecheck`

Expected: PASS, including two consecutive migration applications in the isolated test database.

- [ ] **Step 7: Commit the persistence slice**

```bash
git add apps/api/migrations/20260924120000_digital_interview_research_quality.sql apps/api/src/application/interview/digital-interview-ports.ts apps/api/src/infrastructure/interview/pg-digital-interview-repository.ts apps/api/tests/itv/digital-interview-persistence.test.ts apps/api/tests/itv/digital-interview-workflow-migration.test.ts
git commit -m "feat(interview): persist versioned research quality decisions"
```

### Task 4: Workflow Commands, HTTP API, and Server-Side Readiness Gate

**Files:**
- Modify: `apps/api/src/application/interview/workflow/digital-interview-state.ts`
- Modify: `apps/api/src/application/interview/workflow/digital-interview-effects.port.ts`
- Modify: `apps/api/src/application/interview/workflow/digital-interview-runtime.port.ts`
- Modify: `apps/api/src/application/interview/workflow/digital-interview-nodes.ts`
- Modify: `apps/api/src/application/interview/workflow/digital-interview-graph.ts`
- Modify: `apps/api/src/infrastructure/interview/workflow/pg-digital-interview-effects.ts`
- Modify: `apps/api/src/interface/controllers/digital-interview.controller.ts`
- Modify: `apps/api/tests/itv/digital-interview-graph.test.ts`
- Modify: `apps/api/tests/itv/digital-interview-controller.test.ts`
- Modify: `apps/api/tests/itv/start-interview-hard-gate-server.test.ts`

**Interfaces:**
- Consumes: Task 1 commands, Task 2 assessments, and Task 3 repository writes.
- Produces: authenticated endpoints for brief confirmation, quality preview, question/policy confirmation, readiness decision, and run start enforcement.

- [ ] **Step 1: Write failing graph and controller tests**

Cover the route sequence `confirm_brief → generate_experts → confirm_experts → generate_questions → confirm_questions → decide_readiness`, stable reason codes, body/path parameter separation, org injection from Principal, and the legacy topic endpoint returning `INTERVIEW_CONTRACT_UPGRADE_REQUIRED`.

- [ ] **Step 2: Write the stale-decision hard-gate test**

Persist a ready decision, create a new question revision, then call run start and assert `INTERVIEW_NOT_READY`. Also assert a warning-only decision without 10–300 character rationale returns `READINESS_RATIONALE_REQUIRED`.

- [ ] **Step 3: Run focused API tests and confirm RED**

Run: `pnpm --filter api test -- digital-interview-graph.test.ts digital-interview-controller.test.ts start-interview-hard-gate-server.test.ts`

Expected: FAIL on missing commands/routes/gates.

- [ ] **Step 4: Extend graph state and effects**

Replace `confirm_topic` with `confirm_brief` for new clients, carry moderator policy identity in graph state, and route readiness as a human command. Keep quality preview outside the state machine because it is side-effect-free.

- [ ] **Step 5: Add application/runtime methods and stable errors**

Add `confirmBrief`, `previewQuality`, `decideReadiness`, and `reviewReport`. Expand `DigitalInterviewWorkflowError` with the exact reason codes from the spec and map them to non-leaking HTTP responses.

- [ ] **Step 6: Add controller routes**

Use these routes and the contract parser for every input/output:

```text
POST /interviews/digital/:interviewId/brief/confirm
POST /interviews/digital/:interviewId/quality/preview
POST /interviews/digital/:interviewId/readiness/decide
POST /interviews/digital/:interviewId/report/review
```

- [ ] **Step 7: Enforce readiness immediately before run creation**

Within the same authorization/version boundary as run creation, reload the current revision, recompute deterministic readiness, compare the saved decision version, and refuse stale or blocking input. Do not rely on the browser disabling a button.

- [ ] **Step 8: Run graph/controller/gate tests and API checks**

Run: `pnpm --filter api test -- digital-interview-graph.test.ts digital-interview-controller.test.ts start-interview-hard-gate-server.test.ts && pnpm --filter api typecheck && pnpm --filter api lint`

Expected: PASS.

- [ ] **Step 9: Commit the workflow slice**

```bash
git add apps/api/src/application/interview/workflow apps/api/src/infrastructure/interview/workflow/pg-digital-interview-effects.ts apps/api/src/interface/controllers/digital-interview.controller.ts apps/api/tests/itv/digital-interview-graph.test.ts apps/api/tests/itv/digital-interview-controller.test.ts apps/api/tests/itv/start-interview-hard-gate-server.test.ts
git commit -m "feat(interview): gate runs on confirmed research readiness"
```

### Task 5: Evidence-Proven Report Generation and Human Review

**Files:**
- Modify: `apps/api/src/infrastructure/interview/workflow/langgraph-digital-interview-runtime.ts`
- Modify: `apps/api/src/application/interview/workflow/digital-report-transport.ts`
- Modify: `apps/api/src/infrastructure/interview/workflow/interview-run-answers.ts`
- Modify: `apps/api/tests/itv/digital-interview-report.test.ts`
- Modify: `apps/api/tests/itv/digital-report-transport.test.ts`
- Modify: `apps/api/tests/itv/interview-run-answers.test.ts`

**Interfaces:**
- Consumes: current brief, question goal IDs, run answers, Task 2 evidence matrix, and Task 4 report-review method.
- Produces: reports whose sections and findings carry valid goal/expert/question/answer provenance and whose approval is human-controlled.

- [ ] **Step 1: Write failing provenance and recovery tests**

Assert required report sections, goal IDs on each finding, counterexample preservation, rejection of a cross-expert source answer, previous-report preservation after invalid regeneration, and blocking of approval when evidence gaps remain.

- [ ] **Step 2: Run report tests and confirm RED**

Run: `pnpm --filter api test -- digital-interview-report.test.ts digital-report-transport.test.ts interview-run-answers.test.ts`

Expected: FAIL because report goal provenance and review gates are absent.

- [ ] **Step 3: Build the report input from stored facts only**

Generate the model context from the confirmed brief, current expert snapshot, current question version, saved run answers, and derived evidence coverage. Require the sections `研究方法`, `研究简报`, `专家边界`, `证据覆盖`, `关键发现`, `分歧与反例`, `局限性`, `待验证假设`, and `建议行动`.

- [ ] **Step 4: Validate every streamed and final finding**

Resolve each finding to the current answer tuple `(revisionId, expertId, questionId, sourceAnswerId)` before persistence. On failure, emit `REPORT_EVIDENCE_INVALID`, preserve the preceding durable report, and never create a review row.

- [ ] **Step 5: Implement human report review enforcement**

Call `canApproveReport` on the current revision/report version. Save `pending | approved | changes_requested` with actor/time/note; reject approval for legacy or blocking-gap reports with `REPORT_REVIEW_BLOCKED`.

- [ ] **Step 6: Run report tests and typecheck**

Run: `pnpm --filter api test -- digital-interview-report.test.ts digital-report-transport.test.ts interview-run-answers.test.ts && pnpm --filter api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the report slice**

```bash
git add apps/api/src/infrastructure/interview/workflow/langgraph-digital-interview-runtime.ts apps/api/src/application/interview/workflow/digital-report-transport.ts apps/api/src/infrastructure/interview/workflow/interview-run-answers.ts apps/api/tests/itv/digital-interview-report.test.ts apps/api/tests/itv/digital-report-transport.test.ts apps/api/tests/itv/interview-run-answers.test.ts
git commit -m "feat(interview): trace report findings to reviewed evidence"
```

### Task 6: Web API, Quality State, and Focused UI Components

**Files:**
- Modify: `apps/web/lib/interview-api.ts`
- Modify: `apps/web/components/itv/digital-interview-workflow.tsx`
- Create: `apps/web/components/itv/digital-interview-research-brief.tsx`
- Create: `apps/web/components/itv/digital-interview-quality-panel.tsx`
- Create: `apps/web/components/itv/digital-interview-readiness.tsx`
- Create: `apps/web/components/itv/digital-interview-evidence-review.tsx`
- Modify: `apps/web/tests/ui/interview-setup-workflow.test.tsx`
- Create: `apps/web/tests/ui/interview-research-quality.test.tsx`

**Interfaces:**
- Consumes: Task 1 workflow/operation types and Task 4 endpoints.
- Produces: typed API functions and accessible panels used by the existing five-step shell.

- [ ] **Step 1: Write failing API and UI tests**

Test structured brief editing, goal/expert coverage, sectioned questions, findings and suggested rewrites, duration display, moderator controls, warning rationale, blocking run start, and the fixed exploratory notice. Include keyboard navigation and text/icon status assertions.

- [ ] **Step 2: Add the quality-preview outage test**

Mock `QUALITY_PREVIEW_UNAVAILABLE` and assert the panel says `质量检查暂不可用，当前状态未知` with retry action; assert it never renders `0 个问题`.

- [ ] **Step 3: Run UI tests and confirm RED**

Run: `pnpm --filter web test -- interview-setup-workflow.test.tsx interview-research-quality.test.tsx`

Expected: FAIL because typed calls and panels are absent.

- [ ] **Step 4: Add typed API calls**

Implement `confirmDigitalInterviewBrief`, `previewDigitalInterviewQuality`, extended `confirmDigitalInterviewQuestions`, `decideDigitalInterviewReadiness`, and `reviewDigitalInterviewReport` using `apiRequest` and contract-inferred inputs/outputs.

- [ ] **Step 5: Split the workflow component by responsibility**

Move the topic/brief, quality summary, readiness, and evidence-review views into the four new files. Keep navigation, dirty-buffer protection, stream recovery, and confirmation orchestration in `digital-interview-workflow.tsx`.

- [ ] **Step 6: Implement the first three steps**

Render the structured brief; show goal × expert coverage and `whySelected/canAnswer/cannotRepresent/overlap`; group questions by `warmup/core/counterexample/closing`; display goal chips, estimated minutes, deterministic findings, rewrite adoption, and moderator policy. Applying a suggestion only changes the draft buffer.

- [ ] **Step 7: Implement readiness and unknown/error states**

Show blocking items first, require 10–300 characters for warning acceptance, keep server reason codes mapped to user-facing copy, and preserve unsaved buffers on preview or confirmation failures.

- [ ] **Step 8: Run UI tests, typecheck, and design lint**

Run: `pnpm --filter web test -- interview-setup-workflow.test.tsx interview-research-quality.test.tsx && pnpm --filter web typecheck && pnpm --filter web lint:design`

Expected: PASS.

- [ ] **Step 9: Commit the web quality slice**

```bash
git add apps/web/lib/interview-api.ts apps/web/components/itv/digital-interview-workflow.tsx apps/web/components/itv/digital-interview-research-brief.tsx apps/web/components/itv/digital-interview-quality-panel.tsx apps/web/components/itv/digital-interview-readiness.tsx apps/web/components/itv/digital-interview-evidence-review.tsx apps/web/tests/ui/interview-setup-workflow.test.tsx apps/web/tests/ui/interview-research-quality.test.tsx
git commit -m "feat(interview): add guided research quality workflow"
```

### Task 7: Report Evidence Matrix, Review Panel, and Exports

**Files:**
- Modify: `apps/web/components/itv/digital-interview-workflow.tsx`
- Modify: `apps/web/components/itv/digital-interview-evidence-review.tsx`
- Modify: `apps/web/lib/interview-report-export.ts`
- Modify: `apps/web/tests/ui/interview-detail-report.test.tsx`
- Modify: `apps/web/tests/lib/interview-report-export.test.ts`

**Interfaces:**
- Consumes: Task 5 evidence/report/review projection and Task 6 API call.
- Produces: source-linked matrix, explicit report review controls, and review-aware Word/PDF output.

- [ ] **Step 1: Write failing report UI and export tests**

Assert all matrix states, failed-expert visibility, source-answer navigation, counterexample display, pending/approved/changes-requested labels, blocked approval, and export metadata including reviewer/time/exploratory boundary.

- [ ] **Step 2: Run report UI/export tests and confirm RED**

Run: `pnpm --filter web test -- interview-detail-report.test.tsx interview-report-export.test.ts`

Expected: FAIL because review and coverage are not rendered/exported.

- [ ] **Step 3: Implement the evidence and review panel**

Render goal × expert cells with text and icon states; link counts to `answer-{expertId}-{questionId}`; show limitations, disagreements, counterexamples, and missing evidence before actions. Approval remains disabled with an adjacent explanation when server projection contains blocking gaps.

- [ ] **Step 4: Extend Word/PDF export content**

Include research brief, method, evidence coverage, limitations, review status, reviewer, reviewed time, note, and the fixed exploratory statement. A legacy report exports with `旧版报告，未经过研究质量门` and never claims approval.

- [ ] **Step 5: Run report UI/export tests and web checks**

Run: `pnpm --filter web test -- interview-detail-report.test.tsx interview-report-export.test.ts && pnpm --filter web typecheck && pnpm --filter web lint:design`

Expected: PASS.

- [ ] **Step 6: Commit the review/export slice**

```bash
git add apps/web/components/itv/digital-interview-workflow.tsx apps/web/components/itv/digital-interview-evidence-review.tsx apps/web/lib/interview-report-export.ts apps/web/tests/ui/interview-detail-report.test.tsx apps/web/tests/lib/interview-report-export.test.ts
git commit -m "feat(interview): review and export evidence-backed reports"
```

### Task 8: Real-Browser Regression and Accessibility

**Files:**
- Create: `apps/web/e2e/digital-interview-research-quality.spec.ts`
- Modify: `apps/web/playwright.config.ts` only if the existing isolated project cannot discover the new spec.

**Interfaces:**
- Consumes: the complete API/Web workflow from Tasks 1–7.
- Produces: browser evidence for the approved end-to-end behavior and recovery paths.

- [ ] **Step 1: Write the end-to-end scenario before the final implementation pass**

Use API/database fixtures only for authentication and deterministic model responses; use Chromium UI actions for all user-visible workflow steps. Assert the exact sequence from the spec: brief, coverage repair, question blocking repair, policy, readiness, partial failure/retry, evidence source jump, blocked approval, successful review, export, refresh recovery.

- [ ] **Step 2: Add viewport and keyboard assertions**

Run the core path at 1440×900 and the report/readiness screens at 390×844. Assert no horizontal overflow, visible focus, reachable controls, and status text independent of color.

- [ ] **Step 3: Run Chromium and diagnose any remaining integration gap**

Run: `pnpm --filter web exec playwright test e2e/digital-interview-research-quality.spec.ts --project=chromium`

Expected: PASS when the preceding slices are integrated. If an assertion fails, retain the trace and fix the owning production code rather than weakening the assertion.

- [ ] **Step 4: Re-run Chromium to GREEN and save evidence**

Run: `pnpm --filter web exec playwright test e2e/digital-interview-research-quality.spec.ts --project=chromium --trace=retain-on-failure`

Expected: PASS with screenshots for brief, readiness, evidence matrix, and approved report saved under the test output directory.

- [ ] **Step 5: Commit browser coverage**

```bash
git add apps/web/e2e/digital-interview-research-quality.spec.ts apps/web/playwright.config.ts
git commit -m "test(interview): cover research quality browser workflow"
```

### Task 9: Full Verification, Documentation, and Pull Request

**Files:**
- Modify: `docs/superpowers/specs/2026-09-24-digital-interview-research-quality-design.md` only if implementation revealed an approved design clarification.
- Modify: the current sprint `progress.md` and `session-handoff.md` resolved through repository state; do not guess paths.
- Modify: issue #4082 comments and the new PR description through `gh`.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: reproducible verification evidence and a PR that is demonstrably ready to merge.

- [ ] **Step 1: Run focused suites together**

Run:

```bash
pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts
pnpm --filter api test -- digital-interview-research-quality.test.ts digital-interview-persistence.test.ts digital-interview-workflow-migration.test.ts digital-interview-graph.test.ts digital-interview-controller.test.ts start-interview-hard-gate-server.test.ts digital-interview-report.test.ts digital-report-transport.test.ts interview-run-answers.test.ts
pnpm --filter web test -- interview-setup-workflow.test.tsx interview-research-quality.test.tsx interview-detail-report.test.tsx interview-report-export.test.ts
pnpm --filter web exec playwright test e2e/digital-interview-research-quality.spec.ts --project=chromium
```

Expected: all PASS.

- [ ] **Step 2: Run affected static and baseline verification**

Run:

```bash
pnpm --filter @repo/contracts typecheck
pnpm --filter api typecheck
pnpm --filter api lint
pnpm --filter web typecheck
pnpm --filter web lint
./init.sh
```

Expected: all exit 0 with no new failure.

- [ ] **Step 3: Run harness verification and update repository-owned evidence**

Resolve the active sprint from `pnpm harness readiness`, run its exact `pnpm harness verify --sprint <phase>/<sprint>` command, record command output, screenshots, and commit SHA in the authoritative evidence/progress files, and never hand-edit a feature to `passing`.

- [ ] **Step 4: Perform a final diff and provenance audit**

Run: `git diff f174-ssh/main...HEAD --check && git status --short && git log --oneline f174-ssh/main..HEAD`

Verify no generated secrets, unrelated refactors, copied answer text in quality tables, unreferenced migrations, missing tests, or source-less report findings.

- [ ] **Step 5: Push and create the PR**

Create a PR to `main` whose body lists all ten optimizations, migration/rollback notes, verification commands, browser screenshots, and `Closes #4082`. Immediately attach the PR to this task with the Codex artifact tool.

- [ ] **Step 6: Drive review and CI to a mergeable state**

Poll GitHub without merging. Fix every failed required check, conflict, and actionable review comment; respond to and resolve each review thread after the fix. Re-run the relevant local test before each push.

- [ ] **Step 7: Confirm the exact READY_TO_MERGE gate**

Query the final head SHA and assert all of the following at the same SHA:

```text
mergeable = MERGEABLE
mergeStateStatus = CLEAN
required checks = success or permitted skip under classifyChecks
unresolved review threads = 0
base branch = main
```

Only then report `READY_TO_MERGE`; do not merge as a worker.
