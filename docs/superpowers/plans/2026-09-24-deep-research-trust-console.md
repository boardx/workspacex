# Deep Research Trust Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trustworthy research control surface that makes intent, plans, source boundaries, live activity, coverage, claim evidence, conflicts, quality, and publication readiness visible and controllable in the existing guided research workflow.

**Architecture:** Extend the existing `GuidedResearchRuntime` contract and PostgreSQL-backed runtime state rather than creating a new engine. Pure projection functions compute coverage, conflicts, quality, and readiness from persisted tasks, sources, evidence warnings, and report review data; focused React panels consume that projection and steering commands flow through the existing command/controller/runtime-service path.

**Tech Stack:** TypeScript, Zod, NestJS, PostgreSQL JSONB runtime store, Next.js/React, Tailwind/shadcn, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-deep-research-trust-console-design.md`

## Global Constraints

- Reuse the existing five-step guided research workflow and PostgreSQL runtime; do not create a second research engine or report generator.
- `packages/contracts/src/research.ts` is the single source of truth for public schemas and enums.
- Existing effort budget, Evidence Snapshot, Claim Ledger, and Stop Evaluator concepts are reused when present on `main`; this change must not duplicate them.
- `PublicationReadiness` is computed by the server and is never accepted from the client.
- Activity summaries expose auditable actions and tool outcomes, never hidden reasoning or chain-of-thought.
- Internal-source access remains bounded by existing authorization; `open` expands public web discovery only.
- Old runtime rows without trust-console fields must parse and render as “暂无数据”, never as a false high score.
- The PR targets `main`, references Issue #4083, does not enable auto-merge, and waits for human merge.

## Review Focus

- A stale browser sends `expectedRevision: 1` after another tab saved revision 2: reject with a revision conflict and preserve revision 2 (Task 2).
- A legacy runtime has none of the new fields: parse it, show unknown metrics, and never render `ready` by default (Tasks 1, 3, and 5).
- A restricted source policy includes an unauthorized internal source: reject it before orchestration and do not persist a partial policy (Task 2).
- The stream disconnects and replays the last activity event: deduplicate by event ID and retain server sequence order (Tasks 2 and 5).
- A report has high source count but an unsupported key claim or open severe conflict: readiness remains `limited` (Task 3).

---

## File Structure

### Contracts and domain projection

- Modify `packages/contracts/src/research.ts`: trust-console schemas, runtime fields, steering command variants, stream projection.
- Create `apps/api/src/application/research/guided-research-trust.ts`: pure intent validation and coverage/conflict/quality/readiness projection.
- Modify `apps/api/src/application/research/guided-runtime-service.ts`: command handling, activity emission, revision checks, projection refresh.
- Modify `apps/api/src/application/research/guided-runtime-ports.ts`: typed authorization hook for internal source IDs if the existing port lacks it.
- Modify `apps/api/src/infrastructure/research/pg-guided-runtime-store.ts`: preserve revisioned state and idempotent commands in the existing JSONB row.

### Web UI

- Create `apps/web/components/research-studio/guided-research-intent-plan.tsx`: intent card, editable plan, source policy.
- Create `apps/web/components/research-studio/guided-research-trust-console.tsx`: responsive shell and tabs.
- Create `apps/web/components/research-studio/guided-research-activity.tsx`: live trace and steering controls.
- Create `apps/web/components/research-studio/guided-research-evidence-console.tsx`: coverage, claim evidence, conflicts.
- Create `apps/web/components/research-studio/guided-research-readiness.tsx`: quality score and publication gate.
- Modify `apps/web/components/research-studio/guided-research-flow.tsx`: mount pre-run intent/plan controls.
- Modify `apps/web/components/research-studio/guided-research-live.tsx`: mount the running trust console.
- Modify `apps/web/components/research-studio/guided-research-report-document.tsx`: show readiness and limitation banner in report/export content.
- Modify `apps/web/lib/guided-research-api.ts` and `apps/web/lib/guided-research-stream.ts`: expose contract types and replay-safe event handling.

### Verification

- Create `packages/contracts/src/research-trust.test.ts`.
- Create `apps/api/tests/research/guided-research-trust.test.ts`.
- Create `apps/api/tests/research/guided-research-steering.test.ts`.
- Create `apps/web/tests/ui/guided-research-trust-console.test.tsx`.
- Create `apps/web/tests/ui/guided-research-readiness.test.tsx`.
- Modify `apps/web/e2e/guided-research-runtime.spec.ts` with success, steering, conflict, and limited-publication paths.

## Task 1: Define Versioned Trust-Console Contracts

**Files:**
- Modify: `packages/contracts/src/research.ts`
- Create: `packages/contracts/src/research-trust.test.ts`

**Interfaces:**
- Consumes: existing `GuidedResearchRuntime`, `GuidedResearchRuntimeCommand`, task/source/report schemas.
- Produces: `GuidedResearchIntent`, `GuidedResearchSourcePolicy`, `GuidedResearchActivityEvent`, `GuidedResearchCoverageItem`, `GuidedResearchClaimEvidenceView`, `GuidedResearchEvidenceConflict`, `GuidedResearchQualityScore`, and `GuidedResearchPublicationReadiness` Zod schemas; runtime fields `intent`, `planRevision`, `sourcePolicy`, `activity`, `coverage`, `claimEvidence`, `conflicts`, `qualityScore`, `publicationReadiness`.

- [ ] **Step 1: Write contract tests for valid data, strict rejection, legacy defaults, and null metrics**

```ts
it("parses a legacy runtime without claiming publication readiness", () => {
  const parsed = research.GuidedResearchRuntime.parse(legacyRuntimeFixture());
  expect(parsed.publicationReadiness).toBeUndefined();
  expect(parsed.qualityScore).toBeUndefined();
});

