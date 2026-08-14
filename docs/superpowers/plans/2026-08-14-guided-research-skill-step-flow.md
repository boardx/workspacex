# Guided Research Skill and Step Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a contextual left-side Research Skill assistant and make a guided research session progress, recover, and complete sequentially from brief through a clearly labeled demo report.

**Architecture:** Keep the guided research session and its server stage as the workflow source of truth. Add two narrow lifecycle operations after outline confirmation, isolate deterministic demo search/report state in a versioned browser store, and compose each non-home screen through a shared two-column step layout so the Skill stays contextual without restoring the old Studio navigation.

**Tech Stack:** TypeScript, React 18, Next.js App Router, NestJS, Zod contracts, PostgreSQL, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- The step order is exactly `brief → directions → outline → search → report`.
- Future steps are locked; current and completed steps are reachable; the server `stage`/`resumeStage` remains the recovery authority.
- The left panel is a Research Skill assistant, not the removed Research Studio secondary navigation.
- Skill suggestions never mutate research content until the user clicks `应用建议`, and the latest applied suggestion can be undone.
- Search results, Skill replies, and report content in this feature are deterministic demo data and must visibly say they are not real research evidence.
- Do not add a dependency or implement F170 real Web Search or F171 real report generation.
- Keep the existing green/neutral visual system and ensure the main content is not horizontally clipped at 1280px or 1920px.
- Preserve unrelated dirty-worktree changes and do not hand-edit generated `active-features.json` views.

---

## File Structure

- `packages/contracts/src/research.ts`: adds the two explicit post-outline lifecycle operations and the closed stage-conflict reason code.
- `packages/contracts/tests/guided-research-session-contract.test.ts`: proves lifecycle input/output and error contracts.
- `apps/api/src/application/research/guided-session-ports.ts`: exposes repository lifecycle methods and the typed stage-conflict error.
- `apps/api/src/infrastructure/research/pg-guided-research-session-repository.ts`: performs transactional stage transitions and refuses out-of-order transitions.
- `apps/api/src/interface/controllers/guided-research.controller.ts`: validates and discloses the new lifecycle operations.
- `apps/api/tests/research/guided-session-list-and-recovery.test.ts`: proves persisted outline → researching → report → completed recovery.
- `apps/web/lib/guided-research-api.ts`: provides typed lifecycle request helpers.
- `apps/web/lib/guided-research-stage.ts`: contains the pure requested-step clamp and progress unlock helpers.
- `apps/web/lib/mock/guided-research-demo-state.ts`: owns deterministic demo tasks, source decisions, report data, and versioned local persistence.
- `apps/web/lib/guided-research-skill-state.ts`: owns typed Skill messages, suggestions, snapshots, application, undo, and session-scoped persistence.
- `apps/web/components/research-studio/guided-research-skill-assistant.tsx`: renders the contextual assistant only.
- `apps/web/components/research-studio/guided-research-step-layout.tsx`: renders responsive left Skill/right workflow composition.
- `apps/web/components/research-studio/guided-research-flow.tsx`: wires server recovery, controlled progress, existing editors, demo screens, and lifecycle operations.
- `apps/web/tests/guided-research-stage.test.ts`: tests the pure sequential gate.
- `apps/web/tests/guided-research-demo-state.test.ts`: tests deterministic demo persistence and idempotency.
- `apps/web/tests/guided-research-skill-state.test.ts`: tests suggestion application, undo, and isolation.
- `apps/web/tests/ui/guided-research-skill-assistant.test.tsx`: tests visible assistant interactions and accessible controls.
- `apps/web/tests/ui/guided-research-flow.test.tsx`: tests the complete five-step user journey.
- `apps/web/tests/ui/guided-research-checkpoints-live.test.tsx`: updates live checkpoint expectations for `researching`.
- `apps/web/tests/ui/guided-research-visual-contract.test.tsx`: asserts the responsive two-column structure and absence of the old submenu.

---

### Task 1: Persist Ordered Post-Outline Lifecycle Transitions

**Files:**
- Modify: `packages/contracts/src/research.ts`
- Modify: `packages/contracts/tests/guided-research-session-contract.test.ts`
- Modify: `apps/api/src/application/research/guided-session-ports.ts`
- Modify: `apps/api/src/infrastructure/research/pg-guided-research-session-repository.ts`
- Modify: `apps/api/src/interface/controllers/guided-research.controller.ts`
- Modify: `apps/api/tests/research/guided-session-list-and-recovery.test.ts`
- Modify: `apps/web/lib/guided-research-api.ts`

