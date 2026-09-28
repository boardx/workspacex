/**
 * WF06 —— UC-WR-I4 定时唤醒：pg-boss 作业 `{kind:'workflow', triggerId}` 到期时唤醒对应的 schedule
 * 触发器（`WorkflowScheduledJobPayload`，`@repo/contracts/workflow-runtime`）。作业 id 作 requestId 落
 * `startInstanceFromTrigger` 的幂等外壳：同一作业重复投递（pg-boss at-least-once）只建 1 个实例（I-6）。
 *
 * 只依赖普通端口（`{id,data}`），不 import `pg-boss`——队列 SDK 只出现在 infrastructure 层
 * （`workflow-scheduled-job-router.ts`），维持洋葱架构方向。
 */
import { WorkflowScheduledJobPayload } from "@repo/contracts/workflow-runtime";
import { startInstanceFromTrigger, type InstanceCommandDeps } from "./instance-commands";
import { resolveActor } from "./instance-projection";
import type { WorkflowTriggerStore } from "./workflow-trigger-ports";

export interface DeliverScheduledTriggerDeps extends InstanceCommandDeps {
  triggers: WorkflowTriggerStore;
}

export interface ScheduledTriggerJob {
  /** pg-boss 作业 id；本函数把它当 requestId 用（I-6）。 */
  id: string;
  data: unknown;
}

/**
 * 不是本函数负责的 payload（旧 agent-run `{orgId,scheduleId}` 形状,或触发器已被删除/下线）一律
 * 安静跳过——「原 agent-run 唤醒兼容」意味着路由到这里之前已经按 `kind` 分派过一次
 * （见 `workflow-scheduled-job-router.ts`），这里只处理本函数明确认领的 payload。
 */
export async function deliverScheduledWorkflowTrigger(deps: DeliverScheduledTriggerDeps, job: ScheduledTriggerJob): Promise<void> {
  const parsed = WorkflowScheduledJobPayload.safeParse(job.data);
  if (!parsed.success) return;
  const trigger = await deps.triggers.find(parsed.data.triggerId);
  if (!trigger || trigger.kind !== "schedule") return;

  const actor = await resolveActor(deps.access, trigger.orgId, trigger.ownerUserId);
  await startInstanceFromTrigger(deps, {
    orgId: trigger.orgId,
    actorUserId: actor.userId,
    key: trigger.workflowKey,
    version: trigger.version ?? undefined,
    agentId: trigger.agentId,
    input: trigger.defaultInput,
    triggerKind: "schedule",
    requestKey: job.id,
  });
}
