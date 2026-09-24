# Guided Research Effort Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Deep Research 用户在检索前选择 `fast | std | deep`，由服务端解析并持久化不可变预算快照，在执行、刷新和恢复时看到连续用量，并在硬上限处得到明确的预算耗尽结果。

**Architecture:** 在现有 `GuidedResearchRuntime` JSONB 状态中增加预算快照和累计用量。独立 `guided-effort-policy.ts` 是额度唯一事实源；运行时在模型调用、计划任务、搜索尝试和来源接纳四个边界机械扣账，进度 API 投影同一状态，前端只提交 tier、不复制额度。

**Tech Stack:** TypeScript、Zod、NestJS、PostgreSQL JSONB、React、Vitest、Testing Library、pnpm/turbo。

**Spec:** `docs/superpowers/specs/2026-09-24-trustworthy-long-horizon-research-design.md`

## Global Constraints

- 本计划只修改 `deep_research` 的 Guided Research Runtime；User Research 保持独立。
- 用户只提交 tier；额度只定义在 `apps/api/src/application/research/guided-effort-policy.ts`。
- 快照创建后不可变；恢复使用原快照，部署新策略不得改变旧会话。
- 用量只由服务端累计；浏览器和模型输出都不能写用量。
- 达到硬上限时返回 `RESEARCH_BUDGET_EXHAUSTED`，不得超支或自动升级。
- 同一 `requestId` 重放不得二次扣账。
- 不手改签核、`active-features.json` 或 feature 的 `status/owner/evidence`。
- 每个代码任务必须先观察 RED，再写最小实现并观察 GREEN。
- 来源快照、Claim Ledger、check-in 和动态停止判据不在本计划范围。

## Review Focus

- 策略升级后的旧会话继续使用其原快照；Task 3 的真实 JSONB 恢复测试覆盖。
- 同一 `requestId` 重放不重复扣账；Task 4 的 provider 计数器覆盖。
- 用量恰好等于上限时，下一次调用被阻止；Task 2/4 的边界测试覆盖。
- 没有预算字段的旧 JSONB 可读但不会被伪造历史用量；Task 3 覆盖。
- 前端配置遇到版本冲突时保留选择并显示错误；Task 5 覆盖。

---

## Delivery Gate: requirements, UI and contract signoff

进入 Task 1 前必须完成：

1. 在 `phases/phase-06-deep-research/requirements/00-overview.md` 增加 `R6`，写清预算选择、恢复、耗尽和幂等异常流。
2. 由 `ui-prototyper` 用真实组件和 mock runtime 产出预算选择/运行摘要材料，更新 `contracts/deep-research/ui.md`。
3. 更新 `contracts/deep-research/usecases.md`、`domain.md`、`coverage.md`；不要替人修改 `design-signoff.md` 状态。
4. 用 `requirement-author`、`feature-writing`、`verification-writer` 生成一个 4–8 小时等效纵向 feature。
5. 人类完成束级 UI / Use Cases / API Contract 签核和 phase 一致性复核。
6. `pnpm harness sync --phase 06 --apply` 创建 issue，在独立 worktree 按 issue 分支开工。

建议 feature 四元组：

```json
{
  "title": "为长时研究增加真实投入预算与恢复摘要",
  "spec_ref": "00-overview.md#R6",
  "user_visible_behavior": "用户选择 fast、std 或 deep 后，页面展示服务端解析的真实预算；开始检索、刷新或恢复时预算快照不变且用量连续累计。下一次外部调用会超过硬上限时，系统停止调用并展示预算已用尽。",
  "verification": [
    "pnpm --filter @repo/contracts exec vitest run tests/guided-research-budget-contract.test.ts",
    "pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-effort-policy.test.ts tests/research/guided-runtime-budget.test.ts tests/research/guided-runtime-budget-persistence.test.ts",
    "pnpm --filter web exec vitest run tests/ui/guided-research-budget.test.tsx tests/ui/guided-research-progress.test.ts",
    "pnpm -w run verify:base"
  ]
}
```

门禁未完成时停止，不写以下产品代码。

---

### Task 1: Shared budget contract

**Files:**

- Modify: `packages/contracts/src/research.ts:830-1040`
- Create: `packages/contracts/tests/guided-research-budget-contract.test.ts`

**Interfaces:**