**Interfaces:**
- Produces: `finishGuidedResearchCollection(sessionId, { sourceCount }) => Promise<GuidedResearchSession>`.
- Produces: `completeGuidedResearchSession(sessionId) => Promise<GuidedResearchSession>`.
- Produces: `GuidedResearchStageConflictError` with reason code `RESEARCH_STAGE_CONFLICT`.
- Guarantees: confirming an outline persists `stage = resumeStage = "researching"`; finishing collection persists `stage = resumeStage = "report"`; completing persists `status = "completed"`.

- [ ] **Step 1: Write failing contract and API recovery tests**

Add these contract assertions:

```ts
expect(research.operations.finishGuidedResearchCollection).toMatchObject({
  method: "POST",
  path: "/research/guided-sessions/:sessionId/researching/complete",
  err: ["RESEARCH_NOT_FOUND", "RESEARCH_STAGE_CONFLICT"],
});
expect(research.operations.completeGuidedResearchSession).toMatchObject({
  method: "POST",
  path: "/research/guided-sessions/:sessionId/complete",
  err: ["RESEARCH_NOT_FOUND", "RESEARCH_STAGE_CONFLICT"],
});
expect(research.operations.finishGuidedResearchCollection.in.parse({
  sessionId: "grs-1",
  sourceCount: 3,
})).toEqual({ sessionId: "grs-1", sourceCount: 3 });
expect(research.ResearchError.options).toContain("RESEARCH_STAGE_CONFLICT");
```

Extend the isolated API journey to create a session, confirm directions, generate and confirm an outline. Use the existing `base`, `auth`, and parsed `created.sessionId`, then assert with direct fetches:

```ts
expect(confirmedOutline.stage).toBe("researching");
expect(confirmedOutline.resumeStage).toBe("researching");

const reportResponse = await fetch(
  `${base}/research/guided-sessions/${created.sessionId}/researching/complete`,
  {
    method: "POST",
    headers: auth(OWNER),
    body: JSON.stringify({ sourceCount: 3 }),
  },
);
expect(reportResponse.status).toBe(201);
const reported = C.operations.finishGuidedResearchCollection.out.parse(await reportResponse.json());
expect(reported).toMatchObject({
  stage: "report",
  resumeStage: "report",
  sourceCount: 3,
});

const completeResponse = await fetch(
  `${base}/research/guided-sessions/${created.sessionId}/complete`,
  { method: "POST", headers: auth(OWNER), body: JSON.stringify({}) },
);
expect(completeResponse.status).toBe(201);
const completed = C.operations.completeGuidedResearchSession.out.parse(await completeResponse.json());
expect(completed).toMatchObject({ stage: "report", status: "completed", progress: 100 });
```

Also call `/complete` before reaching `report` and assert HTTP 409 with `reasonCode: "RESEARCH_STAGE_CONFLICT"`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-session-list-and-recovery.test.ts
```

Expected: contract compilation or assertions fail because the lifecycle operations and stage transition do not exist.

- [ ] **Step 3: Add the closed contract operations and repository interface**

Add `RESEARCH_STAGE_CONFLICT` once to the closed `ResearchError` enum, then add these operation shapes to `research.operations`:

```ts
finishGuidedResearchCollection: {
  method: "POST",
  path: "/research/guided-sessions/:sessionId/researching/complete",
  in: z.object({
    sessionId: z.string().min(1),
    sourceCount: z.number().int().min(0).max(10_000),
  }).strict(),
  out: GuidedResearchSession,
  err: ["RESEARCH_NOT_FOUND", "RESEARCH_STAGE_CONFLICT"] as const,
},
completeGuidedResearchSession: {
  method: "POST",
  path: "/research/guided-sessions/:sessionId/complete",
  in: z.object({ sessionId: z.string().min(1) }).strict(),
  out: GuidedResearchSession,
  err: ["RESEARCH_NOT_FOUND", "RESEARCH_STAGE_CONFLICT"] as const,
},
```

Add matching repository methods:

```ts
finishCollection(input: {
  orgId: OrgId;
  viewerUserId: string;
  sessionId: string;
  sourceCount: number;
}): Promise<GuardedGuidedResearchSession | null>;
complete(input: {
  orgId: OrgId;
  viewerUserId: string;
  sessionId: string;
}): Promise<GuardedGuidedResearchSession | null>;
```

- [ ] **Step 4: Implement transactional ordered transitions**

In `confirm-outline`, persist:

```ts
stage = "researching";
resumeStage = "researching";
```

Add a shared repository transition that locks the visible row, throws `GuidedResearchStageConflictError` when the current stage or required checkpoint is wrong, then uses these exact mutations:

```ts
// finishCollection, only from researching with confirmed outline
stage = "report";
resumeStage = "report";
progress = 90;
sourceCount = input.sourceCount;
reportId = current.report_id ?? `guided-report-${input.sessionId}`;

