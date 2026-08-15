# Guided Research LangGraph Foundation + Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first vertical slice of Guided Research in which a user creates or restores a research session, edits the complete Brief node state, confirms it through a persistent TypeScript LangGraph thread, and advances to Directions without a route refresh.

**Architecture:** A NestJS workflow application service owns a five-node `StateGraph`; this first slice implements the shared state schema and the Brief interrupt only. `PostgresSaver` persists checkpoints under stable `thread_id = sessionId`, while idempotent PostgreSQL effects persist product-readable node receipts and existing session projections. The Web submits a complete `BriefNodeState` through one Node Command and renders the hydrated workflow projection on a canonical `/research?session=<id>` URL.

**Tech Stack:** TypeScript 5.6, NestJS 10, Zod 3, PostgreSQL/RLS, `@langchain/core@0.3.80`, `@langchain/langgraph@0.4.9`, `@langchain/langgraph-checkpoint-postgres@0.1.2`, React 18, Vitest 2.

## Global Constraints

- Do not claim or implement the new slice while F180 remains `in_progress` for owner `coord-deep-research`; repair that control-plane state through `pnpm harness verify`, never by editing status manually.
- Do not change `contracts/research/design-signoff.md` status as an agent. Runtime implementation starts only after the updated bundle is human-confirmed and phase coherence is rechecked.
- One feature, one issue, one branch, one PR. This plan does not include Directions generation, Outline generation, real Web Search, or Report generation.
- Every Brief write call includes the complete `BriefNodeState`, `requestId`, and `expectedGraphVersion`.
- `thread_id` is exactly `sessionId`; `checkpoint_ns` is exactly `guided-research:v1`.
- LangGraph controls `currentNode`, `graphVersion`, failure and recovery state. The browser may not set server-owned workflow fields.
- The page uses `/research?session=<sessionId>` after creation. Step navigation must not use `flow=` or remount the whole page.
- No business state is restored from localStorage. Existing create-intent idempotency storage may remain until its replacement slice, but it cannot override server workflow state.
- Checkpoints hold logical node state. Large future source/report payloads use stable content IDs; this slice introduces no source/report persistence.
- All database tests run through `.harness/scripts/with-test-isolation.ts`; no shared-database Vitest command is acceptable evidence.
- No new production source file may exceed 2,000 lines. Keep graph state, nodes, effects, runtime, and controller adaptation in separate files.

---

## File Structure

### Requirements and contract governance

- Modify `phases/phase-01-run-a-project/requirements/24-research/uc-24-6-引导式深度研究与完整报告.md` — add the confirmed LangGraph/node-state requirement anchor.
- Modify `phases/phase-01-run-a-project/contracts/research/ui.md` — record the single-route, one-third Skill/two-thirds workspace behavior.
- Modify `phases/phase-01-run-a-project/contracts/research/usecases.md` — define workflow read and node execution application operations.
- Modify `phases/phase-01-run-a-project/contracts/research/coverage.md` — map the new requirement to contract and planned verification.
- Modify `phases/phase-01-run-a-project/feature_list.json` — add the missing Graph Foundation + Brief vertical feature after resolving F180.

### Shared contract

- Modify `packages/contracts/src/research.ts` — add node, node-state, command, projection, and error schemas.
- Modify `packages/contracts/tests/guided-research-session-contract.test.ts` — assert complete-state input, closed errors, and strict response parsing.

### API application and infrastructure

- Create `apps/api/src/application/research/workflow/guided-research-state.ts` — LangGraph annotation and initial-state builder.
- Create `apps/api/src/application/research/workflow/guided-research-effects.port.ts` — idempotent product-write port.
- Create `apps/api/src/application/research/workflow/guided-research-runtime.port.ts` — workflow read/execute port.
- Modify `apps/api/src/application/research/guided-session-ports.ts` — allow session creation before Brief confirmation and preserve the draft.
- Create `apps/api/src/application/research/workflow/guided-research-nodes.ts` — Brief interrupt and validation node.
- Create `apps/api/src/application/research/workflow/guided-research-graph.ts` — five-node graph topology with only Brief enabled in this slice.
- Create `apps/api/src/infrastructure/research/workflow/pg-guided-research-effects.ts` — row lock, receipt, Brief version and projection writes.
- Create `apps/api/src/infrastructure/research/workflow/langgraph-guided-research-runtime.ts` — `PostgresSaver` config and graph invocation.
- Modify `apps/api/src/infrastructure/research/pg-guided-research-session-repository.ts` — create at Brief with an unconfirmed server draft.
- Create `apps/api/migrations/20260815130000_f188_guided_research_langgraph_foundation.sql` — controlled checkpointer setup boundary, graph metadata, node receipts and initial backfill marker.
- Modify `apps/api/src/interface/controllers/guided-research.controller.ts` — add workflow GET and node POST adapters; preserve old endpoints as compatibility adapters.
- Modify `apps/api/src/kernel.module.ts` — wire effects/runtime providers in the composition root.
- Modify `apps/api/package.json` and `pnpm-lock.yaml` — add the three pinned LangGraph dependencies.

### API tests

- Create `apps/api/tests/research/guided-research-langgraph-brief.test.ts` — real PostgreSQL/checkpointer restart, idempotency, stale version, RLS and backfill tests.
- Create `apps/api/tests/research/guided-research-graph-unit.test.ts` — graph state and node routing without network or database.

### Web