- Consumes: existing `GuidedResearchRuntime`, `GuidedResearchRuntimeCommand`, `GuidedResearchRuntimeProgress`.
- Produces: `GuidedResearchEffortTier`, `GuidedResearchBudgetLimits`, `GuidedResearchBudgetSnapshot`, `GuidedResearchBudgetUsage`, `GuidedResearchBudgetState`, and `configure_budget`.

- [ ] **Step 1: Write the failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import { research as C } from "../src";

const snapshot = {
  policyId: "guided-research-default", policyVersion: "2026-09-24", tier: "std" as const,
  maxActiveMs: 1_800_000, maxSearchTasks: 20, maxSearchAttempts: 60,
  maxAcceptedSources: 80, maxModelCalls: 40, maxEstimatedCostMinor: null,
  concurrency: 3, resolvedAt: "2026-09-24T00:00:00.000Z",
};

describe("guided research budget contract", () => {
  it("accepts strict server state", () => {
    expect(C.GuidedResearchBudgetState.parse({ snapshot, usage: {
      activeMs: 0, searchTasks: 0, searchAttempts: 0, acceptedSources: 0, modelCalls: 0,
    }}).snapshot).toEqual(snapshot);
  });
  it("only accepts tier configuration on the research node", () => {
    const command = { sessionId: "s", node: "research" as const, action: "configure_budget" as const,
      requestId: "r", expectedVersion: 2, effortTier: "deep" as const };
    expect(C.GuidedResearchRuntimeCommand.parse(command).effortTier).toBe("deep");
    expect(() => C.GuidedResearchRuntimeCommand.parse({ ...command, node: "outline" })).toThrow();
    expect(() => C.GuidedResearchRuntimeCommand.parse({ ...command, effortTier: undefined })).toThrow();
  });
  it("projects budget in lightweight progress", () => {
    expect(C.GuidedResearchRuntimeProgress.shape.budget).toBeDefined();
  });
});
```

- [ ] **Step 2: Verify RED**

Run `pnpm --filter @repo/contracts exec vitest run tests/guided-research-budget-contract.test.ts`.

Expected: FAIL because budget schemas/action do not exist.

- [ ] **Step 3: Add strict schemas**

```ts
export const GuidedResearchEffortTier = z.enum(["fast", "std", "deep"]);
export const GuidedResearchBudgetLimits = z.object({
  maxActiveMs: z.number().int().positive(), maxSearchTasks: z.number().int().positive(),
  maxSearchAttempts: z.number().int().positive(), maxAcceptedSources: z.number().int().positive(),
  maxModelCalls: z.number().int().positive(), maxEstimatedCostMinor: z.number().int().nonnegative().nullable(),
  concurrency: z.number().int().min(1).max(8),
}).strict();
export const GuidedResearchBudgetSnapshot = GuidedResearchBudgetLimits.extend({
  policyId: z.string().min(1), policyVersion: z.string().min(1), tier: GuidedResearchEffortTier,
  resolvedAt: z.string().datetime(),
}).strict();
export const GuidedResearchBudgetUsage = z.object({
  activeMs: z.number().int().nonnegative(), searchTasks: z.number().int().nonnegative(),
  searchAttempts: z.number().int().nonnegative(), acceptedSources: z.number().int().nonnegative(),
  modelCalls: z.number().int().nonnegative(),
}).strict();
export const GuidedResearchBudgetState = z.object({
  snapshot: GuidedResearchBudgetSnapshot, usage: GuidedResearchBudgetUsage,
}).strict();
```

Add `budget: GuidedResearchBudgetState.nullable().optional()` to runtime, include it in progress, add optional `effortTier` to command, and refine `configure_budget` so it only accepts `node=research` plus exactly one tier and no draft/message/proposal/source fields. All other actions forbid `effortTier`. Add public errors `RESEARCH_BUDGET_REQUIRED`, `RESEARCH_BUDGET_EXHAUSTED`, `RESEARCH_BUDGET_ALREADY_CONFIGURED`.

- [ ] **Step 4: Verify GREEN and mutate the assertion**

Run the Step 2 command; expect PASS. Temporarily make the accepted command use `outline`; expect FAIL. Restore and rerun PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/research.ts packages/contracts/tests/guided-research-budget-contract.test.ts
git commit -m "feat(research): define effort budget contract"
```

---

