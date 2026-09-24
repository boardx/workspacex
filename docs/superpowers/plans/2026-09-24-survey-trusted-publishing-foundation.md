# Survey Trusted Publishing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the survey production-path mock with a persistent, organization-scoped state machine and server-enforced publish gate, then prove both blocked and successful publication in a real browser before opening a PR to `main`.

**Architecture:** Extend the existing survey contract, add a pure domain state machine and publish-gate evaluator, orchestrate them through application ports, persist with the repository's PostgreSQL adapter pattern, expose Nest controllers, and consume the resulting API from the existing five-step survey UI. Test fixtures may retain the mock builder, but production routes must load and mutate the service-owned aggregate.

**Tech Stack:** TypeScript, Zod, NestJS, PostgreSQL migrations, React 18, Next.js 14, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-survey-trusted-publishing-foundation-design.md`

## Global Constraints

- Do not begin product-code implementation until the Phase 09 Survey bundle has human-confirmed UI, use-case, and API-contract signoff and phase coherence passes.
- Reuse `packages/contracts/src/survey.ts`, the existing principal/org boundary, `apps/web/lib/api-client.ts`, and the existing five-step route.
- Do not create a second survey, identity, authorization, or artifact model.
- `draft | ready | collecting | closed` is the only status set; `ready → draft` is the only backward transition.
- `anonymity` is immutable after creation; `status` is never writable through generic PATCH.
- Publish validation returns all blockers in stable order and applies to direct HTTP requests.
- State changes and content-version checks are transactional and organization-scoped.
- No new runtime dependency is allowed.
- A real-browser blocked-publication and successful-publication journey must pass before a PR is created.
- The PR must close only the F04 issue and target `main`; the creator owns it until required checks are green.

## Review Focus

- A stale `expectedVersion` must return a conflict and leave status/content unchanged; pinned in Task 3 repository and Task 4 HTTP tests.
- A cross-organization request must not disclose whether a survey ID exists; pinned in Task 4 controller tests.
- Duplicate command delivery must never skip transitions or increment the version twice; pinned in Task 3 repository tests.
- A gate with multiple question and section failures must return every blocker in stable order; pinned in Task 2 gate tests.
- A network/system failure must not render as a business blocker or an optimistic ready state; pinned in Task 5 UI tests.

---

### Task 1: Lock the shared survey contract

**Files:**
- Modify: `packages/contracts/src/survey.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/tests/survey.test.ts`

**Interfaces:**
- Consumes: existing `SurveyWorkflowQuestionSchema`, `SurveyReportSectionSchema`, and `SurveyWorkflowSchema`.
- Produces: `SurveyAnonymitySchema`, `SurveyVersionSchema`, `SurveyPublishBlockerSchema`, `SurveyCommandResultSchema`, and `survey.operations` request/response schemas.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import { survey } from "../src";

describe("survey publishing contract", () => {
  it("rejects status and anonymity in generic patch", () => {
    expect(survey.operations.updateSurvey.in.safeParse({
      surveyId: "sv-1", expectedVersion: 1, status: "ready", anonymity: "identified",
    }).success).toBe(false);
  });

  it("accepts structured blockers with stable identities", () => {
    const parsed = survey.SurveyCommandResultSchema.parse({
      survey: { id: "sv-1", status: "draft", anonymity: "anonymous", version: 1 },
      blockers: [{ code: "QUESTION_OPTIONS_EMPTY", side: "question", subjectId: "Q02", missingFields: ["options"] }],
    });
    expect(parsed.blockers[0]?.subjectId).toBe("Q02");
  });
});
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run: `pnpm --filter @repo/contracts exec vitest run tests/survey.test.ts`

Expected: FAIL because the command schemas and `operations` do not exist.

- [ ] **Step 3: Add strict schemas and operation metadata**

Implement strict Zod schemas for creation, read, editable draft content, prepare, withdraw, start-collection, and close. Command requests include `surveyId` and `expectedVersion`; command responses include the current survey projection, numeric version, and blockers. Keep error and blocker codes as enums, not free text.

```ts
export const SurveyAnonymitySchema = z.enum(["anonymous", "identified"]);
export const SurveyPublishBlockerCodeSchema = z.enum([
  "QUESTIONS_EMPTY", "QUESTION_OPTIONS_EMPTY", "MAPPING_INCOMPLETE", "LEADING_QUESTION",
]);
export const SurveyPublishBlockerSchema = z.object({
  code: SurveyPublishBlockerCodeSchema,
  side: z.enum(["survey", "question", "section"]),
  subjectId: z.string().min(1),
  missingFields: z.array(z.string().min(1)),
}).strict();
```

- [ ] **Step 4: Run contract tests and typecheck**

Run: `pnpm --filter @repo/contracts exec vitest run tests/survey.test.ts && pnpm --filter @repo/contracts typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the contract slice**