- Modify `apps/web/lib/guided-research-api.ts` — workflow read and node execution client.
- Create `apps/web/lib/guided-research-workflow-state.ts` — projection-to-UI mapping and dirty-state reducer.
- Modify `apps/web/components/research-studio/research-studio-app.tsx` — canonical session route and compatibility parsing.
- Modify `apps/web/components/research-studio/guided-research-flow.tsx` — projection-driven active node and complete Brief command.
- Modify `apps/web/lib/guided-research-stage.ts` — consume `availableNodes` instead of deriving the maximum step from SQL stage.
- Create `apps/web/tests/guided-research-workflow-state.test.ts` — reducer and stale-response tests.
- Create `apps/web/tests/ui/guided-research-langgraph-brief.test.tsx` — single-page create/restore/confirm behavior and complete request body assertion.

---

### Task 1: Record the requirement and open the design-signoff checkpoint

**Files:**
- Modify: `phases/phase-01-run-a-project/requirements/24-research/uc-24-6-引导式深度研究与完整报告.md`
- Modify: `phases/phase-01-run-a-project/contracts/research/ui.md`
- Modify: `phases/phase-01-run-a-project/contracts/research/usecases.md`
- Modify: `phases/phase-01-run-a-project/contracts/research/coverage.md`
- Modify: `phases/phase-01-run-a-project/feature_list.json`

**Interfaces:**
- Consumes: approved design `docs/superpowers/specs/2026-08-15-guided-research-langgraph-persistence-design.md`.
- Produces: a parseable requirement anchor `#R12`, one Graph Foundation + Brief feature four-tuple, and updated Research bundle artifacts ready for human signoff.

- [ ] **Step 1: Repair the existing F180 control-plane state**

Run the authoritative gate from a clean latest-main branch:

```bash
pnpm harness verify --sprint 01/08
```

Expected: all F180 verification commands exit 0, evidence is refreshed, and the harness—not a manual edit—moves F180 out of `in_progress`. If a known unrelated baseline fails, fix or separately register that baseline; do not start the new feature while F180 remains active for the same owner.

- [ ] **Step 2: Add the confirmed R12 requirement**

Append an `## R12 LangGraph 节点状态与单页恢复` section containing these normative rules:

```markdown
## R12 LangGraph 节点状态与单页恢复

- Brief、Directions、Outline、Research、Report 分别是同一研究 LangGraph thread 的五个节点。
- 每次节点写调用必须提交当前前端节点的完整状态、requestId 与 expectedGraphVersion。
- 服务端 LangGraph checkpoint 是 currentNode、版本、失败、重试与恢复位置的权威来源。
- `/research?session=<sessionId>` 是会话 canonical URL；步骤切换不得依赖 flow 查询参数或整页刷新。
- 刷新、API 重启或节点失败后恢复同一 thread；localStorage 不得作为业务状态恢复来源。
```

- [ ] **Step 3: Add the missing F188 feature four-tuple**

The approved-plan baseline `af0b7d20` has maximum feature ID F187, so reserve F188 for this slice. Before editing, fetch `origin/main` and verify F188 is still unused; if it has been claimed upstream, stop and amend this committed plan before proceeding. Use this exact four-tuple:

```json
{
  "id": "F188",
  "title": "LangGraph 研究状态基础与 Brief 节点：完整状态提交、checkpoint 恢复和单页推进",
  "user_visible_behavior": "用户创建或打开研究时，页面从同一 LangGraph thread 恢复 Brief 完整状态；确认 Brief 后解锁 Directions，刷新或 API 重启不丢失节点和版本。步骤推进保持在 /research?session=<id>，不会因 flow 路由切换整页刷新；过期版本和重复请求不会覆盖新状态或创建重复 checkpoint。",
  "spec_ref": "24-research/uc-24-6-引导式深度研究与完整报告.md#R12",
  "depends_on": ["F180"],
  "points": 8,
  "status": "not_started",
  "owner": null,
  "verification": [
    "pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts",
    "pnpm --filter api exec vitest run tests/research/guided-research-graph-unit.test.ts",
    "pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-research-langgraph-brief.test.ts",
    "pnpm --filter web exec vitest run tests/guided-research-workflow-state.test.ts tests/ui/guided-research-langgraph-brief.test.tsx",
    "pnpm --filter web run typecheck",
    "node apps/api/scripts/lint-permission-paths.mjs",
    "node .harness/scripts/lint-arch-deps.mjs"
  ],
  "evidence": "",
  "notes": "First vertical slice of the approved 2026-08-15 Guided Research LangGraph design. Shared hotspots: research contract, controller, kernel composition root, guided-research-flow, migration and lockfile. Must merge before Directions, Outline, F170 or F171 work.",
  "priority": 1,
  "area": "deep-research",
  "capability": "CAP-WEB",
  "sprint": null
}
```

Create Sprint 10 and the public issue through the harness after the four-tuple validates:

```bash
pnpm harness new-sprint --phase 01 --id 10 --goal "LangGraph Research 基础与 Brief 持久化" --features F188
pnpm harness sync --phase 01 --apply
```

- [ ] **Step 4: Update bundle artifacts without changing human status**

Add the new feature ID to coverage and `covers`, document the single-route UI and the two application operations `GetGuidedResearchWorkflow` and `ExecuteGuidedResearchNode`. Do not edit `status`, `confirmed_by`, or `confirmed_at` in `design-signoff.md`.

- [ ] **Step 5: Run contract-design static checks**

Run:

```bash
node .harness/scripts/lint-third-artifact.mjs
node .harness/scripts/lint-ui-material.mjs
pnpm harness doctor --phase 01
```

Expected: no new missing-requirement, missing-coverage, or malformed-spec-ref failure for the new feature. Historical unrelated failures must be recorded verbatim rather than hidden.

- [ ] **Step 6: Pause for human bundle confirmation**