it("keeps unknown quality distinct from zero", () => {
  const parsed = research.GuidedResearchQualityScore.parse({
    citationCoverage: null, authority: null, recency: null,
    crossValidation: null, openGapCount: 0, overall: null, explanations: [],
  });
  expect(parsed.overall).toBeNull();
});
```

- [ ] **Step 2: Run the focused contract test and confirm the schemas do not exist yet**

Run: `pnpm --filter @workspace-x/contracts test -- research-trust.test.ts`

Expected: FAIL because `GuidedResearchQualityScore` and the runtime fields are not exported.

- [ ] **Step 3: Add strict schemas and command variants**

```ts
export const GuidedResearchSourcePolicy = z.object({
  mode: z.enum(["restrict", "prioritize", "open"]),
  domains: z.array(z.string().trim().min(1).max(253)).max(50),
  internalSourceIds: z.array(z.string().min(1)).max(100),
  revision: z.number().int().nonnegative(),
}).strict();

export const GuidedResearchPublicationReadiness = z.object({
  status: z.enum(["ready", "limited"]),
  blockers: z.array(z.string().min(1)).max(50),
  warnings: z.array(z.string().min(1)).max(50),
}).strict();
```

Add `pause`, `resume`, `refine_scope`, and `refine_source_policy` command variants with `idempotencyKey` and `expectedRevision`; add optional runtime fields so old JSONB rows remain valid.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `pnpm --filter @workspace-x/contracts test -- research-trust.test.ts && pnpm --filter @workspace-x/contracts typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the contract slice**

```bash
git add packages/contracts/src/research.ts packages/contracts/src/research-trust.test.ts
git commit -m "feat(research): define trust console contracts"
```

## Task 2: Persist Intent, Source Policy, Activity, and Steering

**Files:**
- Modify: `apps/api/src/application/research/guided-runtime-service.ts`
- Modify: `apps/api/src/application/research/guided-runtime-ports.ts`
- Modify: `apps/api/src/infrastructure/research/pg-guided-runtime-store.ts`
- Create: `apps/api/tests/research/guided-research-steering.test.ts`