### Task 2: Server policy and accounting helpers

**Files:**

- Create: `apps/api/src/application/research/guided-effort-policy.ts`
- Create: `apps/api/tests/research/guided-effort-policy.test.ts`

**Interfaces:**

- Produces `resolveGuidedEffortBudget(tier, now)`, `assertGuidedBudget(budget, resource, increment)`, `recordGuidedActiveMs(budget, elapsedMs)`.

- [ ] **Step 1: Write failing tests**

```ts
it("resolves all public tiers from one server policy", () => {
  const now = new Date("2026-09-24T00:00:00Z");
  expect(resolveGuidedEffortBudget("fast", now).snapshot).toMatchObject({ tier: "fast", concurrency: 2 });
  expect(resolveGuidedEffortBudget("std", now).snapshot).toMatchObject({ tier: "std", concurrency: 3 });
  expect(resolveGuidedEffortBudget("deep", now).snapshot).toMatchObject({ tier: "deep", concurrency: 3 });
});
it("blocks the next operation at the exact limit", () => {
  const budget = resolveGuidedEffortBudget("fast");
  budget.usage.modelCalls = budget.snapshot.maxModelCalls;
  expect(() => assertGuidedBudget(budget, "modelCalls", 1)).toThrowError("RESEARCH_BUDGET_EXHAUSTED");
});
it("counts active execution but ignores negative duration", () => {
  const budget = resolveGuidedEffortBudget("std");
  recordGuidedActiveMs(budget, 1250); recordGuidedActiveMs(budget, -50);
  expect(budget.usage.activeMs).toBe(1250);
});
```

- [ ] **Step 2: Verify RED**

Run `pnpm --filter api exec vitest run tests/research/guided-effort-policy.test.ts`.

- [ ] **Step 3: Implement the single policy source**

Use these initial defaults only in `guided-effort-policy.ts`:

```ts
const LIMITS = {
  fast: { maxActiveMs: 600_000, maxSearchTasks: 8, maxSearchAttempts: 16, maxAcceptedSources: 24, maxModelCalls: 12, maxEstimatedCostMinor: null, concurrency: 2 },
  std: { maxActiveMs: 1_800_000, maxSearchTasks: 20, maxSearchAttempts: 60, maxAcceptedSources: 80, maxModelCalls: 40, maxEstimatedCostMinor: null, concurrency: 3 },
  deep: { maxActiveMs: 7_200_000, maxSearchTasks: 60, maxSearchAttempts: 180, maxAcceptedSources: 300, maxModelCalls: 120, maxEstimatedCostMinor: null, concurrency: 3 },
} satisfies Record<z.infer<typeof C.GuidedResearchEffortTier>, z.infer<typeof C.GuidedResearchBudgetLimits>>;
```

`resolveGuidedEffortBudget` parses a snapshot with `policyId="guided-research-default"`, `policyVersion="2026-09-24"`, the tier limits and zero usage. `assertGuidedBudget` throws `ResearchRuntimeError("RESEARCH_BUDGET_REQUIRED")` when absent and `RESEARCH_BUDGET_EXHAUSTED` when `usage + increment > limit`. Do not export `LIMITS`.

- [ ] **Step 4: Verify GREEN and commit**

Run the Step 2 command; expect PASS.

```bash
git add apps/api/src/application/research/guided-effort-policy.ts apps/api/tests/research/guided-effort-policy.test.ts
git commit -m "feat(research): resolve server-owned effort budgets"
```

---

### Task 3: Persist immutable snapshots and normalize legacy JSON

**Files:**

- Modify: `apps/api/src/application/research/guided-runtime-service.ts:49-60`
- Modify: `apps/api/src/infrastructure/research/pg-guided-runtime-store.ts:17-45`
- Create: `apps/api/tests/research/guided-runtime-budget-persistence.test.ts`

**Interfaces:**

- Consumes Task 1 command and Task 2 resolver.
- Produces persisted `state.budget`; legacy read compatibility without fabricated history.

- [ ] **Step 1: Write real PostgreSQL persistence tests**

Follow `guided-runtime-persistence.test.ts` fixtures and assert:

