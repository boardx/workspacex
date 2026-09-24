# Survey Trusted Publishing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the existing persistent, organization-scoped survey runtime to an explicit four-state publishing model with a server-enforced publish gate, then prove both blocked and successful publication in a real browser before opening a PR to `main`.

**Architecture:** Extend, rather than replace, the live stack already formed by `survey-runtime.ts`, `SurveyService`, `PgSurveyRepository`, `SurveyController`, `survey_workspaces`, `LiveSurveyWorkspace`, and `survey-complete-flow.spec.ts`. Add a pure transition/gate layer underneath the existing service; migrate the JSON aggregate and HTTP commands without losing publication tokens, responses, attachments, reports, or templates. The existing controller, repository, live workspace, and end-to-end journey remain the integration points and regression anchors.

**Tech Stack:** TypeScript, Zod, NestJS, PostgreSQL migrations, React 18, Next.js 14, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-survey-trusted-publishing-foundation-design.md`

## Global Constraints

- Do not begin product-code implementation until the Phase 09 Survey bundle has human-confirmed UI, use-case, and API-contract signoff and phase coherence passes.
- Reuse `packages/contracts/src/survey-runtime.ts`, `apps/api/src/application/survey/survey-service.ts`, `apps/api/src/infrastructure/survey/pg-survey-repository.ts`, the existing principal/org boundary, `apps/web/lib/survey/runtime-client.ts`, and the existing five-step live workspace.
- Do not create a second survey, identity, authorization, or artifact model.
- Preserve current publication tokens, submissions, attachment claims, reports, report provenance, and template-library behavior throughout the migration.
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

### Task 1: Extend the live survey runtime contract

**Files:**
- Modify: `packages/contracts/src/survey-runtime.ts`
- Modify: `packages/contracts/src/survey.ts` only for shared blocker/status value objects
- Modify: `packages/contracts/tests/survey.test.ts`

**Interfaces:**
- Consumes: existing `SurveyDraftInputSchema`, `SurveySaveInputSchema`, `SurveyRuntimeSchema`, publication snapshot, responses, report provenance, and question/report schemas.
- Produces: additive status, anonymity, blocker, and command-envelope schemas that parse old persisted JSON with explicit defaults while retaining every existing runtime field.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import { survey } from "../src";

describe("survey publishing contract", () => {
  it("retains forbidden save fields for the application conflict check", () => {
    const parsed = SurveySaveCommandSchema.parse({
      expectedVersion: 1,
      draft: validDraft,
      anonymity: "identified",
    });
    expect(parsed.anonymity).toBe("identified");
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

Expected: FAIL because the additive status, anonymity, blocker, and command-envelope schemas do not exist.

- [ ] **Step 3: Add strict schemas and operation metadata**

Implement additive Zod schemas for creation, read, editable draft content, prepare, withdraw, start-collection, and close. Keep `SurveyDraftInputSchema` compatible with the existing editor, introduce a create envelope that fixes anonymity once, and define a save transport envelope that explicitly retains optional forbidden `anonymity`/`status` keys so the application layer can return the promised `409` instead of having the parser erase them or convert them into an unrelated `400`. Command responses include the complete existing runtime projection plus blockers. Keep error and blocker codes as enums, not free text.

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
git add packages/contracts/src/survey-runtime.ts packages/contracts/src/survey.ts packages/contracts/tests/survey.test.ts
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

### Task 3: Migrate the existing organization-scoped aggregate

**Files:**
- Modify: `apps/api/migrations/20260920010000_survey_workspaces.sql` only if a forward-compatible database constraint can be added safely; otherwise add one new forward migration
- Modify: `apps/api/src/application/survey/survey-service.ts`
- Modify: `apps/api/src/infrastructure/survey/pg-survey-repository.ts`
- Modify: `apps/api/tests/survey/survey-persistence.test.ts`
- Modify: `apps/api/tests/survey/survey-runtime.test.ts`
- Create: `apps/api/tests/survey/survey-repository-concurrency.test.ts`

**Interfaces:**
- Consumes: the existing `SurveyRecord`, `SurveyRepository`, `SurveyService.change`, `survey_workspaces.document`, publication token/snapshot, receipts, responses, reports, and attachment transaction hook.
- Produces: backward-compatible aggregate hydration plus compare-and-swap state transitions inside the existing `transact` boundary; no parallel repository or table.

- [ ] **Step 1: Write failing repository integration tests**

Pin the existing persistence behavior first: creation at version 1, owner and tenant isolation, publication token/snapshot retention, responses/receipts/report retention, attachment claim support, and current save/publish/close flows. Then add compare-and-swap transition, stale version rejection, legacy-document hydration, and duplicate delivery cases. Assert the complete JSON document remains unchanged after every rejected update.

```ts
await service.prepare(orgId, actorId, surveyId, 1);
await expect(service.prepare(orgId, actorId, surveyId, 1))
  .rejects.toMatchObject({ code: "version_conflict" });