```bash
git add packages/contracts/src/survey.ts packages/contracts/src/index.ts packages/contracts/tests/survey.test.ts
git commit -m "feat(survey): define trusted publishing contract"
```

### Task 2: Implement the pure domain state machine and publish gate

**Files:**
- Create: `apps/api/src/domain/survey/state-machine.ts`
- Create: `apps/api/src/domain/survey/publish-gate.ts`
- Create: `apps/api/tests/survey/state-machine-four.test.ts`
- Create: `apps/api/tests/survey/publish-gate-domain.test.ts`

**Interfaces:**
- Consumes: survey status, question, report-section, and blocker types from `@repo/contracts`.
- Produces: `transitionSurveyStatus(current, command): SurveyStatus` and `evaluateSurveyForPublish(input): SurveyPublishBlocker[]`.

- [ ] **Step 1: Write the failing four-state transition test**

```ts
expect(transitionSurveyStatus("draft", "prepare")).toBe("ready");
expect(transitionSurveyStatus("ready", "withdraw")).toBe("draft");
expect(transitionSurveyStatus("ready", "startCollection")).toBe("collecting");
expect(transitionSurveyStatus("collecting", "close")).toBe("closed");
expect(() => transitionSurveyStatus("closed", "startCollection")).toThrow(InvalidSurveyTransitionError);
```

- [ ] **Step 2: Write the failing exhaustive gate test**

Construct one aggregate containing an optionless choice question, an unmapped question, an empty report section, and a leading question. Assert that the returned blocker codes/subjects are exactly sorted by code then stable subject ID, with no early exit.

- [ ] **Step 3: Run domain tests and confirm RED**

Run: `pnpm --filter api exec vitest run tests/survey/state-machine-four.test.ts tests/survey/publish-gate-domain.test.ts`

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 4: Implement table-driven transitions and a pure gate evaluator**

Use an explicit transition table and throw a typed domain error for missing entries. Gate evaluation must accumulate, then sort, blockers. The leading-question check must call one named predicate shared by AI- and human-authored questions; do not branch on question origin.

- [ ] **Step 5: Run domain tests and mutation checks**

Run the tests normally, then temporarily invert one expected transition and one blocker code and confirm each test becomes red; restore the assertions and rerun.

Run: `pnpm --filter api exec vitest run tests/survey/state-machine-four.test.ts tests/survey/publish-gate-domain.test.ts`

Expected: PASS after restoration.

- [ ] **Step 6: Commit the domain slice**

```bash
git add apps/api/src/domain/survey apps/api/tests/survey/state-machine-four.test.ts apps/api/tests/survey/publish-gate-domain.test.ts
git commit -m "feat(survey): enforce publishing state machine"
```

### Task 3: Persist organization-scoped surveys with optimistic concurrency