// complete, only from report
status = "completed";
progress = 100;
```

Map `GuidedResearchStageConflictError` to HTTP 409 in the controller and disclose the returned row through the existing visibility decision path.

- [ ] **Step 5: Add typed Web API helpers**

Extend `checkpointRequest`'s operation union and export:

```ts
export const finishGuidedResearchCollection = (
  sessionId: string,
  input: Omit<z.infer<typeof research.operations.finishGuidedResearchCollection.in>, "sessionId">,
) => checkpointRequest(research.operations.finishGuidedResearchCollection, sessionId, input);

export const completeGuidedResearchSession = (sessionId: string) =>
  checkpointRequest(research.operations.completeGuidedResearchSession, sessionId, {});
```

- [ ] **Step 6: Run focused tests and typechecks**

Run:

```bash
pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-session-list-and-recovery.test.ts
pnpm --filter api run typecheck
pnpm --filter web run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit the lifecycle slice**

```bash
git add packages/contracts/src/research.ts packages/contracts/tests/guided-research-session-contract.test.ts apps/api/src/application/research/guided-session-ports.ts apps/api/src/infrastructure/research/pg-guided-research-session-repository.ts apps/api/src/interface/controllers/guided-research.controller.ts apps/api/tests/research/guided-session-list-and-recovery.test.ts apps/web/lib/guided-research-api.ts
git commit -m "feat(research): persist guided lifecycle transitions"
```

### Task 2: Add Pure Sequential-Gate and Demo-State Models

**Files:**
- Create: `apps/web/lib/guided-research-stage.ts`
- Create: `apps/web/lib/mock/guided-research-demo-state.ts`
- Create: `apps/web/tests/guided-research-stage.test.ts`
- Create: `apps/web/tests/guided-research-demo-state.test.ts`

**Interfaces:**
- Produces: `maxGuidedResearchStep(session): GuidedResearchStep`.
- Produces: `clampGuidedResearchStep(requested, session): GuidedResearchStep`.
- Produces: `GuidedResearchDemoState`, `loadGuidedResearchDemoState`, `saveGuidedResearchDemoState`, `advanceDemoTask`, and `decideDemoSource`.

- [ ] **Step 1: Write failing pure-function tests**

Cover this table:

```ts
expect(maxGuidedResearchStep(session({ resumeStage: "directions" }))).toBe("directions");
expect(clampGuidedResearchStep("report", session({ resumeStage: "outline" }))).toBe("outline");
expect(clampGuidedResearchStep("brief", session({ resumeStage: "researching" }))).toBe("brief");
expect(clampGuidedResearchStep("search", session({ resumeStage: "researching" }))).toBe("search");
expect(clampGuidedResearchStep("report", session({ resumeStage: "report" }))).toBe("report");
```

For demo state, assert corrupt storage falls back safely, `advanceDemoTask` is idempotent, decisions are session-isolated, and a saved state reloads with the same `version: 1`, tasks, and decisions.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter web exec vitest run tests/guided-research-stage.test.ts tests/guided-research-demo-state.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement the pure stage gate**

Use one shared order and map server stages explicitly:

```ts
const ORDER: GuidedResearchStep[] = ["brief", "directions", "outline", "search", "report"];
const STAGE_MAX: Record<GuidedResearchSession["resumeStage"], GuidedResearchStep> = {
  brief: "brief",
  directions: "directions",
  outline: "outline",
  researching: "search",
  report: "report",
};

export function clampGuidedResearchStep(requested: GuidedResearchStep, session: GuidedResearchSession) {
  if (requested === "home") return "home";
  const max = STAGE_MAX[session.resumeStage];
  return ORDER.indexOf(requested) <= ORDER.indexOf(max) ? requested : max;
}
```