expect((await service.get(orgId, actorId, surveyId)).version).toBe(2);
```

- [ ] **Step 2: Run repository tests and confirm RED**

Run: `pnpm --filter api exec vitest run tests/survey/survey-repository-concurrency.test.ts`

Expected: existing persistence regressions PASS; the new concurrency/migration assertions FAIL because the four-state fields and transition path are absent.

- [ ] **Step 3: Add an additive aggregate migration**

Keep `survey_workspaces` as the only aggregate table. Add a forward migration only for constraints/indexes that cannot live safely in the JSON schema. Hydrate legacy documents that have `publication: null` as `draft` and published documents as `collecting` or `closed`; add default anonymity without deleting any existing field. Do not add replacement response, attachment, report, or template tables.

- [ ] **Step 4: Extend the existing service/repository transaction**

Continue using `db.withTenant(orgId, ...)` and the existing row lock in `PgSurveyRepository.transact`. Perform the gate and transition against the locked `SurveyRecord`, retain the complete document, and write once only when it changes. Owner/tenant invisibility must keep returning the same `not_found`; stale versions return `version_conflict` without disclosing another tenant's row.

- [ ] **Step 5: Run migration, repository tests, and migration checks**

Run: `pnpm --filter api migrate:check && pnpm --filter api exec vitest run tests/survey/survey-persistence.test.ts tests/survey/survey-runtime.test.ts tests/survey/survey-repository-concurrency.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the persistence slice**

```bash
git add apps/api/migrations apps/api/src/application/survey/survey-service.ts apps/api/src/infrastructure/survey/pg-survey-repository.ts apps/api/tests/survey
git commit -m "feat(survey): migrate live aggregate publishing state"
```

### Task 4: Extend the existing server-enforced survey commands

**Files:**
- Modify: `apps/api/src/application/survey/survey-service.ts`
- Modify: `apps/api/src/interface/controllers/survey.controller.ts`
- Modify: `apps/api/src/kernel.module.ts` only if an additional existing binding is required
- Modify: `apps/api/tests/survey/survey-http.test.ts`
- Modify: `apps/api/tests/survey/survey-runtime.test.ts`
- Create: `apps/api/tests/survey/anonymity-immutable.test.ts`
- Create: `apps/api/tests/survey/publish-gate-server-enforced.test.ts`

**Interfaces:**
- Consumes: the existing `SurveyService`, `SurveyRepository`, domain transition/gate functions, `CurrentPrincipal`, and live `/surveys` controller.
- Produces: additive authenticated commands under `/surveys` with stable 400/404/409/422/500 semantics while preserving create/get/save/delete/publish/close/review/report and public submission routes.

- [ ] **Step 1: Write failing HTTP tests for anonymity and enumeration safety**