```ts
it("reloads a resolved snapshot byte-for-byte", async () => {
  const configured = await executeConfigure("std");
  expect((await reload()).budget).toEqual(configured.budget);
});
it("keeps the stored policy version and limits", async () => {
  const configured = await executeConfigure("fast");
  const restored = await reload();
  expect(restored.budget?.snapshot.policyVersion).toBe(configured.budget?.snapshot.policyVersion);
  expect(restored.budget?.snapshot.maxSearchTasks).toBe(configured.budget?.snapshot.maxSearchTasks);
});
it("loads legacy JSON as budget null", async () => {
  await writeRuntimeJsonWithoutBudget();
  expect((await reload()).budget).toBeNull();
});
```

- [ ] **Step 2: Verify RED**

Run `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-runtime-budget-persistence.test.ts`.

- [ ] **Step 3: Add compatibility normalization**

Set `budget: null` in `initialRuntime`. Before strict parsing stored state in `read` and `claim`, use:

```ts
function normalizeBudgetState(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.hasOwn(value, "budget") ? value : { ...value, budget: null };
}
```

Do not infer a legacy tier or usage.

- [ ] **Step 4: Handle configure without external effects**

Before model/search work in `perform`:

```ts
if (command.action === "configure_budget") {
  if (state.budget) throw new ResearchRuntimeError("RESEARCH_BUDGET_ALREADY_CONFIGURED");
  state.budget = resolveGuidedEffortBudget(command.effortTier!);
  return;
}
```

- [ ] **Step 5: Verify GREEN, mutate, and commit**

Run Step 2; expect PASS. Change the legacy expectation to `{}`; expect FAIL. Restore, rerun PASS, then commit:

```bash
git add apps/api/src/application/research/guided-runtime-service.ts apps/api/src/infrastructure/research/pg-guided-runtime-store.ts apps/api/tests/research/guided-runtime-budget-persistence.test.ts
git commit -m "feat(research): persist immutable effort snapshots"
```

---

### Task 4: Enforce budget at external-effect boundaries

**Files:**

- Modify: `apps/api/src/application/research/guided-runtime-service.ts`
- Create: `apps/api/tests/research/guided-runtime-budget.test.ts`
- Modify fixtures in existing affected runtime tests.

**Interfaces:** no provider call is allowed after the relevant limit; usage is persisted before/with effects.

- [ ] **Step 1: Write failing runtime tests with provider counters**

Using the in-memory store pattern from `guided-runtime-orchestration.test.ts`, cover:

```ts
it("requires budget before planning", async () => {
  await execute({ node: "research", action: "start" });
  expect(state.errorCode).toBe("RESEARCH_BUDGET_REQUIRED");
  expect(modelCalls).toBe(0); expect(searchCalls).toBe(0);
});
it("does not double charge an idempotent replay", async () => {
  await configure("fast"); await execute(startCommand("same"));
  const usage = structuredClone(state.budget!.usage);
  await execute(startCommand("same"));
  expect(state.budget!.usage).toEqual(usage);
});
it("does not call a provider at its exact limit", async () => {
  await configure("fast"); state.budget!.usage.modelCalls = state.budget!.snapshot.maxModelCalls;
  await execute(generateDirections());
  expect(state.errorCode).toBe("RESEARCH_BUDGET_EXHAUSTED");
  expect(modelCalls).toBe(0);
});
it("rejects an oversized plan without persisting partial tasks", async () => {
  await configure("fast"); modelOutput = planWithTasks(state.budget!.snapshot.maxSearchTasks + 1);
  await execute(startCommand("oversized"));
  expect(state.errorCode).toBe("RESEARCH_BUDGET_EXHAUSTED");
  expect(state.tasks).toHaveLength(0);
});
it("rejects an oversized source batch without partial acceptance", async () => {
  await configure("fast"); searchOutput = uniqueSources(state.budget!.snapshot.maxAcceptedSources + 1);
  await execute(startCommand("sources"));
  expect(state.errorCode).toBe("RESEARCH_BUDGET_EXHAUSTED");
  expect(state.sources).toHaveLength(0);
});
```

- [ ] **Step 2: Verify RED**

Run `pnpm --filter api exec vitest run tests/research/guided-runtime-budget.test.ts`.

- [ ] **Step 3: Guard model, plan, search and sources**

- At the start of `completeJson`: assert `modelCalls + 1`, then increment before calling the provider. Failed billable calls remain counted.
- After plan validation and before assigning tasks: assert/increment the full task count; never truncate.
- Immediately before each `search.search`: assert/increment one search attempt.
- Before mutating sources: compute the whole newly accepted unique set, assert it fits, then add all and increment; never partially add a provider batch.
- Use `state.budget.snapshot.concurrency` instead of the current hard-coded search batch size `3`.