**Interfaces:**
- Consumes: Task 1 command and state schemas.
- Produces: `applyTrustCommand(state, command, authorizedSourceIds)` behavior inside the runtime service; monotonic `planRevision` and source-policy revision; replay-safe activity events.

- [ ] **Step 1: Write failing tests for authorization, revision conflicts, pause semantics, and idempotency**

```ts
it("rejects a stale steering command without changing persisted state", async () => {
  await store.seed(runtimeWithRevision(2));
  await expect(execute(refinePolicyCommand({ expectedRevision: 1 })))
    .rejects.toMatchObject({ code: "RESEARCH_REVISION_CONFLICT" });
  expect((await store.read()).sourcePolicy?.revision).toBe(2);
});

it("deduplicates a retried resume command", async () => {
  await execute(resumeCommand({ idempotencyKey: "resume-1" }));
  await execute(resumeCommand({ idempotencyKey: "resume-1" }));
  expect((await store.read()).activity.filter(e => e.id === "resume-1")).toHaveLength(1);
});
```

Also assert: pause prevents new task start; unauthorized internal IDs reject atomically; replayed events remain in server sequence order.

- [ ] **Step 2: Run the steering tests and verify failure**

Run: `pnpm --filter @workspace-x/api test -- tests/research/guided-research-steering.test.ts`

Expected: FAIL with unsupported command/revision behavior.

- [ ] **Step 3: Implement command validation and persistence**

Use a single transaction to check `expectedRevision`, validate every requested internal source ID, store the new state, and append one activity event. Use the command idempotency key as the durable receipt key; return the already-committed state on exact retry.

```ts
if (command.expectedRevision !== state.planRevision) {
  throw researchError("RESEARCH_REVISION_CONFLICT");
}
if (command.action === "pause") next.status = "paused";
if (command.action === "resume") next.status = next.resumeStage === "report" ? "reporting" : "researching";
```

- [ ] **Step 4: Run steering, persistence, and orchestration regression tests**

Run: `pnpm --filter @workspace-x/api test -- tests/research/guided-research-steering.test.ts tests/research/guided-runtime-persistence.test.ts tests/research/guided-runtime-orchestration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit runtime control behavior**

```bash
git add apps/api/src/application/research/guided-runtime-service.ts apps/api/src/application/research/guided-runtime-ports.ts apps/api/src/infrastructure/research/pg-guided-runtime-store.ts apps/api/tests/research/guided-research-steering.test.ts
git commit -m "feat(research): persist research steering controls"
```

## Task 3: Compute Coverage, Conflicts, Quality, and Readiness

**Files:**
- Create: `apps/api/src/application/research/guided-research-trust.ts`
- Modify: `apps/api/src/application/research/guided-runtime-service.ts`
- Create: `apps/api/tests/research/guided-research-trust.test.ts`

**Interfaces:**
- Consumes: persisted outline, tasks, sources, evidence warnings, report sections, quality warnings, and Task 1 schemas.
- Produces: `projectResearchTrust(runtime): GuidedResearchTrustProjection`; deterministic `limited` blockers and score explanations.

- [ ] **Step 1: Write table-driven failing tests for projection rules**

```ts
it.each([
  ["unsupported key claim", fixture({ unsupportedKeyClaim: true }), "关键结论缺少来源"],
  ["open severe conflict", fixture({ openConflict: true }), "存在未解决的严重冲突"],
  ["missing core question", fixture({ missingCoreQuestion: true }), "核心问题覆盖不足"],
])("keeps %s limited", (_name, state, blocker) => {
  const result = projectResearchTrust(state);
  expect(result.publicationReadiness).toMatchObject({ status: "limited" });
  expect(result.publicationReadiness.blockers).toContain(blocker);
});
```

Add assertions for: many low-quality sources do not force ready; no denominator yields `null`, not 0; resolved conflicts remain visible; legacy state is limited with unknown scores.

- [ ] **Step 2: Run the projection test and verify failure**

Run: `pnpm --filter @workspace-x/api test -- tests/research/guided-research-trust.test.ts`

Expected: FAIL because `projectResearchTrust` does not exist.

- [ ] **Step 3: Implement pure deterministic projection helpers**

```ts
export function projectResearchTrust(runtime: GuidedResearchRuntime): GuidedResearchTrustProjection {
  const coverage = projectCoverage(runtime.outline, runtime.tasks, runtime.report, runtime.reportEvidenceWarnings ?? []);
  const claimEvidence = projectClaimEvidence(runtime);
  const conflicts = projectConflicts(claimEvidence);
  const qualityScore = scoreResearch({ coverage, claimEvidence, conflicts, sources: runtime.sources });
  return { coverage, claimEvidence, conflicts, qualityScore,
    publicationReadiness: decideReadiness({ coverage, claimEvidence, conflicts, qualityScore }) };
}
```

Keep scoring formulas and blocker thresholds as named exported constants in this file so tests and production share one source.

- [ ] **Step 4: Run trust projection plus existing evidence/quality tests**

Run: `pnpm --filter @workspace-x/api test -- tests/research/guided-research-trust.test.ts tests/research/guided-report-evidence.test.ts tests/research/guided-report-quality.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the server projection**