Send both anonymity-direction save attempts and assert `409 ANONYMITY_IMMUTABLE`. The transport schema must retain `anonymity` through parsing, and `SurveyService` must reject it before mutation. Request another organization's survey and a random ID, and assert status and response bytes are identical. Keep the existing HTTP suite green to pin every pre-F04 route.

- [ ] **Step 2: Write failing direct-publish tests**

Call `POST /surveys/:id/prepare` without visiting the UI. Assert multiple blockers arrive together with `422`, status remains draft, fixing the same version permits ready, and a concurrent edit returns `409 SURVEY_VERSION_CONFLICT`.

- [ ] **Step 3: Run the three F04 API verification files and confirm RED**

Run: `pnpm --filter api exec vitest run tests/survey/state-machine-four.test.ts tests/survey/anonymity-immutable.test.ts tests/survey/publish-gate-server-enforced.test.ts`

Expected: existing survey HTTP/runtime regressions PASS; the new assertions FAIL because the existing service/controller do not yet expose prepare/withdraw or immutable-anonymity conflict semantics.

- [ ] **Step 4: Implement application use cases**

Keep business rules out of the controller. Extend `SurveyService` so prepare loads the existing aggregate in its tenant transaction, evaluates all blockers, and changes status only when empty. The controller parses a transport envelope that preserves optional forbidden `anonymity`/`status` keys; the service maps their presence to `ANONYMITY_IMMUTABLE`/`STATUS_COMMAND_REQUIRED` before repository mutation. Do not make the Zod layer reject or strip those keys if the promised HTTP result is `409`.

- [ ] **Step 5: Implement the controller and composition-root wiring**

Continue using the controller's existing contract parsing and `CurrentPrincipal` boundary; map new typed errors in the existing `run()` adapter. Extend the already-registered `SurveyController` and existing `SURVEY_REPOSITORY` binding—do not register a second controller, service, or repository.

- [ ] **Step 6: Run API verification, typecheck, lint, and mutation checks**

Run: `pnpm --filter api exec vitest run tests/survey/survey-http.test.ts tests/survey/survey-runtime.test.ts tests/survey/state-machine-four.test.ts tests/survey/anonymity-immutable.test.ts tests/survey/publish-gate-server-enforced.test.ts && pnpm --filter api typecheck && pnpm --filter api lint`

Expected: PASS. Then temporarily expect ready for a blocked request and confirm the test fails; restore and rerun.

- [ ] **Step 7: Commit the HTTP slice**

```bash
git add apps/api/src/application/survey/survey-service.ts apps/api/src/interface/controllers/survey.controller.ts apps/api/src/kernel.module.ts apps/api/tests/survey
git commit -m "feat(survey): enforce publish gate over HTTP"
```

### Task 5: Migrate the existing live survey workspace

**Files:**
- Modify: `apps/web/lib/survey/runtime-client.ts`
- Modify: `apps/web/components/survey/live/survey-workspace.tsx`
- Modify: `apps/web/app/studio/survey/[surveyId]/page.tsx`
- Create: `apps/web/tests/ui/survey-live-publishing.test.tsx`
- Modify: `apps/web/tests/ui/survey-live-workspace.test.tsx`
- Modify: `apps/web/e2e/survey-complete-flow.spec.ts`

**Interfaces:**
- Consumes: the existing `surveyRequest`, `LiveSurveyWorkspace`, `SurveyRuntimeSchema`, and live create/save/publish/close/report/response flow.
- Produces: additive prepare/withdraw/start-collection states and explicit loading/error/blocker/conflict rendering without replacing the current workspace or dropping its response/report/template behavior.

- [ ] **Step 1: Write failing UI tests for real-client state**

Extend `survey-live-workspace.test.tsx` and add focused publishing cases at the existing network boundary. Assert initial loading, all blockers after `422`, no optimistic ready badge, retryable system error after `500`, and ready state only after a successful parsed response. Pin the current save, publish link, response review, report, and unsaved-navigation behavior before changing the workspace.

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `pnpm --filter web exec vitest run tests/ui/survey-live-publishing.test.tsx tests/ui/survey-workflow-shell.test.tsx`