**Files:**
- Create: `apps/api/migrations/20260924090000_survey_publishing_foundation.sql`
- Create: `apps/api/src/application/survey/ports.ts`
- Create: `apps/api/src/infrastructure/survey/pg-survey-repository.ts`
- Create: `apps/api/tests/support/survey-db.ts`
- Create: `apps/api/tests/survey/survey-repository-concurrency.test.ts`

**Interfaces:**
- Consumes: `StoredSurvey`, `SurveyRepository`, `UpdateSurveyCommand` declared in `ports.ts`; `DATABASE_PORT` tenant sessions.
- Produces: `SURVEY_REPOSITORY`, `PgSurveyRepository.create`, `findVisibleById`, `updateDraft`, and `transition` with expected-version checks.

- [ ] **Step 1: Write failing repository integration tests**

Cover creation at version 1, tenant isolation, compare-and-swap transition, stale version rejection, and duplicate delivery. Assert the database row remains unchanged after every rejected update.

```ts
await repo.transition({ orgId, surveyId, expectedVersion: 1, from: "draft", to: "ready" });
await expect(repo.transition({ orgId, surveyId, expectedVersion: 1, from: "draft", to: "ready" }))
  .rejects.toThrow(SurveyVersionConflictError);
expect((await repo.findVisibleById(orgId, actorId, surveyId))?.version).toBe(2);
```

- [ ] **Step 2: Run repository tests and confirm RED**

Run: `pnpm --filter api exec vitest run tests/survey/survey-repository-concurrency.test.ts`

Expected: FAIL because the migration and repository are absent.

- [ ] **Step 3: Add the migration and ports**

Create organization-scoped survey and content storage with database checks for status/anonymity, a positive version, timestamps, and indexes beginning with `organization_id`. Do not add response tables.

- [ ] **Step 4: Implement the PostgreSQL adapter**

Use `db.withTenant(orgId, ...)`. Updates include organization, survey ID, expected version, and expected status in the SQL predicate. Distinguish not-visible from version conflict without exposing another tenant's row.

- [ ] **Step 5: Run migration, repository tests, and migration checks**