```bash
git add apps/api/src/application/research/guided-research-trust.ts apps/api/src/application/research/guided-runtime-service.ts apps/api/tests/research/guided-research-trust.test.ts
git commit -m "feat(research): derive trust and publication readiness"
```

## Task 4: Add Intent, Plan, and Source Policy UI

**Files:**
- Create: `apps/web/components/research-studio/guided-research-intent-plan.tsx`
- Modify: `apps/web/components/research-studio/guided-research-flow.tsx`
- Modify: `apps/web/lib/guided-research-api.ts`
- Create: `apps/web/tests/ui/guided-research-trust-console.test.tsx`

**Interfaces:**
- Consumes: Task 1 intent/plan/source policy fields and existing execute API.
- Produces: `GuidedResearchIntentPlan` with `onConfirm({ intent, plan, sourcePolicy, expectedRevision })`; stable test IDs for intent, plan, and source policy.

- [ ] **Step 1: Write failing interaction and accessibility tests**

```tsx
it("blocks start until decision and success criteria are present", async () => {
  render(<GuidedResearchIntentPlan value={emptyValue} onConfirm={onConfirm} />);
  expect(screen.getByRole("button", { name: "开始研究" })).toBeDisabled();
  await user.type(screen.getByLabelText("决策对象"), "决定企业搜索供应商");
  await user.type(screen.getByLabelText("成功标准"), "每个关键结论至少两类来源");
  expect(screen.getByRole("button", { name: "开始研究" })).toBeEnabled();
});
```

Also assert mode is a labelled radio group, all ten console test IDs stay unique, keyboard users can edit plan rows, and revision conflict keeps unsaved input visible.

- [ ] **Step 2: Run the UI test and verify failure**

Run: `pnpm --filter @workspace-x/web test -- guided-research-trust-console.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the pre-run card using existing design-system primitives**

Use controlled fields, inline validation, explicit labels, and a radio group for `restrict / prioritize / open`. Submit only through the existing guided runtime API; do not store a shadow copy in local storage.

- [ ] **Step 4: Run focused UI tests and typecheck**

Run: `pnpm --filter @workspace-x/web test -- guided-research-trust-console.test.tsx guided-research-flow.test.tsx && pnpm --filter @workspace-x/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit pre-run controls**

```bash
git add apps/web/components/research-studio/guided-research-intent-plan.tsx apps/web/components/research-studio/guided-research-flow.tsx apps/web/lib/guided-research-api.ts apps/web/tests/ui/guided-research-trust-console.test.tsx
git commit -m "feat(research): add intent plan and source controls"
```

## Task 5: Add Live Trust Console and Steering UI

**Files:**
- Create: `apps/web/components/research-studio/guided-research-trust-console.tsx`
- Create: `apps/web/components/research-studio/guided-research-activity.tsx`
- Create: `apps/web/components/research-studio/guided-research-evidence-console.tsx`
- Modify: `apps/web/components/research-studio/guided-research-live.tsx`
- Modify: `apps/web/lib/guided-research-stream.ts`
- Modify: `apps/web/tests/ui/guided-research-trust-console.test.tsx`