Expected: existing live-workspace regressions PASS; the new four-state publishing assertions FAIL because the live workspace does not yet expose prepare/withdraw/start-collection.

- [ ] **Step 3: Extend the schema-validating runtime client**

Extend `surveyRequest` and parse every response with the corresponding contract output schema. Convert `422` into typed blockers, `409` into typed conflict, and all other failures into a retryable system error. Preserve existing error behavior for public submissions and uploads. Do not infer status locally.

- [ ] **Step 4: Integrate the hook and publish step**

Production survey IDs already load through `LiveSurveyWorkspace`; extend that component rather than routing to `SurveyWorkflowShell` or a new hook. Render business blockers separately from system errors, preserve local editing on version conflict, and keep the existing live responses/report/template path intact.

- [ ] **Step 5: Run survey UI regression and design lint**

Run: `pnpm --filter web exec vitest run tests/ui/survey-live-workspace.test.tsx tests/ui/survey-public-form.test.tsx tests/ui/survey-template-workspace-live.test.tsx tests/ui/survey-unsaved-navigation.test.tsx tests/ui/survey-live-publishing.test.tsx && pnpm --filter web typecheck && pnpm --filter web lint:design`

Expected: PASS.

- [ ] **Step 6: Commit the web slice**

```bash
git add apps/web/lib/survey/runtime-client.ts apps/web/components/survey/live/survey-workspace.tsx apps/web/app/studio/survey apps/web/tests/ui apps/web/e2e/survey-complete-flow.spec.ts
git commit -m "feat(survey): migrate live publishing workflow"
```

### Task 6: Prove the real user journey and prepare the PR

**Files:**
- Modify: `apps/web/e2e/survey-complete-flow.spec.ts`
- Create: `apps/web/e2e/survey-trusted-publishing.spec.ts` only if the focused blocked/ready journey cannot remain readable in the existing complete-flow spec
- Create: `phases/phase-09-survey/sprints/sprint-01/evidence/F04-browser.png`
- Modify: `phases/phase-09-survey/sprints/sprint-01/progress.md`
- Modify: `phases/phase-09-survey/sprints/sprint-01/session-handoff.md`
- Modify: `.agents/skills/mod-survey/SKILL.md` only if a new verified module-specific lesson was discovered

**Interfaces:**
- Consumes: running migrated API/web stack, a dev-mode authenticated user, and the live HTTP/UI path from Tasks 1–5.
- Produces: a Playwright/live-browser acceptance test, accepted screenshots, harness evidence, and a PR targeting `main`.

- [ ] **Step 1: Write the failing Playwright journey**

First keep the existing `survey-complete-flow.spec.ts` journey green. Extend it, or add one focused companion spec, to create an anonymous draft, open the publish step, prove multiple blockers are visible and the status remains draft, repair the question/section problems, prepare successfully, start collection, reload, and prove collecting persisted. It also attempts a direct HTTP anonymity change and expects rejection.

- [ ] **Step 2: Run the journey and confirm RED before the final integration is complete**

Run the repository's full-stack Playwright configuration with only `e2e/survey-trusted-publishing.spec.ts`.

Expected: FAIL before the complete live wiring; keep the trace as counter-evidence, not completion evidence.

- [ ] **Step 3: Start the standard stack and run migrations**

Use the repository's documented dev/full-stack commands and a task-owned compose project. Do not reuse or destroy another agent's stack.

- [ ] **Step 4: Run automated Playwright verification**

Run: `pnpm --filter web exec playwright test e2e/survey-complete-flow.spec.ts e2e/survey-trusted-publishing.spec.ts --config playwright.fullstack-smoke.config.ts` (omit the companion path if the focused journey was folded into `survey-complete-flow.spec.ts`).

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