Present the updated UI/use-case/API artifacts and request that the human reviewer update the Research bundle signoff and coherence record. Runtime tasks below remain blocked until that human-authored confirmation exists.

- [ ] **Step 7: Commit the governance delta**

```bash
git add phases/phase-01-run-a-project/requirements/24-research \
  phases/phase-01-run-a-project/contracts/research \
  phases/phase-01-run-a-project/feature_list.json
git commit -m "docs(research): define langgraph brief slice"
```

### Task 2: Define the strict workflow contract

**Files:**
- Modify: `packages/contracts/src/research.ts`
- Modify: `packages/contracts/tests/guided-research-session-contract.test.ts`

**Interfaces:**
- Consumes: R12 and the approved Graph Foundation + Brief feature.
- Produces: `ResearchNode`, `BriefNodeState`, `GuidedResearchWorkflowProjection`, `ExecuteGuidedResearchNodeInput`, `getGuidedResearchWorkflow`, and `executeGuidedResearchNode` schemas.

- [ ] **Step 1: Write failing contract tests**

Add tests that parse this valid command and reject a partial `nodeState`:

```ts
const validBriefCommand = {
  sessionId: "grs_contract",
  node: "brief",
  action: "confirm",
  requestId: "req_contract_1",
  expectedGraphVersion: 1,
  nodeState: {
    status: "editing",
    version: 1,
    confirmedVersion: null,
    contentVersionId: null,
    confirmedAt: null,
    updatedAt: "2026-08-15T00:00:00.000Z",
    errorCode: null,
    name: "欧洲储能进入研究",
    tags: ["欧洲", "储能"],
    topic: "欧洲储能市场进入策略",
    goal: "确定首批进入国家与进入方式",
    timeRange: "2025-2028",
    region: "欧洲",
    focus: "市场、政策、并网与竞争格局",
  },
};

expect(research.ExecuteGuidedResearchNodeInput.parse(validBriefCommand)).toEqual(validBriefCommand);
expect(() => research.ExecuteGuidedResearchNodeInput.parse({
  ...validBriefCommand,
  nodeState: { topic: "只有主题" },
})).toThrow();
```

Also assert that `RESEARCH_GRAPH_VERSION_CONFLICT`, `RESEARCH_NODE_STATE_INVALID`, `RESEARCH_NODE_LOCKED`, `RESEARCH_NODE_MISMATCH`, and `RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH` appear in the closed `ResearchError` and operation error schemas.

Add a creation counterexample: `{ title, tags, idempotencyKey, collaboratorUserIds }` without `brief` parses, and creation output may represent `stage: "brief"` with `briefConfirmedAt: null`. An old request carrying `brief` still parses as a draft for compatibility.

- [ ] **Step 2: Run the contract test and observe RED**

```bash
pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts
```

Expected: FAIL because the workflow schemas and operations do not exist.

- [ ] **Step 3: Implement strict Zod schemas**

Add exact schemas with `.strict()` at every HTTP object boundary. Keep existing `goal` and `region` names; do not introduce aliases. The draft permits empty topic/goal so the newly created Brief checkpoint can be restored before confirmation, while `GuidedResearchBrief` remains the stricter confirmed schema:

```ts
export const ResearchNode = z.enum(["brief", "directions", "outline", "research", "report"]);
export const ResearchNodeStatus = z.enum(["locked", "editing", "ready", "running", "failed", "completed", "stale"]);

export const GuidedResearchBriefDraft = z.object({
  topic: z.string().trim().max(200),
  goal: z.string().trim().max(2000),
  timeRange: z.string().trim().max(200),
  region: z.string().trim().max(200),
  focus: z.string().trim().max(2000),
}).strict();

export const BriefNodeState = GuidedResearchBriefDraft.extend({
  status: ResearchNodeStatus,
  version: z.number().int().positive(),
  confirmedVersion: z.number().int().positive().nullable(),
  contentVersionId: z.string().min(1).nullable(),
  confirmedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  errorCode: z.string().min(1).nullable(),
  name: z.string().trim().min(1).max(100),
  tags: z.array(z.string().trim().min(1).max(20)).max(5),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.tags).size !== value.tags.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tags"], message: "duplicate tags" });
  }
});

export const ExecuteGuidedResearchNodeInput = z.object({
  sessionId: z.string().min(1),
  node: z.literal("brief"),
  action: z.enum(["save", "confirm"]),
  requestId: z.string().min(1),
  expectedGraphVersion: z.number().int().positive(),
  nodeState: BriefNodeState,
}).strict();
```

Define `GuidedResearchWorkflowProjection` with `sessionId`, `graphVersion`, `revision`, `currentNode`, `availableNodes`, `nodeSummaries`, `activeNodeState`, `skill`, and nullable `interrupt`. Register:

```ts
getGuidedResearchWorkflow: {
  method: "GET",
  path: "/research/guided-sessions/:sessionId/workflow",
  in: z.object({ sessionId: z.string().min(1) }).strict(),
  out: GuidedResearchWorkflowProjection,
  err: ResearchError,
},
executeGuidedResearchNode: {
  method: "POST",
  path: "/research/guided-sessions/:sessionId/workflow/nodes/:node",
  in: ExecuteGuidedResearchNodeInput,
  out: GuidedResearchWorkflowProjection,
  err: ResearchError,
},
```

- [ ] **Step 4: Run contract tests GREEN**

