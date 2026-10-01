/**
 * WF06 —— pg-boss 泛化：同一队列（`workspacex-scheduled-run`）上,`{kind:'workflow',triggerId}`
 * payload 路由给 Workflow 定时唤醒,其余形状（原 agent-run `{orgId,scheduleId}`,没有 `kind` 字段）
 * 原样交给既有 agent-run handler——兼容旧作业,不改它们的行为（usecases.md UC-WR-I4）。
 *
 * 只在 infrastructure 层 import `pg-boss` 的 `Job` 类型,application 层（`deliver-scheduled-trigger.ts`）
 * 只见 `{id,data}` 这样的普通端口形状,保持洋葱架构方向。
 */
import type { Job } from "pg-boss";
import { WorkflowScheduledJobPayload } from "@repo/contracts/workflow-runtime";

export function isWorkflowScheduledJob(data: unknown): data is { kind: "workflow"; triggerId: string } {
  return WorkflowScheduledJobPayload.safeParse(data).success;
}

/**
 * 泛化处理器：按 `job.data.kind` 分派。两个处理器互不感知对方的存在,新增第三种 `kind` 时
 * 只需要再加一个分支,不需要改任一既有处理器。
 */
export function createGeneralizedScheduleHandler<TLegacy>(
  legacy: (job: Job<TLegacy>) => Promise<void>,
  workflow: (job: Job<{ kind: "workflow"; triggerId: string }>) => Promise<void>,
): (job: Job<TLegacy>) => Promise<void> {
  return (job) =>
    isWorkflowScheduledJob(job.data)
      ? workflow(job as unknown as Job<{ kind: "workflow"; triggerId: string }>)
      : legacy(job);
}