**Interfaces:**
- Consumes: activity, coverage, claim evidence, conflicts and steering API from Tasks 1–3.
- Produces: `GuidedResearchTrustConsole`; replay-safe `mergeActivityEvents(current, incoming)`; stable test IDs for activity, steering, coverage, claim evidence, and conflicts.

- [ ] **Step 1: Add failing tests for live behavior and responsive access**

```ts
it("deduplicates replayed activity and keeps server order", () => {
  expect(mergeActivityEvents([event("e2", 2)], [event("e1", 1), event("e2", 2)]).map(e => e.id))
    .toEqual(["e1", "e2"]);
});
```

Render tests must assert: pause disables itself until acknowledged; stale-command error preserves the proposed edit; answered/weak/missing include text or icons, not color alone; claim quote is keyboard reachable; both sides of an open conflict remain visible; mobile tabs expose all three panels without hover.

- [ ] **Step 2: Run the focused UI test and verify failure**

Run: `pnpm --filter @workspace-x/web test -- guided-research-trust-console.test.tsx`

Expected: FAIL on missing console and merge helper.

- [ ] **Step 3: Implement the responsive console and replay-safe stream merge**

Use a desktop grid and mobile tabs labelled `覆盖`, `活动`, `证据`. Render empty/unknown states explicitly. Steering buttons send one command and wait for the server snapshot before reflecting the new status.

- [ ] **Step 4: Run live UI, stream, and accessibility-adjacent regressions**

Run: `pnpm --filter @workspace-x/web test -- guided-research-trust-console.test.tsx guided-research-live.test.tsx guided-research-stream-client.test.ts guided-research-readable-sources.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the live console**

```bash
git add apps/web/components/research-studio/guided-research-trust-console.tsx apps/web/components/research-studio/guided-research-activity.tsx apps/web/components/research-studio/guided-research-evidence-console.tsx apps/web/components/research-studio/guided-research-live.tsx apps/web/lib/guided-research-stream.ts apps/web/tests/ui/guided-research-trust-console.test.tsx
git commit -m "feat(research): add live trust console"
```

## Task 6: Add Report Quality Score and Publication Gate

**Files:**
- Create: `apps/web/components/research-studio/guided-research-readiness.tsx`
- Modify: `apps/web/components/research-studio/guided-research-report-document.tsx`
- Create: `apps/web/tests/ui/guided-research-readiness.test.tsx`

**Interfaces:**
- Consumes: Task 3 `qualityScore` and `publicationReadiness` projection.
- Produces: `GuidedResearchReadiness`; `research-quality-score` and `research-publication-readiness`; limitation summary included in report/export DOM.

- [ ] **Step 1: Write failing readiness and export tests**

```tsx
it("renders limited completion and carries blockers into export content", () => {
  render(<GuidedResearchReportDocument runtime={limitedRuntime} />);
  expect(screen.getByTestId("research-publication-readiness")).toHaveTextContent("带限制完成");
  expect(screen.getByText("关键结论缺少来源")).toBeInTheDocument();
  expect(screen.queryByText(/^完成$/)).not.toBeInTheDocument();
});
```

Also assert `null` metrics show `暂无数据`, score explanations are expandable, and a ready report shows no false limitation banner.

- [ ] **Step 2: Run readiness tests and verify failure**

Run: `pnpm --filter @workspace-x/web test -- guided-research-readiness.test.tsx research-report-document.test.tsx research-report-export.test.tsx`

Expected: FAIL because readiness is not rendered.

- [ ] **Step 3: Implement score details and server-authoritative readiness copy**

Render metrics with their explanation and denominator. Never derive `ready` in React. Include blockers, warnings, and readiness timestamp in the printable/exported report section.

- [ ] **Step 4: Run report and export regression tests**

Run: `pnpm --filter @workspace-x/web test -- guided-research-readiness.test.tsx research-report-document.test.tsx research-report-export.test.tsx guided-research-report-reading.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the report gate**