```bash
pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts
pnpm --filter @repo/contracts run typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Commit the contract**

```bash
git add packages/contracts/src/research.ts packages/contracts/tests/guided-research-session-contract.test.ts
git commit -m "feat(research): define workflow node contract"
```

### Task 3: Build the pure Graph State and Brief node

**Files:**
- Create: `apps/api/src/application/research/workflow/guided-research-state.ts`
- Create: `apps/api/src/application/research/workflow/guided-research-effects.port.ts`
- Create: `apps/api/src/application/research/workflow/guided-research-runtime.port.ts`
- Create: `apps/api/src/application/research/workflow/guided-research-nodes.ts`
- Create: `apps/api/src/application/research/workflow/guided-research-graph.ts`
- Create: `apps/api/tests/research/guided-research-graph-unit.test.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `BriefNodeState` and `GuidedResearchWorkflowProjection` from Task 2.
- Produces: `GuidedResearchGraphState`, `initialGuidedResearchState`, `GuidedResearchEffects`, `GuidedResearchRuntime`, and `createGuidedResearchGraph`.

- [ ] **Step 1: Add pinned dependencies**

```bash
pnpm --filter @repo/api add @langchain/core@0.3.80 @langchain/langgraph@0.4.9 @langchain/langgraph-checkpoint-postgres@0.1.2
```

Expected: only `apps/api/package.json` and `pnpm-lock.yaml` change.

- [ ] **Step 2: Write failing pure graph tests**

Test these properties without PostgreSQL:

```ts
it("initializes a new thread at the Brief interrupt", async () => {
  const result = initialGuidedResearchState(fixture);
  expect(result).toMatchObject({ currentNode: "brief", graphVersion: 1, revision: 1 });
  expect(result.brief).toEqual(fixture.brief);
});

it("rejects a stale graph version before applying Brief effects", async () => {
  await expect(runBriefCommand({ ...command, expectedGraphVersion: 0 }, state, effects))
    .rejects.toMatchObject({ code: "RESEARCH_GRAPH_VERSION_CONFLICT" });
  expect(effects.confirmBrief).not.toHaveBeenCalled();
});
```

Change `createGuidedResearchSession.in.brief` to `GuidedResearchBriefDraft.optional()` for compatibility. A new Web client omits it; an old client may still send a draft. Creation always returns `stage: "brief"`, `resumeStage: "brief"`, and `briefConfirmedAt: null`; the immediately following workflow GET returns `graphVersion: 1`. The Brief `confirm` action validates `nodeState` through the existing strict `GuidedResearchBrief` before running effects.

Also test that `save` stays at Brief, `confirm` advances to Directions, and a replayed receipt returns the same graph version instead of calling the effect twice.

- [ ] **Step 3: Run unit tests RED**

```bash
pnpm --filter api exec vitest run tests/research/guided-research-graph-unit.test.ts
```

Expected: FAIL on missing workflow modules.

- [ ] **Step 4: Implement state annotation and ports**

Use these signatures:

```ts
export interface GuidedResearchGraphState {
  sessionId: string;
  orgId: string;
  ownerUserId: string;
  currentNode: "brief" | "directions" | "outline" | "research" | "report";
  graphVersion: number;
  revision: number;
  brief: BriefNodeState;
  lastOperationId: string | null;
  lastRequestId: string | null;
  lastCompletedNode: "brief" | "directions" | "outline" | "research" | "report" | null;
  failedNode: "brief" | "directions" | "outline" | "research" | "report" | null;
  failureCode: string | null;
  command: ExecuteGuidedResearchNodeInput | null;
}

export interface GuidedResearchEffects {
  applyBrief(input: {
    orgId: string;
    actorId: string;
    sessionId: string;
    operationId: string;
    requestId: string;
    expectedGraphVersion: number;
    action: "save" | "confirm";
  nodeState: BriefNodeState;
  }): Promise<{ graphVersion: number; revision: number; brief: BriefNodeState; replayed: boolean }>;
}
```

- [ ] **Step 5: Implement the Brief interrupt and graph topology**

The node must call `interrupt()` before any effect:

```ts
export function createBriefNode(effects: GuidedResearchEffects) {
  return async (state: GuidedResearchGraphState) => {
    const command = interrupt({
      node: "brief",
      graphVersion: state.graphVersion,
      allowedActions: ["save", "confirm"],
    }) as ExecuteGuidedResearchNodeInput;
    const result = await effects.applyBrief({
      orgId: state.orgId,
      actorId: state.ownerUserId,
      sessionId: state.sessionId,
      operationId: `${state.sessionId}:brief:${command.action}:${state.graphVersion}:${command.requestId}`,
      requestId: command.requestId,
      expectedGraphVersion: command.expectedGraphVersion,
      action: command.action,
      nodeState: command.nodeState,
    });
    return {
      brief: result.brief,
      graphVersion: result.graphVersion,
      revision: result.revision,
      lastOperationId: `${state.sessionId}:brief:${command.action}:${state.graphVersion}:${command.requestId}`,
      lastRequestId: command.requestId,
      lastCompletedNode: command.action === "confirm" ? "brief" : state.lastCompletedNode,
      currentNode: command.action === "confirm" ? "directions" : "brief",
      command: null,
    };
  };
}
```

Compile the graph with stable node names `brief`, `directions`, `outline`, `research`, `report`. Directions and later nodes return a locked projection in this slice; do not implement their effects.

- [ ] **Step 6: Run pure graph tests GREEN**

```bash
pnpm --filter api exec vitest run tests/research/guided-research-graph-unit.test.ts
pnpm --filter api run typecheck
```

Expected: graph tests pass and no workflow type error appears.

- [ ] **Step 7: Commit graph application code**

```bash
git add apps/api/package.json pnpm-lock.yaml \
  apps/api/src/application/research/workflow \
  apps/api/tests/research/guided-research-graph-unit.test.ts
git commit -m "feat(research): add langgraph brief state"
```