Run: `pnpm --filter api migrate:check && pnpm --filter api exec vitest run tests/survey/survey-repository-concurrency.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the persistence slice**

```bash
git add apps/api/migrations apps/api/src/application/survey/ports.ts apps/api/src/infrastructure/survey apps/api/tests/support/survey-db.ts apps/api/tests/survey/survey-repository-concurrency.test.ts
git commit -m "feat(survey): persist versioned publishing state"
```

### Task 4: Expose server-enforced survey commands

**Files:**
- Create: `apps/api/src/application/survey/errors.ts`
- Create: `apps/api/src/application/survey/create-survey.ts`
- Create: `apps/api/src/application/survey/get-survey.ts`
- Create: `apps/api/src/application/survey/update-survey.ts`
- Create: `apps/api/src/application/survey/prepare-survey.ts`
- Create: `apps/api/src/application/survey/transition-survey.ts`
- Create: `apps/api/src/interface/controllers/survey.controller.ts`
- Modify: `apps/api/src/kernel.module.ts`
- Create: `apps/api/tests/survey/anonymity-immutable.test.ts`
- Create: `apps/api/tests/survey/publish-gate-server-enforced.test.ts`

**Interfaces:**
- Consumes: `SurveyRepository`, domain transition/gate functions, current `Principal`, and contract operations.
- Produces: authenticated HTTP operations under `/surveys` with stable 400/404/409/422/500 semantics.

- [ ] **Step 1: Write failing HTTP tests for anonymity and enumeration safety**

Send both anonymity-direction PATCH attempts and assert `409 ANONYMITY_IMMUTABLE`. Request another organization's survey and a random ID, and assert status and response bytes are identical.

- [ ] **Step 2: Write failing direct-publish tests**

Call `POST /surveys/:id/prepare` without visiting the UI. Assert multiple blockers arrive together with `422`, status remains draft, fixing the same version permits ready, and a concurrent edit returns `409 SURVEY_VERSION_CONFLICT`.

- [ ] **Step 3: Run the three F04 API verification files and confirm RED**

Run: `pnpm --filter api exec vitest run tests/survey/state-machine-four.test.ts tests/survey/anonymity-immutable.test.ts tests/survey/publish-gate-server-enforced.test.ts`

Expected: FAIL at missing application/controller wiring.

- [ ] **Step 4: Implement application use cases**

Keep business rules out of the controller. `prepareSurvey` loads the aggregate in a tenant transaction, evaluates all blockers, and performs compare-and-swap only when empty. Generic update rejects the presence of `anonymity` or `status` before repository mutation.

- [ ] **Step 5: Implement the controller and composition-root wiring**

Validate bodies with contract schemas and `ZodBodyPipe`; derive org/user from `CurrentPrincipal`; map typed errors centrally. Register `SurveyController` and bind `SURVEY_REPOSITORY` to `PgSurveyRepository` in `kernel.module.ts`.

- [ ] **Step 6: Run API verification, typecheck, lint, and mutation checks**

Run: `pnpm --filter api exec vitest run tests/survey/state-machine-four.test.ts tests/survey/anonymity-immutable.test.ts tests/survey/publish-gate-server-enforced.test.ts && pnpm --filter api typecheck && pnpm --filter api lint`

Expected: PASS. Then temporarily expect ready for a blocked request and confirm the test fails; restore and rerun.

- [ ] **Step 7: Commit the HTTP slice**

```bash
git add apps/api/src/application/survey apps/api/src/interface/controllers/survey.controller.ts apps/api/src/kernel.module.ts apps/api/tests/survey
git commit -m "feat(survey): enforce publish gate over HTTP"
```

### Task 5: Replace the production UI mock with the live survey API

**Files:**
- Create: `apps/web/lib/survey/survey-api.ts`
- Create: `apps/web/lib/survey/use-survey-workflow.ts`
- Modify: `apps/web/components/survey/workflow/survey-workflow-shell.tsx`
- Modify: `apps/web/components/survey/workflow/publish-recovery-step.tsx`
- Modify: `apps/web/app/studio/survey/[surveyId]/page.tsx`
- Create: `apps/web/tests/ui/survey-live-publishing.test.tsx`
- Modify: `apps/web/tests/ui/survey-workflow-shell.test.tsx`

**Interfaces:**
- Consumes: `apiRequest` from `apps/web/lib/api-client.ts` and the Task 1 operation schemas.
- Produces: `getSurvey`, `updateSurvey`, `prepareSurvey`, `withdrawSurvey`, `startSurveyCollection`, `closeSurvey`, plus a hook exposing explicit loading/error/blocker/conflict states.

- [ ] **Step 1: Write failing UI tests for real-client state**

Mock the network boundary, not `createSurveyWorkflowMock()`. Assert initial loading, full blocker rendering after `422`, no optimistic ready badge, retryable system error after `500`, and ready state only after a successful parsed response.

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `pnpm --filter web exec vitest run tests/ui/survey-live-publishing.test.tsx tests/ui/survey-workflow-shell.test.tsx`

Expected: FAIL because the live client/hook do not exist.

- [ ] **Step 3: Implement the schema-validating API client**

Use `apiRequest` and parse every response with the corresponding contract output schema. Convert `422` into typed blockers, `409` into typed conflict, and all other failures into a retryable system error. Do not infer status locally.

- [ ] **Step 4: Integrate the hook and publish step**

Production survey IDs load through the hook. Keep explicit fixture injection for unit tests and preview-only states. Render business blockers separately from system errors and preserve local editing on version conflict.

- [ ] **Step 5: Run survey UI regression and design lint**

Run: `pnpm --filter web exec vitest run tests/survey/survey-mock-structure.test.ts tests/ui/survey-app-shell.test.tsx tests/ui/survey-create-dialog.test.tsx tests/ui/survey-creation-draft.test.ts tests/ui/survey-resource-library.test.tsx tests/ui/survey-route-layout.test.tsx tests/ui/survey-template-editor-shell.test.tsx tests/ui/survey-workflow-model.test.ts tests/ui/survey-workflow-shell.test.tsx tests/ui/survey-live-publishing.test.tsx && pnpm --filter web typecheck && pnpm --filter web lint:design`

Expected: PASS.

- [ ] **Step 6: Commit the web slice**

```bash
git add apps/web/lib/survey apps/web/components/survey/workflow apps/web/app/studio/survey apps/web/tests/ui
git commit -m "feat(survey): connect publishing workflow to API"
```

### Task 6: Prove the real user journey and prepare the PR

**Files:**
- Create: `apps/web/e2e/survey-trusted-publishing.spec.ts`
- Create: `phases/phase-09-survey/sprints/sprint-01/evidence/F04-browser.png`
- Modify: `phases/phase-09-survey/sprints/sprint-01/progress.md`
- Modify: `phases/phase-09-survey/sprints/sprint-01/session-handoff.md`
- Modify: `.agents/skills/mod-survey/SKILL.md` only if a new verified module-specific lesson was discovered

**Interfaces:**
- Consumes: running migrated API/web stack, a dev-mode authenticated user, and the live HTTP/UI path from Tasks 1–5.
- Produces: a Playwright/live-browser acceptance test, accepted screenshots, harness evidence, and a PR targeting `main`.

- [ ] **Step 1: Write the failing Playwright journey**

The test creates an anonymous draft, opens the publish step, proves multiple blockers are visible and the status remains draft, repairs the question/section problems, prepares successfully, starts collection, reloads the page, and proves collecting persisted. It also attempts a direct HTTP anonymity change and expects rejection.

- [ ] **Step 2: Run the journey and confirm RED before the final integration is complete**

Run the repository's full-stack Playwright configuration with only `e2e/survey-trusted-publishing.spec.ts`.

Expected: FAIL before the complete live wiring; keep the trace as counter-evidence, not completion evidence.

- [ ] **Step 3: Start the standard stack and run migrations**

Use the repository's documented dev/full-stack commands and a task-owned compose project. Do not reuse or destroy another agent's stack.

- [ ] **Step 4: Run automated Playwright verification**

Run: `pnpm --filter web exec playwright test e2e/survey-trusted-publishing.spec.ts --config playwright.fullstack-smoke.config.ts`

Expected: PASS with trace/screenshot output showing both the blocked and successful publication states.

- [ ] **Step 5: Automatically perform an interactive browser verification**

Open the local application in the available Codex browser surface after the automated test. Repeat the blocked prepare and successful prepare/start-collection path, inspect the final collecting state after reload, and save accepted screenshots. If no browser surface is available, this step is blocked: do not create the PR and report the concrete browser limitation.

- [ ] **Step 6: Run the complete mechanical gates**

Run the Phase 09 F04 verification through `pnpm harness verify --sprint 09/01 --feature F04`, then `pnpm -w run verify:base`, `pnpm harness doctor --phase 09 --strict`, and verify evidence blobs are present in git. All must pass.

- [ ] **Step 7: Commit evidence and clean-state updates**

```bash
git add phases/phase-09-survey .agents/skills/mod-survey/SKILL.md
git commit -m "test(survey): verify trusted publishing journey"
```

- [ ] **Step 8: Push and open the PR only after browser PASS**

Push the feature branch, open one PR with `Closes #<F04 issue>` and base `main`, include exact verification commands and browser evidence, then attach the PR to the Codex task.

- [ ] **Step 9: Own the PR to green**

Watch required checks and review feedback, fix failures on the same branch, rerun affected verification and browser checks, and stop only when the repository's PR classifier reports green/ready. Merging remains subject to the repository's coordinator permissions.