```bash
git add apps/web/components/research-studio/guided-research-readiness.tsx apps/web/components/research-studio/guided-research-report-document.tsx apps/web/tests/ui/guided-research-readiness.test.tsx
git commit -m "feat(research): gate report publication by evidence quality"
```

## Task 7: Verify the Real Workflow and Prepare the PR

**Files:**
- Modify: `apps/web/e2e/guided-research-runtime.spec.ts`
- Create: `.harness/state/deep-research-trust-console-evidence.md`

**Interfaces:**
- Consumes: all prior tasks and the real local API/PostgreSQL/browser stack.
- Produces: reproducible browser assertions and evidence paths for Issue #4083 and the PR.

- [ ] **Step 1: Add Playwright scenarios for the complete journey**

```ts
test("steers research and changes limited report to ready", async ({ page }) => {
  await createResearchThroughIntent(page);
  await expect(page.getByTestId("research-activity-trace")).toContainText("正在检索");
  await page.getByRole("button", { name: "暂停研究" }).click();
  await expect(page.getByTestId("research-steering-controls")).toContainText("已暂停");
  await openLimitedFixture(page);
  await expect(page.getByTestId("research-publication-readiness")).toContainText("带限制完成");
  await remediateMissingEvidence(page);
  await expect(page.getByTestId("research-publication-readiness")).toContainText("可发布");
});
```

Use real API/database setup helpers already present in the spec; no route interception may supply the trust projection.

- [ ] **Step 2: Run focused unit/integration verification**

Run: `pnpm --filter @workspace-x/contracts test -- research-trust.test.ts && pnpm --filter @workspace-x/api test -- tests/research/guided-research-trust.test.ts tests/research/guided-research-steering.test.ts && pnpm --filter @workspace-x/web test -- guided-research-trust-console.test.tsx guided-research-readiness.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run typechecks, lint, and the existing guided-research regression set**

Run: `pnpm --filter @workspace-x/contracts typecheck && pnpm --filter @workspace-x/api typecheck && pnpm --filter @workspace-x/web typecheck && pnpm --filter @workspace-x/api lint && pnpm --filter @workspace-x/web lint`

Run: `pnpm --filter @workspace-x/api test -- tests/research/guided-runtime-orchestration.test.ts tests/research/guided-runtime-persistence.test.ts tests/research/guided-report-evidence.test.ts tests/research/guided-report-quality.test.ts`

Expected: PASS.

- [ ] **Step 4: Start the owned stack and run the real-browser test**

Run the repository-standard owned Docker/API/web stack described by `.harness/instructions/dev-mode-testing.md`, then:

Run: `pnpm --filter @workspace-x/web e2e -- guided-research-runtime.spec.ts`

Expected: PASS with real browser + API + PostgreSQL; save trace/screenshot paths and database assertions in `.harness/state/deep-research-trust-console-evidence.md`.

- [ ] **Step 5: Run the base verification and inspect the complete diff**

Run: `./init.sh`

Run: `git diff origin/main...HEAD --check && git status --short && git log --oneline origin/main..HEAD`

Expected: baseline passes, no whitespace errors, and only Issue #4083 scope is present.

- [ ] **Step 6: Commit E2E evidence, push, and create the PR**

```bash
git add apps/web/e2e/guided-research-runtime.spec.ts .harness/state/deep-research-trust-console-evidence.md
git commit -m "test(research): verify trustworthy research workflow"
git push -u origin codex/deep-research-trust-console
gh pr create --base main --head codex/deep-research-trust-console --title "feat(research): add trustworthy deep research console" --body "Refs #4083"
```

- [ ] **Step 7: Attach and monitor the PR without merging**

Attach the PR to the current Codex task, monitor required checks, respond to every review conversation with code plus verification when needed, and stop only when the PR is green and ready for human merge. Do not enable auto-merge and do not merge it.