### Task 4: Add PostgreSQL checkpointer boundaries and idempotent Brief effects

**Files:**
- Create: `apps/api/migrations/20260815130000_f188_guided_research_langgraph_foundation.sql`
- Create: `apps/api/src/infrastructure/research/workflow/pg-guided-research-effects.ts`
- Modify: `apps/api/src/application/research/guided-session-ports.ts`
- Modify: `apps/api/src/infrastructure/research/pg-guided-research-session-repository.ts`
- Create: `apps/api/tests/research/guided-research-langgraph-brief.test.ts`
- Modify: `apps/api/tests/research/guided-session-list-and-recovery.test.ts`

**Interfaces:**
- Consumes: `GuidedResearchEffects.applyBrief` from Task 3 and existing tenant-aware `DatabasePort`.
- Produces: RLS-protected receipt storage and deterministic Brief save/confirm results.

- [ ] **Step 1: Verify the reserved migration timestamp is collision-free**

```bash
ls apps/api/migrations | sort | tail -20
```

Expected: `20260815130000_f188_guided_research_langgraph_foundation.sql` does not exist and its timestamp is later than the current latest `20260815100000_f157_agent_run_context_snapshots.sql`. If upstream has claimed the timestamp, stop and amend this committed plan before creating a migration.

- [ ] **Step 2: Write failing API/DB tests**

Cover:

```ts
it("persists the full Brief command and resumes it after app restart", async () => {
  const created = await createSession();
  const confirmed = await executeBrief(created.sessionId, {
    requestId: "brief-confirm-1",
    expectedGraphVersion: 1,
    nodeState: completeBriefState,
  });
  expect(confirmed).toMatchObject({ currentNode: "directions", graphVersion: 2 });
  await restartApp();
  expect(await getWorkflow(created.sessionId)).toMatchObject({
    currentNode: "directions",
    graphVersion: 2,
    activeNodeState: expect.objectContaining({ status: "editing" }),
  });
});
```

First assert that creation without a Brief returns `stage: "brief"`, `resumeStage: "brief"`, progress 0 and `briefConfirmedAt: null`; a workflow GET then returns the same session at `currentNode: "brief"`, `graphVersion: 1`. Add counterexamples for same request/different state, stale graphVersion, cross-org access, receipt replay, and failure between the business receipt and checkpoint write.

- [ ] **Step 3: Run isolated test RED**

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter api exec vitest run tests/research/guided-research-langgraph-brief.test.ts
```

Expected: FAIL because migration/effects/runtime do not exist.

- [ ] **Step 4: Create product tables and RLS**

The migration must create a receipt table with a tenant-safe key:

```sql
CREATE TABLE guided_research_node_receipts (
  org_id text NOT NULL,
  session_id text NOT NULL,
  operation_id text NOT NULL,
  request_id text NOT NULL,
  node text NOT NULL CHECK (node IN ('brief','directions','outline','research','report')),
  action text NOT NULL,
  graph_version integer NOT NULL CHECK (graph_version > 0),
  payload_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, session_id, operation_id),
  FOREIGN KEY (session_id, org_id)
    REFERENCES guided_research_sessions (id, org_id) ON DELETE CASCADE
);
```

Add `graph_version`, `graph_revision`, and `workflow_initialized_at` to `guided_research_sessions`. Enable and force RLS on receipts with `current_setting('app.current_org', true)`. Grant only the required columns/actions to `app_rw`.

Do not create LangGraph vendor tables by copying undocumented SQL. Add a controlled setup command that invokes `PostgresSaver.setup()` under the migration/admin role, while the normal application role receives only runtime DML permissions.

- [ ] **Step 5: Implement transactionally idempotent effects**

`applyBrief` must:

1. open `withTenant(orgId)`;
2. select the visible session `FOR UPDATE`;
3. compare graph version;
4. compute a canonical SHA-256 fingerprint over action + complete nodeState;
5. return an identical prior receipt or throw replay mismatch;
6. persist the complete Brief projection and increment graph version once;
7. insert the receipt in the same transaction.

Use database results, not client timestamps, for `updatedAt` and `confirmedAt`.

Update `GuidedResearchSessionRepository.create` so an omitted Brief becomes `{ topic: "", goal: "", timeRange: "", region: "", focus: "" }`; insert `stage = 'brief'`, `resume_stage = 'brief'`, `progress = 0`, and leave `brief_confirmed_at` null. The create replay fingerprint includes the normalized draft when supplied. Do not reuse the old migration backfill that marked every newly created Brief as confirmed.

- [ ] **Step 6: Run migration and isolated tests GREEN**

```bash
pnpm --filter api run migrate:check
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter api exec vitest run tests/research/guided-research-langgraph-brief.test.ts
node apps/api/scripts/lint-permission-paths.mjs
```

Expected: all commands exit 0; the permission lint reports the new tenant table as covered.

- [ ] **Step 7: Commit persistence**

```bash
git add apps/api/migrations apps/api/src/infrastructure/research/workflow \
  apps/api/src/application/research/guided-session-ports.ts \
  apps/api/src/infrastructure/research/pg-guided-research-session-repository.ts \
  apps/api/tests/research/guided-session-list-and-recovery.test.ts \
  apps/api/tests/research/guided-research-langgraph-brief.test.ts