- [ ] **Step 4: Implement deterministic versioned demo state**

Define:

```ts
export interface GuidedResearchDemoState {
  version: 1;
  sessionId: string;
  completedTaskIds: string[];
  sourceDecisions: Record<string, "accepted" | "excluded">;
  reportSummary: string;
}
```

Use the key `wsx.guidedResearch.demo.v1.<sessionId>`. Parse defensively, require matching `version` and `sessionId`, and return a fresh deterministic fixture when parsing or validation fails. `advanceDemoTask` must add an id only when absent; `decideDemoSource` must replace a single source decision without changing other sources.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter web exec vitest run tests/guided-research-stage.test.ts tests/guided-research-demo-state.test.ts
git add apps/web/lib/guided-research-stage.ts apps/web/lib/mock/guided-research-demo-state.ts apps/web/tests/guided-research-stage.test.ts apps/web/tests/guided-research-demo-state.test.ts
git commit -m "feat(research): add sequential demo state"
```

### Task 3: Build Typed Research Skill State and Assistant

**Files:**
- Create: `apps/web/lib/guided-research-skill-state.ts`
- Create: `apps/web/components/research-studio/guided-research-skill-assistant.tsx`
- Create: `apps/web/components/research-studio/guided-research-step-layout.tsx`
- Create: `apps/web/tests/guided-research-skill-state.test.ts`
- Create: `apps/web/tests/ui/guided-research-skill-assistant.test.tsx`

**Interfaces:**
- Produces: discriminated `ResearchEditableSnapshot` for brief, directions, outline, search, and report.
- Produces: `suggestionForResearchPrompt`, `applyResearchSkillSuggestion`, `loadResearchSkillState`, and `saveResearchSkillState`.
- Produces: `<GuidedResearchSkillAssistant step sessionKey snapshot onSnapshotChange />`.
- Produces: `<GuidedResearchStepLayout assistant>{main}</GuidedResearchStepLayout>` responsive composition.

- [ ] **Step 1: Write failing state tests**

Define test snapshots and require exact targeted changes:

```ts
const directionSnapshot = {
  step: "directions",
  value: [{ id: "d1", title: "市场", description: "规模", enabled: true, order: 0 }],
} as const;
const suggestion = suggestionForResearchPrompt("补充研究方向", directionSnapshot);
const applied = applyResearchSkillSuggestion(suggestion, directionSnapshot);
expect(applied.step).toBe("directions");
if (applied.step !== "directions") throw new Error("expected a directions snapshot");
expect(applied.value).toHaveLength(2);
expect(directionSnapshot.value).toHaveLength(1);
```

Also prove that brief suggestions change only brief fields, outline suggestions add an enabled ordered section, search suggestions complete only the next task, report suggestions change only `reportSummary`, undo restores the exact previous snapshot, malformed storage resets, and session keys do not leak messages.

- [ ] **Step 2: Write failing assistant UI tests**

Render the assistant with a direction snapshot and assert:

```ts
expect(screen.getByTestId("research-skill-assistant")).toHaveTextContent("研究 Skill 助手");
fireEvent.click(screen.getByRole("button", { name: "补充研究方向" }));
expect(onSnapshotChange).not.toHaveBeenCalled();
expect(screen.getByTestId("research-skill-suggestion")).toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "应用建议" }));
expect(onSnapshotChange).toHaveBeenCalledTimes(1);
fireEvent.click(screen.getByRole("button", { name: "撤销上次应用" }));
expect(onSnapshotChange).toHaveBeenLastCalledWith(directionSnapshot);
```

Verify Enter sends non-empty input, empty input disables send, and the footer contains `演示 Skill · 不作为真实研究证据`.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
pnpm --filter web exec vitest run tests/guided-research-skill-state.test.ts tests/ui/guided-research-skill-assistant.test.tsx
```

Expected: FAIL because the Skill modules do not exist.

- [ ] **Step 4: Implement the typed state transformer**

Use this discriminated shape so apply/undo never casts one editor into another:

```ts
export type ResearchEditableSnapshot =
  | { step: "brief"; value: GuidedResearchBrief }
  | { step: "directions"; value: GuidedResearchDirection[] }
  | { step: "outline"; value: GuidedResearchOutlineSection[] }
  | { step: "search"; value: GuidedResearchDemoState }
  | { step: "report"; value: Pick<GuidedResearchDemoState, "reportSummary"> };

export interface ResearchSkillState {
  version: 1;
  messages: Array<{ id: string; role: "user" | "skill"; text: string }>;
  pendingSuggestion: ResearchSkillSuggestion | null;
  undoSnapshot: ResearchEditableSnapshot | null;
}
```

Persist under `wsx.guidedResearch.skill.v1.<sessionKey>`. Use deterministic ids derived from message count rather than timestamps so tests and refreshes are stable.

- [ ] **Step 5: Implement the assistant and responsive layout**

Render step-specific quick prompts, message history, suggestion card, explicit apply, undo, input/send, and the demo disclaimer. Give `GuidedResearchStepLayout` this exact public shape:

```tsx
export function GuidedResearchStepLayout({
  assistant,
  children,
}: {
  assistant: React.ReactNode;
  children: React.ReactNode;
})
```

Its desktop body must use:

```tsx
<div className="grid min-w-0 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
  <aside className="min-w-0">{assistant}</aside>
  <main className="min-w-0">{children}</main>
</div>
```

On smaller screens, make the assistant a `<details>` disclosure labeled `研究 Skill 助手`; on `lg`, render the sticky panel open without forcing horizontal overflow.

- [ ] **Step 6: Run tests, design lint, and commit**

```bash
pnpm --filter web exec vitest run tests/guided-research-skill-state.test.ts tests/ui/guided-research-skill-assistant.test.tsx
pnpm --filter web run typecheck
cd apps/web && ./scripts/lint-design.sh
git add apps/web/lib/guided-research-skill-state.ts apps/web/components/research-studio/guided-research-skill-assistant.tsx apps/web/components/research-studio/guided-research-step-layout.tsx apps/web/tests/guided-research-skill-state.test.ts apps/web/tests/ui/guided-research-skill-assistant.test.tsx
git commit -m "feat(research): add contextual skill assistant"
```

### Task 4: Wire Skill Editing and Sequential Navigation into Existing Checkpoints

**Files:**
- Modify: `apps/web/components/research-studio/guided-research-flow.tsx`
- Modify: `apps/web/tests/ui/guided-research-checkpoints-live.test.tsx`
- Modify: `apps/web/tests/ui/guided-research-flow.test.tsx`

**Interfaces:**
- Consumes: `clampGuidedResearchStep`, `maxGuidedResearchStep`, `GuidedResearchStepLayout`, and `GuidedResearchSkillAssistant`.
- Guarantees: loading a session respects the requested completed step but clamps a future step to the server maximum.
- Guarantees: each brief/directions/outline editor passes its live controlled snapshot to the Skill and receives transformed content back.

- [ ] **Step 1: Add failing navigation and editor-integration tests**

Cover these cases in UI tests:

```ts
getGuidedResearchSession.mockResolvedValue(sessionAt("outline"));
render(<GuidedResearchFlow step="report" sessionId="grs-1" />);
expect(await screen.findByTestId("research-flow-outline")).toBeInTheDocument();
expect(screen.getByRole("button", { name: /资料研究/ })).toBeDisabled();

render(<GuidedResearchFlow step="directions" sessionId="grs-1" />);
fireEvent.click(await screen.findByRole("button", { name: "补充研究方向" }));
fireEvent.click(screen.getByRole("button", { name: "应用建议" }));
expect(screen.getAllByTestId(/^research-direction-title-/)).toHaveLength(2);
```

Update the outline confirmation mock to return `stage: "researching", resumeStage: "researching"` and retain the existing assertion that navigation enters `search` only after confirmation resolves.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter web exec vitest run tests/ui/guided-research-flow.test.tsx tests/ui/guided-research-checkpoints-live.test.tsx
```

Expected: future navigation is not clamped via the pure gate, progress is not clickable/locked, and no assistant modifies the editor.

- [ ] **Step 3: Replace latest-stage forcing with requested-step clamping**

When a session loads, compute:

```ts
const allowedStep = clampGuidedResearchStep(step, session);
setRestoredStep(allowedStep);
setSessionSnapshot(session);
```

Pass `maxStep={maxGuidedResearchStep(sessionSnapshot)}` and `onNavigate={navigate}` to `FlowProgress`. Render each progress item as a button; disable only indices greater than `maxStep`; use `aria-current="step"` for the current item and a visible lock icon for future items.

- [ ] **Step 4: Compose each editable checkpoint with its contextual Skill**

Pass the existing controlled values and setters through snapshots:

```tsx
<GuidedResearchStepLayout
  assistant={
    <GuidedResearchSkillAssistant
      step="directions"
      sessionKey={sessionId}
      snapshot={{ step: "directions", value: directions }}
      onSnapshotChange={(next) => {
        if (next.step === "directions") setDirections(next.value);
      }}
    />
  }