- [ ] **Step 4: Count active time**

After a non-replay claim, capture `performance.now()`. Before final persistence, add only the elapsed time spent executing that command. Before the first external effect assert `activeMs` with increment `0`; equality prevents another call. Idle time between commands is not counted.

- [ ] **Step 5: Verify GREEN and regressions**

Run:

```bash
pnpm --filter api exec vitest run tests/research/guided-runtime-budget.test.ts
pnpm --filter api exec vitest run tests/research/guided-runtime-orchestration.test.ts tests/research/guided-plan-repair.test.ts tests/research/guided-search-recovery.test.ts tests/research/guided-report-chapters.test.ts
```

Existing fixtures that execute effects must explicitly configure `deep`; do not add an implicit production budget to make tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/application/research/guided-runtime-service.ts apps/api/tests/research/guided-runtime-budget.test.ts apps/api/tests/research/guided-runtime-orchestration.test.ts apps/api/tests/research/guided-plan-repair.test.ts apps/api/tests/research/guided-search-recovery.test.ts apps/api/tests/research/guided-report-chapters.test.ts
git commit -m "feat(research): enforce guided research budgets"
```

---

### Task 5: Budget selection and resumable usage UI

**Files:**

- Create: `apps/web/components/research-studio/guided-research-budget.tsx`
- Modify: `apps/web/components/research-studio/guided-research-live.tsx`
- Modify: `apps/web/components/research-studio/guided-research-runtime-progress.tsx`
- Modify: `apps/web/tests/guided-runtime-fixture.ts`
- Create: `apps/web/tests/ui/guided-research-budget.test.tsx`
- Modify: `apps/web/tests/ui/guided-research-progress.test.ts`

**Interfaces:** `research-effort-budget`, `research-effort-fast|std|deep`, `research-budget-save`, `research-budget-summary` are stable UI anchors.

- [ ] **Step 1: Write failing UI tests**

```tsx
it("requires a persisted budget before search", async () => {
  mockRuntime(runtimeFixture("research", { budget: null }));
  render(<GuidedResearchLive sessionId="s" onBack={vi.fn()} />);
  expect(await screen.findByTestId("research-effort-budget")).toBeVisible();
  expect(screen.getByRole("button", { name: "搜索资料" })).toBeDisabled();
  fireEvent.click(screen.getByTestId("research-effort-deep"));
  fireEvent.click(screen.getByTestId("research-budget-save"));
  expect(lastCommand()).toMatchObject({ node: "research", action: "configure_budget", effortTier: "deep" });
});
it("shows persisted usage after reload", async () => {
  mockRuntime(runtimeFixture("research", { budget: configuredBudget("std", { modelCalls: 3, searchAttempts: 7 }) }));
  render(<GuidedResearchLive sessionId="s" onBack={vi.fn()} />);
  expect(await screen.findByTestId("research-budget-summary")).toHaveTextContent("标准");
  expect(screen.getByTestId("research-budget-summary")).toHaveTextContent("模型调用 3 / 40");
  expect(screen.getByTestId("research-budget-summary")).toHaveTextContent("检索尝试 7 / 60");
});
it("keeps selection after a version conflict", async () => {
  mockConfigureFailure("RESEARCH_GRAPH_VERSION_CONFLICT");
  render(<GuidedResearchLive sessionId="s" onBack={vi.fn()} />);
  fireEvent.click(await screen.findByTestId("research-effort-fast"));
  await act(async () => fireEvent.click(screen.getByTestId("research-budget-save")));
  expect(screen.getByTestId("research-effort-fast")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("alert")).toHaveTextContent("研究状态已更新");
});
```

Use existing `vi.mock("@/lib/guided-research-api")` patterns; illustrative test helpers above stay test-local.

- [ ] **Step 2: Verify RED**

Run `pnpm --filter web exec vitest run tests/ui/guided-research-budget.test.tsx tests/ui/guided-research-progress.test.ts`.

- [ ] **Step 3: Implement `GuidedResearchBudget`**

Render three buttons from `C.GuidedResearchEffortTier.options` with `aria-pressed`. Before configuration render only relative copy (“快速验证”“常规决策”“高风险深挖”). After configuration render numeric limits and usage exclusively from `budget.snapshot` and `budget.usage`.

- [ ] **Step 4: Wire the research node**

- Keep `selectedTier` local per session.
- Send `configure_budget` through the existing `run` path.
- Disable start/retry when `state.budget` is null.
- Map the three budget errors to actionable Chinese messages.
- Clear selection only after returned state contains a budget; keep it on failure.
- Extend `GuidedResearchRuntimeProgress` to show tier, active minutes, model calls, search attempts and accepted sources.
- Let `mergeResearchProgress` use its existing monotonic version merge; add a test that old progress cannot roll usage backward.

- [ ] **Step 5: Verify GREEN and regressions**

```bash
pnpm --filter web exec vitest run tests/ui/guided-research-budget.test.tsx tests/ui/guided-research-progress.test.ts
pnpm --filter web exec vitest run tests/ui/guided-research-live.test.tsx tests/ui/guided-research-transition.test.tsx tests/ui/guided-research-reference-workflow.test.tsx tests/ui/guided-research-search-recovery.test.tsx
```

Tests that click search must configure a budget first; do not weaken production gating.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/research-studio/guided-research-budget.tsx apps/web/components/research-studio/guided-research-live.tsx apps/web/components/research-studio/guided-research-runtime-progress.tsx apps/web/tests/guided-runtime-fixture.ts apps/web/tests/ui/guided-research-budget.test.tsx apps/web/tests/ui/guided-research-progress.test.ts apps/web/tests/ui/guided-research-live.test.tsx apps/web/tests/ui/guided-research-transition.test.tsx apps/web/tests/ui/guided-research-reference-workflow.test.tsx apps/web/tests/ui/guided-research-search-recovery.test.tsx
git commit -m "feat(research): show resumable effort budget"
```