git commit -m "feat(research): persist brief workflow effects"
```

### Task 5: Wire the persistent runtime and HTTP adapters

**Files:**
- Create: `apps/api/src/infrastructure/research/workflow/langgraph-guided-research-runtime.ts`
- Modify: `apps/api/src/interface/controllers/guided-research.controller.ts`
- Modify: `apps/api/src/kernel.module.ts`
- Modify: `apps/api/tests/research/guided-research-langgraph-brief.test.ts`

**Interfaces:**
- Consumes: graph factory from Task 3, effects from Task 4, and contract operations from Task 2.
- Produces: authorized `getWorkflow` and `executeNode` application/runtime operations reachable through HTTP.

- [ ] **Step 1: Extend failing tests through HTTP**

Use only contract paths and parsers:

```ts
const path = research.operations.executeGuidedResearchNode.path
  .replace(":sessionId", sessionId)
  .replace(":node", "brief");
const response = await fetch(`${base}${path}`, {
  method: "POST",
  headers: auth(OWNER),
  body: JSON.stringify(command),
});
expect(response.status).toBe(200);
expect(research.operations.executeGuidedResearchNode.out.parse(await response.json()))
  .toMatchObject({ currentNode: "directions", graphVersion: 2 });
```

Assert HTTP 409 mappings for version conflict/replay mismatch and the same 404 envelope for absent/cross-org sessions.

- [ ] **Step 2: Run isolated HTTP tests RED**

Run the exact isolated command from Task 4. Expected: 404 for missing workflow endpoints.

- [ ] **Step 3: Implement the runtime**

Expose:

```ts
export interface GuidedResearchRuntime {
  getWorkflow(input: { orgId: string; actorId: string; sessionId: string }): Promise<GuidedResearchWorkflowProjection | null>;
  executeNode(input: { orgId: string; actorId: string; command: ExecuteGuidedResearchNodeInput }): Promise<GuidedResearchWorkflowProjection | null>;
}
```

Before every `graph.getState` or `graph.invoke`, authorize through the visible business session repository. Invoke with:

```ts
const config = {
  configurable: {
    thread_id: input.sessionId,
    checkpoint_ns: "guided-research:v1",
  },
};
```

Initialize a missing checkpoint only for an existing visible session, using a deterministic backfill state. Resume Brief using `new Command({ resume: command })`.

- [ ] **Step 4: Add controller adapters and DI wiring**

The controller parses path + body through the contract, injects Principal-derived org/actor values, and maps typed application errors. It must not access PostgresSaver directly.

Register `GUIDED_RESEARCH_EFFECTS` and `GUIDED_RESEARCH_RUNTIME` providers in `kernel.module.ts`. Keep all infrastructure imports in the composition root.

- [ ] **Step 5: Run HTTP, architecture, and type checks GREEN**

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter api exec vitest run tests/research/guided-research-langgraph-brief.test.ts
pnpm --filter api run typecheck
node .harness/scripts/lint-arch-deps.mjs apps/api/src
```

Expected: all exit 0.

- [ ] **Step 6: Commit runtime wiring**

```bash
git add apps/api/src/infrastructure/research/workflow \
  apps/api/src/interface/controllers/guided-research.controller.ts \
  apps/api/src/kernel.module.ts \
  apps/api/tests/research/guided-research-langgraph-brief.test.ts
git commit -m "feat(research): expose persistent workflow runtime"
```

### Task 6: Add the Web workflow client and reducer

**Files:**
- Modify: `apps/web/lib/guided-research-api.ts`
- Create: `apps/web/lib/guided-research-workflow-state.ts`
- Create: `apps/web/tests/guided-research-workflow-state.test.ts`

**Interfaces:**
- Consumes: Task 2 contract operations.
- Produces: `getGuidedResearchWorkflow`, `executeGuidedResearchNode`, `GuidedResearchWorkflowViewState`, and `reduceWorkflowResponse`.

- [ ] **Step 1: Write reducer/client tests RED**

```ts
it("ignores an older workflow response", () => {
  const current = viewState({ graphVersion: 3, currentNode: "directions" });
  const stale = projection({ graphVersion: 2, currentNode: "brief" });
  expect(reduceWorkflowResponse(current, stale)).toBe(current);
});

it("builds a complete Brief command", () => {
  expect(buildBriefCommand(state, "confirm", "req-1")).toEqual({
    sessionId: state.sessionId,
    node: "brief",
    action: "confirm",
    requestId: "req-1",
    expectedGraphVersion: state.graphVersion,
    nodeState: state.draft,
  });
});
```

- [ ] **Step 2: Run Web state tests RED**

```bash
pnpm --filter web exec vitest run tests/guided-research-workflow-state.test.ts
```

Expected: FAIL because workflow state helpers do not exist.

- [ ] **Step 3: Implement parsed API calls**

Every request and response passes through contract schemas. Build the path by replacing both `:sessionId` and `:node`; do not hand-copy route strings.

```ts
export async function executeGuidedResearchNode(
  command: ExecuteGuidedResearchNodeInput,
): Promise<GuidedResearchWorkflowProjection> {
  const input = research.ExecuteGuidedResearchNodeInput.parse(command);
  const path = research.operations.executeGuidedResearchNode.path
    .replace(":sessionId", encodeURIComponent(input.sessionId))
    .replace(":node", input.node);
  const raw = await apiRequest<unknown>(path, { method: "POST", body: JSON.stringify(input) });
  return research.operations.executeGuidedResearchNode.out.parse(raw);
}
```

- [ ] **Step 4: Implement the reducer**

The reducer accepts only responses with `projection.graphVersion >= current.graphVersion`, replaces the confirmed server projection, and keeps a separate dirty Brief draft. A successful command replaces the draft with the hydrated server state and clears dirty state.

- [ ] **Step 5: Run state tests and typecheck GREEN**

```bash
pnpm --filter web exec vitest run tests/guided-research-workflow-state.test.ts
pnpm --filter web run typecheck
```

Expected: both exit 0.