>
  {progress}
  {directionEditor}
</GuidedResearchStepLayout>
```

Use `sessionKey="pending-brief"` before creation. After create succeeds, the persisted research values live in the session; do not copy the pending Skill conversation into research evidence.

- [ ] **Step 5: Run focused tests and commit**

```bash
pnpm --filter web exec vitest run tests/ui/guided-research-flow.test.tsx tests/ui/guided-research-checkpoints-live.test.tsx tests/ui/guided-research-skill-assistant.test.tsx
pnpm --filter web run typecheck
git add apps/web/components/research-studio/guided-research-flow.tsx apps/web/tests/ui/guided-research-flow.test.tsx apps/web/tests/ui/guided-research-checkpoints-live.test.tsx
git commit -m "feat(research): gate and assist guided checkpoints"
```

### Task 5: Complete Demo Search and Report Journey

**Files:**
- Modify: `apps/web/components/research-studio/guided-research-flow.tsx`
- Modify: `apps/web/tests/ui/guided-research-flow.test.tsx`
- Modify: `apps/web/tests/ui/guided-research-home-live.test.tsx`

**Interfaces:**
- Consumes: demo state helpers, Skill assistant, `finishGuidedResearchCollection`, and `completeGuidedResearchSession`.
- Guarantees: search completion persists server stage `report`; report completion persists server status `completed`; failures do not unlock or navigate.

- [ ] **Step 1: Write the failing complete-journey test**

Mock the lifecycle helpers and drive the visible controls:

```ts
render(<GuidedResearchFlow step="search" sessionId="grs-1" />);
for (const task of screen.getAllByRole("button", { name: /完成演示检索/ })) {
  fireEvent.click(task);
}
fireEvent.click(screen.getByRole("button", { name: "生成演示研究报告" }));
await waitFor(() => expect(finishGuidedResearchCollection).toHaveBeenCalledWith("grs-1", {
  sourceCount: expect.any(Number),
}));
expect(onStepChange).toHaveBeenCalledWith("report", "grs-1");

fireEvent.click(screen.getByRole("button", { name: "完成研究" }));
await waitFor(() => expect(completeGuidedResearchSession).toHaveBeenCalledWith("grs-1"));
expect(screen.getByText("研究已完成")).toBeInTheDocument();
```

Add failure assertions: rejected lifecycle promises retain the current page, show a retry message, and never call `onStepChange`.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter web exec vitest run tests/ui/guided-research-flow.test.tsx tests/ui/guided-research-home-live.test.tsx
```

Expected: FAIL because search tasks are static and report completion is not wired.

- [ ] **Step 3: Convert SearchScreen to deterministic controlled demo state**

Load state by session id, render one action per incomplete task, persist after every action/decision, and show the exact warning `演示检索结果，不代表真实 Web Search` near the heading. Enable `生成演示研究报告` only when every fixture task is completed. On click, call `finishGuidedResearchCollection(sessionId, { sourceCount: acceptedSourceCount })`; update `sessionSnapshot`; navigate only after success.

- [ ] **Step 4: Convert ReportScreen to a completable demo report**

Build the report from the confirmed session brief, latest confirmed outline, deterministic citations, and `demoState.reportSummary`. Show `演示报告，不作为真实研究结论`. Apply report Skill suggestions only to `reportSummary`. On `完成研究`, call `completeGuidedResearchSession`, show `研究已完成`, retain links to `返回资料研究` and `返回研究首页`, and do not erase the report state.

- [ ] **Step 5: Update home semantics**

Use `item.status === "completed"` rather than `item.stage === "report"` for the `已完成` badge and `查看报告` action. A report-stage active item remains `待继续` and opens the report; a completed item opens the same report with completed presentation.

- [ ] **Step 6: Run focused tests and commit**

