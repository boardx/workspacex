/**
 * UC-7 `confirmPlan` —— 确认这份计划，放行执行（`usecases.md` UC-7）。
 *
 * `deliveredPlanDigest` 是 I-10 的可验收出口：账本当前 revision 的序列化结果的哈希，
 * 与 UC-12 `deliverPlanToRun`（`execute-run.ts` 的真实注入点）用的是**同一个**序列化
 * 函数（`plan-delivery-text.ts`），不是两份各自实现、恰好碰巧一致的代码。
 *
 * 送达失败 ⇒ 不创建 run（fail closed）：`PlanRunCreator.createConfirmedRun` 抛出任何
 * 异常都被映射为 `PLAN_DELIVERY_FAILED`，不吞、不重试、不返回一个假的 runId。
 */
import type { OrgId } from "../../domain/org-id";
import { serializePlanForDelivery, planDeliveryDigest } from "./plan-delivery-text";
import { PlanEditError } from "./plan-edit-errors";
import type { PlanLedgerRepository } from "./ports";
import type { PlanRunCreator } from "./plan-run-creator-port";

export interface ConfirmPlanInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly actorId: string;
  readonly basedOnRevision: number;
}

export interface ConfirmPlanOutput {
  readonly revision: number;
  readonly runId: string;
  readonly deliveredPlanDigest: string;
  readonly auditEventId: string;
}

export interface ConfirmPlanDeps {
  readonly repo: PlanLedgerRepository;
  readonly runCreator: PlanRunCreator;
  /** I-13：每次编辑都产生一条审计事件——`confirmPlan` 同样不例外。 */
  readonly appendAudit: (input: {
    readonly orgId: OrgId; readonly threadId: string; readonly actorId: string;
    readonly detail: Record<string, unknown>;
  }) => Promise<string>;
}

export async function confirmPlan(
  deps: ConfirmPlanDeps, input: ConfirmPlanInput,
): Promise<ConfirmPlanOutput> {
  const latest = await deps.repo.getLatest(input.orgId, input.threadId);
  if (latest === null) throw new PlanEditError("PLAN_NOT_FOUND");
  if (latest.revision !== input.basedOnRevision) throw new PlanEditError("PLAN_REVISION_CHANGED");
  if (latest.steps.length === 0) throw new PlanEditError("PLAN_EMPTY_NOT_ALLOWED");

  // I-10 的可验收出口：账本当前 revision 的序列化结果，与 UC-12 用的同一个函数。
  const planText = serializePlanForDelivery(latest);
  // `latest.steps.length === 0` 已在上面拒绝，`serializePlanForDelivery` 因此不可能在
  // 这里返回 null——但仍按类型诚实处理，不用非空断言掩盖。
  if (planText === null) throw new PlanEditError("PLAN_EMPTY_NOT_ALLOWED");
  const deliveredPlanDigest = planDeliveryDigest(planText);

  let runId: string;
  try {
    const created = await deps.runCreator.createConfirmedRun({
      orgId: input.orgId, threadId: input.threadId, actorId: input.actorId,
    });
    runId = created.runId;
  } catch {
    throw new PlanEditError("PLAN_DELIVERY_FAILED");
  }

  const auditEventId = await deps.appendAudit({
    orgId: input.orgId, threadId: input.threadId, actorId: input.actorId,
    detail: { action: "confirmPlan", revision: latest.revision, runId, deliveredPlanDigest },
  });

  return { revision: latest.revision, runId, deliveredPlanDigest, auditEventId };
}