- [ ] **Step 6: Commit the Web data layer**

```bash
git add apps/web/lib/guided-research-api.ts \
  apps/web/lib/guided-research-workflow-state.ts \
  apps/web/tests/guided-research-workflow-state.test.ts
git commit -m "feat(web): add guided workflow client state"
```

### Task 7: Convert Brief to a single-page persistent node

**Files:**
- Modify: `apps/web/components/research-studio/research-studio-app.tsx`
- Modify: `apps/web/components/research-studio/guided-research-flow.tsx`
- Modify: `apps/web/lib/guided-research-stage.ts`
- Create: `apps/web/tests/ui/guided-research-langgraph-brief.test.tsx`
- Modify: `apps/web/tests/ui/guided-research-flow.test.tsx`
- Modify: `apps/web/tests/ui/guided-research-checkpoints-live.test.tsx`

**Interfaces:**
- Consumes: workflow client/reducer from Task 6.
- Produces: canonical session URL, projection-driven progress, full-state Brief confirm, dirty navigation warning, and no route refresh.

- [ ] **Step 1: Write the UI integration test RED**

Render the real `GuidedResearchFlow`. Completing the create dialog must first POST only name, Tags, idempotency key and collaborators; assert it receives a session at Brief, loads workflow graphVersion 1, and canonicalizes the URL. Then edit every Brief field, confirm, and assert the node request:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  "/research/guided-sessions/grs_ui/workflow/nodes/brief",
  expect.objectContaining({
    method: "POST",
    body: JSON.stringify(expect.objectContaining({
      sessionId: "grs_ui",
      node: "brief",
      action: "confirm",
      expectedGraphVersion: 1,
      nodeState: expect.objectContaining({
        name: "欧洲储能进入研究",
        topic: "欧洲储能市场进入策略",
        goal: "确定首批进入国家与进入方式",
        timeRange: "2025-2028",
        region: "欧洲",
        focus: "市场、政策、并网与竞争格局",
      }),
    })),
  }),
);
```

Assert `window.location.search === "?session=grs_ui"`, `flow=` is absent, Directions renders without remounting the shell, and refresh uses workflow GET to restore Directions.

- [ ] **Step 2: Run UI tests RED**

```bash
pnpm --filter web exec vitest run tests/ui/guided-research-langgraph-brief.test.tsx
```

Expected: FAIL because current UI uses flow props and legacy endpoints.

- [ ] **Step 3: Create the session and Brief checkpoint from the naming dialog**

On dialog confirmation call `createGuidedResearchSession` immediately without a confirmed Brief. The server creates the session at `stage: "brief"`, initializes the LangGraph thread, and returns the workflow/session identifiers. Persist neither the default mock Brief nor an unconfirmed generated answer. Navigate to the canonical session URL and render the server-provided empty draft.

- [ ] **Step 4: Make `ResearchStudioApp` session-canonical**

Parse `session` as the durable identifier. Treat legacy `flow` only as a one-time compatibility hint when there is no workflow projection; after workflow load, call:

```ts
window.history.replaceState({}, "", `/research?session=${encodeURIComponent(sessionId)}`);
```

Do not call `router.push`, assign `window.location`, or use anchors for step navigation.

- [ ] **Step 5: Make `GuidedResearchFlow` projection-driven**

Replace `restoredStep`/`stageToStep` as the source of truth with `workflow.currentNode`. Progress availability reads `workflow.availableNodes`. Keep one mounted Skill assistant and one mounted right workspace; switching nodes changes rendered editor content inside the same tree.

- [ ] **Step 6: Submit complete Brief state**

Build one complete draft from controlled fields and call `executeGuidedResearchNode`. On 409, keep the local draft, display the conflict, and offer a reload action; never silently overwrite it with the server response.

- [ ] **Step 7: Add dirty-state navigation protection**

When the draft differs from the confirmed workflow state, intercept step/back/home actions with the existing dialog pattern and register `beforeunload`. Clear the guard only after a successful command or explicit discard.

- [ ] **Step 8: Run the focused UI suite GREEN**

```bash
pnpm --filter web exec vitest run \
  tests/guided-research-workflow-state.test.ts \
  tests/ui/guided-research-langgraph-brief.test.tsx \
  tests/ui/guided-research-flow.test.tsx \
  tests/ui/guided-research-checkpoints-live.test.tsx
pnpm --filter web run typecheck
```

Expected: all tests and typecheck exit 0.

- [ ] **Step 9: Mutation-check the no-refresh assertion**

Temporarily restore a `router.push`/`flow=` step change and rerun `guided-research-langgraph-brief.test.tsx`. Expected: the test fails on canonical URL or remount assertion. Revert the mutation and rerun GREEN before committing.

- [ ] **Step 10: Commit the UI slice**

```bash
git add apps/web/components/research-studio/research-studio-app.tsx \
  apps/web/components/research-studio/guided-research-flow.tsx \
  apps/web/lib/guided-research-stage.ts \
  apps/web/tests/ui/guided-research-langgraph-brief.test.tsx \
  apps/web/tests/ui/guided-research-flow.test.tsx \
  apps/web/tests/ui/guided-research-checkpoints-live.test.tsx
