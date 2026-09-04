# 契约束 `plan-permissions` — ② 用例接口与失败模式（签核面第 ② 件）

> 洋葱中层，只依赖 `domain.md`。翻译自 `requirements/03-plan-mode-permissions.md`
> R3/R4/R5/R6，不发挥。对应 `packages/contracts/src/plan-permissions.ts`。

## 统一失败枚举

```
PlanConfirmationError
  NOT_VISIBLE                          调用者对该 run 无可见权
  RUN_NOT_AWAITING_PLAN_CONFIRMATION   run 当前不处于 awaiting_plan_confirmation
  PLAN_INVALID_AFTER_EDIT              编辑后计划不合法（如删除必要前置步骤，E2）

ToolPermissionDecisionError
  NOT_VISIBLE                          调用者对该 run 无可见权
  RUN_NOT_AWAITING_TOOL_PERMISSION     run 当前不处于 awaiting_tool_permission
  TOOL_CALL_ALREADY_DECIDED            竞态：该工具调用已被裁决或 run 已终态
```

## UC-1 `getPlan` —— 读当前计划

```
in:  { runId }
out: { runId, steps: PlanStepDraft[] }
pre: 调用者对该 run 可见
err: NOT_VISIBLE
```

## UC-2 `editPlanStep` —— 编辑某步骤正文

```
in:  { runId, stepId, content }
out: GetPlanOutput（编辑后的完整计划）
pre: run 处于 awaiting_plan_confirmation
err: NOT_VISIBLE | RUN_NOT_AWAITING_PLAN_CONFIRMATION
```

## UC-3 `deletePlanStep` —— 删除某步骤

```
in:  { runId, stepId }
out: GetPlanOutput
pre: run 处于 awaiting_plan_confirmation
err: NOT_VISIBLE | RUN_NOT_AWAITING_PLAN_CONFIRMATION | PLAN_INVALID_AFTER_EDIT
```

失败模式：
- `PLAN_INVALID_AFTER_EDIT`：E2，删除了必要前置步骤导致后续步骤无法执行，或删到
  0 步。内核应能识别并给出提示，而不是静默执行到中途失败。

## UC-4 `confirmPlan` —— 确认执行（直接确认 / 编辑后确认）

```
in:  { runId, steps: PlanStepDraft[] }
out: { runId }
pre: run 处于 awaiting_plan_confirmation
err: NOT_VISIBLE | RUN_NOT_AWAITING_PLAN_CONFIRMATION
```

编辑后的 plan 以修订版本写回内核作为新的执行输入，run 状态回到 `running`
（`streaming-transport` 束的 `AgentKernelRunStatus`，本束不重复定义状态机本身）。

## UC-5 `cancelPlan` —— 取消（R4 A1）

```
in:  { runId }
out: { runId }
pre: run 处于 awaiting_plan_confirmation
err: NOT_VISIBLE | RUN_NOT_AWAITING_PLAN_CONFIRMATION
```

失败模式：调用成功后 run 立即进入 `cancelled` 终态，不残留在任何非终态。

## UC-6 `decideToolPermission` —— 工具权限四选一决策

```
in:  { runId, toolCallId, decision: "once" | "run" | "forever" | "deny" }
out: { runId, toolCallId }
pre: run 处于 awaiting_tool_permission
err: NOT_VISIBLE | RUN_NOT_AWAITING_TOOL_PERMISSION | TOOL_CALL_ALREADY_DECIDED
```

失败模式：
- 用户批准（`once`/`run`/`forever`）：网关代理该工具调用在沙箱执行
  （委托 `kernel-gateway` 束 `proxyToolExecution`），run 回到 `running`。
- 用户拒绝（`deny`）：内核收到拒绝结果，据此调整后续计划，不直接判定整个 run
  失败（R3 步骤 6）。
- `forever`：写入 `StandingToolGrant`，组织级运行时持久化，无后台管理界面
  （查看/撤销不在本 phase 范围）。

## 跨束委托（不在本束实现，只调用）

- run 可见性判定 → 上游 `chat`/`identity` 束。
- run 状态机（`awaiting_plan_confirmation`/`awaiting_tool_permission`/`running`）
  → `streaming-transport` 束的 `AgentKernelRunStatus`。
- 授权通过后的实际工具执行 → `kernel-gateway` 束 `proxyToolExecution`。