---

### Task 6: Harness verification and PR handoff

**Files:** harness-generated feature evidence and an append-only module lesson only if a new verified lesson exists.

- [ ] **Step 1: Run the exact four commands in the authoritative feature verification array**

Expected: all exit 0. Do not substitute copied commands from this plan if the signed feature differs.

- [ ] **Step 2: Run the feature gate**

Run `pnpm harness verify --sprint 06/<assigned-sprint> --feature <assigned-feature>`.

Expected: harness writes evidence and is the only actor that advances status.

- [ ] **Step 3: Prove a red path**

Run the contract test with `configure_budget` targeting `outline`, or the runtime test with `modelCalls === maxModelCalls` before one call. Expected: targeted assertion FAIL. Restore and rerun authoritative verification GREEN.

- [ ] **Step 4: Prove evidence is in Git**

```bash
git ls-tree HEAD -- phases/phase-06-deep-research/sprints/*/evidence/
git cat-file -e HEAD:phases/phase-06-deep-research/sprints/<assigned-sprint>/evidence/<assigned-feature>.verify.log
```

Expected: non-empty blob exists. If ignored, stop and report.

- [ ] **Step 5: Check scope and open one PR**

```bash
git diff --check origin/main...HEAD
git diff --name-only origin/main...HEAD
```

The PR must contain `Closes #<issue>` and map behavior to evidence:

```text
- tier selection → guided-research-budget.test.tsx
- immutable restore → guided-runtime-budget-persistence.test.ts
- exact-limit/no-provider-call → guided-runtime-budget.test.ts
- monotonic progress merge → guided-research-progress.test.ts
```

- [ ] **Step 6: Own the PR until green**

Resolve checks and review feedback on this branch. Do not start the next research slice until the authorized coordinator merges this green PR.

---

## Plan Self-Review Result

- **Spec coverage:** This plan intentionally covers only “预算快照与运行摘要.” The other six slices remain separate plans.
- **Placeholder scan:** Angle-bracket identifiers appear only where the authoritative feature/sprint/issue does not exist before the Delivery Gate; product steps contain no TODO/TBD.
- **Type consistency:** `GuidedResearchBudgetState` is the sole shape across contract, resolver, runtime, progress and UI. Browser input is always `effortTier`.
- **Review Focus:** Each listed failure has a concrete test in Tasks 2–5.
- **Scope:** Existing runtime JSONB remains the durable source; no second table or duplicate frontend policy constants are introduced.