git commit -m "feat(web): persist brief through research graph"
```

### Task 8: Backfill existing sessions and preserve compatibility

**Files:**
- Modify: migration from Task 4
- Modify: `apps/api/src/infrastructure/research/workflow/langgraph-guided-research-runtime.ts`
- Modify: `apps/api/src/interface/controllers/guided-research.controller.ts`
- Modify: `apps/api/tests/research/guided-research-langgraph-brief.test.ts`
- Modify: `apps/api/tests/research/guided-session-list-and-recovery.test.ts`

**Interfaces:**
- Consumes: existing Guided Research session projection and new runtime.
- Produces: deterministic initial Graph State for pre-LangGraph sessions and old-endpoint compatibility during rollout.

- [ ] **Step 1: Add failing backfill tests**

Seed legacy rows at Brief/Directions/Outline/Researching/Report stages without a workflow checkpoint. Assert first workflow GET initializes exactly one thread, maps the old stage to `currentNode`, retains confirmed versions, and marks demo search/report as non-evidence.

- [ ] **Step 2: Run isolated compatibility tests RED**

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter api exec vitest run \
  tests/research/guided-research-langgraph-brief.test.ts \
  tests/research/guided-session-list-and-recovery.test.ts
```

Expected: the new legacy-row cases fail.

- [ ] **Step 3: Implement deterministic initialization**

Use session ID + persisted versions only; do not infer current node from card labels. Acquire the session row lock, check `workflow_initialized_at`, write one receipt, create the initial checkpoint, then mark initialization. Concurrent first reads return the same thread/version.

- [ ] **Step 4: Route old Brief endpoint through the runtime**

Convert the old `PUT /brief` payload to a complete server-hydrated Brief Node Command. Mark the adapter deprecated in code comments and contract notes. Do not maintain a second SQL state-transition implementation.

- [ ] **Step 5: Run compatibility suite GREEN**

Run the isolated command from Step 2. Expected: all tests pass with one initialized workflow per legacy session.

- [ ] **Step 6: Commit migration compatibility**

```bash
git add apps/api/migrations \
  apps/api/src/infrastructure/research/workflow/langgraph-guided-research-runtime.ts \
  apps/api/src/interface/controllers/guided-research.controller.ts \
  apps/api/tests/research/guided-research-langgraph-brief.test.ts \
  apps/api/tests/research/guided-session-list-and-recovery.test.ts
git commit -m "feat(research): backfill guided workflow threads"
```

### Task 9: Run the feature gate, record evidence, and prepare the PR

**Files:**
- Modify: `phases/phase-01-run-a-project/sprints/sprint-10/progress.md`
- Modify: `phases/phase-01-run-a-project/sprints/sprint-10/session-handoff.md`
- Generated by harness: `phases/phase-01-run-a-project/sprints/sprint-10/evidence/F188.verify.log`

**Interfaces:**
- Consumes: all previous tasks and the feature’s assigned sprint/ID created by harness.
- Produces: reproducible evidence, clean worktree, pushed branch, and one PR closing the feature issue.

- [ ] **Step 1: Run focused verification once**

```bash
pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts
pnpm --filter api exec vitest run tests/research/guided-research-graph-unit.test.ts
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter api exec vitest run tests/research/guided-research-langgraph-brief.test.ts
pnpm --filter web exec vitest run \
  tests/guided-research-workflow-state.test.ts \
  tests/ui/guided-research-langgraph-brief.test.tsx
```

Expected: all exit 0. Do not launch duplicate isolation stacks while one is queued.

- [ ] **Step 2: Run affected static gates**

```bash
pnpm --filter @repo/contracts run typecheck
pnpm --filter api run typecheck
pnpm --filter web run typecheck
pnpm --filter api run migrate:check
node apps/api/scripts/lint-permission-paths.mjs
node .harness/scripts/lint-arch-deps.mjs
bash apps/web/scripts/lint-design.sh
git diff --check
```

Expected: all exit 0. Any repository-wide baseline failure must identify the exact unrelated file and cannot be reported as feature success.

- [ ] **Step 3: Run the authoritative feature gate**

Use the actual sprint allocated to the new feature:

```bash
pnpm harness verify --sprint 01/10
```

Expected: harness executes the registered verification, writes non-empty evidence, and moves only the target feature to `passing`.

- [ ] **Step 4: Verify evidence is committed data**

```bash
git add phases/phase-01-run-a-project/sprints/sprint-10
git commit -m "test(research): record langgraph brief verification"
git cat-file -e HEAD:phases/phase-01-run-a-project/sprints/sprint-10/evidence/F188.verify.log
```

Expected: `git cat-file` exits 0.

- [ ] **Step 5: Self-review the exact diff**

```bash
git diff --check origin/main...HEAD
git status --short
git log --oneline origin/main..HEAD
```

Expected: no diff-check error, clean worktree, and only commits belonging to this feature.

- [ ] **Step 6: Push and open one PR**

```bash
git push -u origin HEAD
research_f188_issue="$(gh issue list --repo boardx/workspacex --state open --search '[F188] in:title' --limit 1 --json number --jq '.[0].number')"
test -n "$research_f188_issue"
gh pr create --repo boardx/workspacex \
  --title "[F188] LangGraph 研究状态基础与 Brief 节点" \
  --body "Closes #$research_f188_issue"
```

Do not close F170 #1357 from this foundation PR; F170 remains the real Search slice in the approved design.

---

## Subsequent Plans

After this PR is merged and audited on `main`, write and execute separate plans in this order:

1. `guided-research-langgraph-directions` — full Directions nodeState, generation, edits, confirmation and downstream invalidation.
2. `guided-research-langgraph-outline` — full Outline nodeState, generation, edits, confirmation and downstream invalidation.
3. `guided-research-langgraph-search-f170` — real persisted chapter tasks, sources, progress events and failed-task retry; closes #1357.
4. `guided-research-langgraph-report-f171` — structured report sections, citations, hydration, retry and completion.

Each plan starts from the merged previous slice and must not be implemented in parallel because all four touch the shared Research contract, Graph State and Web workflow shell.