```bash
pnpm --filter web exec vitest run tests/guided-research-demo-state.test.ts tests/ui/guided-research-flow.test.tsx tests/ui/guided-research-home-live.test.tsx
pnpm --filter web run typecheck
git add apps/web/components/research-studio/guided-research-flow.tsx apps/web/tests/ui/guided-research-flow.test.tsx apps/web/tests/ui/guided-research-home-live.test.tsx
git commit -m "feat(research): complete demo search report journey"
```

### Task 6: Lock Visual Fidelity and Run Feature Verification

**Files:**
- Modify: `apps/web/tests/ui/guided-research-visual-contract.test.tsx`
- Modify: `apps/web/tests/research-rewrite.test.ts`
- Modify: `phases/phase-01-run-a-project/requirements/24-research/uc-24-6-引导式深度研究与完整报告.md`
- Modify: `phases/phase-01-run-a-project/feature_list.json`

**Interfaces:**
- Consumes: all preceding UI and lifecycle behavior.
- Produces: executable acceptance evidence for F180 without marking the feature `passing` manually.

- [ ] **Step 1: Add visual-contract assertions**

Assert that non-home steps contain `research-skill-assistant` and `research-step-main`, the old Studio submenu labels are absent, future progress buttons are disabled, and rendered markup contains both demo disclaimers. Keep the existing desktop width assertions and require the layout root to expose `data-layout="skill-workspace"`; assert that exact attribute instead of coupling the test to Tailwind class serialization.

- [ ] **Step 2: Record the approved requirement without changing signoff status**

Add a new R11 section describing the contextual Skill, explicit apply/undo, sequential server-stage gate, demo search/report labels, and completed-home behavior. Extend F180 `user_visible_behavior` and verification commands to include the new Skill/state tests. Do not edit a human signoff `status` field and do not hand-edit the generated sprint `active-features.json`. After changing the authoritative feature, regenerate the derived view through the existing claim command:

```bash
pnpm harness claim --phase 01 --feature F180 --owner coord-deep-research
```

- [ ] **Step 3: Run the complete F180 verification set**

```bash
pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-session-list-and-recovery.test.ts
pnpm --filter web exec vitest run tests/guided-research-stage.test.ts tests/guided-research-demo-state.test.ts tests/guided-research-skill-state.test.ts
pnpm --filter web exec vitest run tests/ui/guided-research-skill-assistant.test.tsx tests/ui/guided-research-visual-contract.test.tsx tests/ui/guided-research-flow.test.tsx tests/ui/guided-research-home-live.test.tsx tests/ui/guided-research-checkpoints-live.test.tsx
pnpm --filter web exec vitest run tests/research-rewrite.test.ts
pnpm --filter api run typecheck
pnpm --filter web run typecheck
node .harness/scripts/lint-permission-paths.mjs
node .harness/scripts/lint-arch-deps.mjs
node .harness/scripts/lint-ui-material.mjs
cd apps/web && ./scripts/lint-design.sh
```

Expected: every command exits 0; no test calls real Web Search or claims demo fixtures are evidence.

- [ ] **Step 4: Inspect the live local journey at two desktop widths**

With the existing local API/Web stack, log in and verify at 1280px and 1920px:

1. Create research with a required name and optional tags.
2. Apply and undo one Skill suggestion at brief, directions, and outline.
3. Confirm each step and verify the next step alone unlocks.
4. Refresh on search and verify recovery stays on search.
5. Complete all demo search tasks, generate the demo report, and complete research.
6. Return home and verify the card says `已完成` with `查看报告`.
7. Capture screenshots that show the left Skill panel, right main workflow, and visible demo disclaimers.

- [ ] **Step 5: Commit documentation and verification updates**

```bash
git add apps/web/tests/ui/guided-research-visual-contract.test.tsx apps/web/tests/research-rewrite.test.ts phases/phase-01-run-a-project/requirements/24-research/uc-24-6-引导式深度研究与完整报告.md phases/phase-01-run-a-project/feature_list.json
git commit -m "test(research): verify skill guided completion flow"
```

- [ ] **Step 6: Run harness verification only after evidence is recorded**

```bash
pnpm harness verify --sprint 01/08
pnpm harness doctor --phase 01
git status --short
```

Expected: harness verification controls the state transition; the agent does not edit `status: "passing"` directly. Any remaining dirty files are identified as pre-existing or intentionally included before creating the PR.
