/**
 * F977 —— UC-1 `getPlanLedger` 的前端取数口。真实 `GET /plan-control/threads/:id/ledger`
 * （F977 新接的 HTTP 面，`apps/api/src/interface/controllers/plan-control.controller.ts`），
 * 不是 mock 数据。返回值经 `planControl.getPlanLedger.out` 校验——契约单一事实源，
 * 不在这里另猜一份形状。
 *
 * ⚠ 本 PR（接线 `copilotkit-v2-panel.tsx`）补的部分——`getPlanLedger` 之外的八个写操作
 * （UC-3…UC-10/UC-13）此前只在 `packages/contracts/src/plan-control.ts` 里声明了
 * method/path/in/out/err，从没有一个前端调用点，后端也没有对应的 `@Post` 路由（同一轮
 * 一并补上，见 `plan-control.controller.ts` 文件头注）。下面每个函数对应一个真实的
 * HTTP 端点，`in`/`out` 都经对应的 zod schema 校验——不是这里另猜一份形状。
 *
 * `basedOnRevision` 一律来自调用方持有的最新 `PlanLedgerView.revision`（乐观并发，I-5），
 * `PLAN_REVISION_CHANGED` 时调用方应重新 `fetchPlanLedger` 再决定要不要重放。
 */
import { apiRequest, ApiError } from "@/lib/api-client";
import { PlanControlError, planControl } from "@repo/contracts/plan-control";
import { planPermissions } from "@repo/contracts";
import type { z } from "zod";

export type PlanLedgerView = z.infer<typeof planControl.getPlanLedger.out>;

export async function fetchPlanLedger(threadId: string, projectId?: string | null): Promise<PlanLedgerView> {
  const raw = await apiRequest<unknown>(`/plan-control/threads/${threadId}/ledger`, { query: { projectId: projectId ?? undefined } });
  return planControl.getPlanLedger.out.parse(raw);
}

/** `PlanControlError`——见 `plan-control.ts` 的封闭枚举。`ApiError.reasonCode` 已经是
 *  这个集合的成员（后端 `AllExceptionsFilter` 的闭集校验保证），这里只是收窄类型，
 *  不重新判定一次。 */
export type PlanControlErrorCode = z.infer<typeof PlanControlError>;

/** 把 `ApiError` 的 `reasonCode` 收窄成 `PlanControlErrorCode`；不在枚举里（网络错误、
 *  非本束错误）时返回 `null`，调用方应展示一个通用失败提示，不猜一个不属于本束的码。 */
export function planControlErrorCode(e: unknown): PlanControlErrorCode | null {
  if (!(e instanceof ApiError) || e.reasonCode === null) return null;
  const parsed = PlanControlError.safeParse(e.reasonCode);
  return parsed.success ? parsed.data : null;
}

export type ReorderPlanStepOutput = z.infer<typeof planControl.reorderPlanStep.out>;

export async function reorderPlanStep(
  threadId: string, input: { basedOnRevision: number; planStepId: string; toIndex: number }, projectId?: string | null,
): Promise<ReorderPlanStepOutput> {
  const raw = await apiRequest<unknown>(`/plan-control/threads/${threadId}/steps/reorder`, {
    method: "POST", body: input, query: { projectId: projectId ?? undefined },
  });
  return planControl.reorderPlanStep.out.parse(raw);
}

export type DeletePlanStepOutput = z.infer<typeof planControl.deletePlanStep.out>;

export async function deletePlanStep(
  threadId: string, input: { basedOnRevision: number; planStepId: string }, projectId?: string | null,
): Promise<DeletePlanStepOutput> {
  const raw = await apiRequest<unknown>(`/plan-control/threads/${threadId}/steps/delete`, {
    method: "POST", body: input, query: { projectId: projectId ?? undefined },
  });
  return planControl.deletePlanStep.out.parse(raw);
}

export type AddPlanConstraintOutput = z.infer<typeof planControl.addPlanConstraint.out>;

export async function addPlanConstraint(
  threadId: string, input: { basedOnRevision: number; planStepId: string; text: string }, projectId?: string | null,
): Promise<AddPlanConstraintOutput> {
  const raw = await apiRequest<unknown>(`/plan-control/threads/${threadId}/constraints`, {
    method: "POST", body: input, query: { projectId: projectId ?? undefined },
  });
  return planControl.addPlanConstraint.out.parse(raw);
}

export type RemovePlanConstraintOutput = z.infer<typeof planControl.removePlanConstraint.out>;

export async function removePlanConstraint(
  threadId: string, input: { basedOnRevision: number; constraintId: string }, projectId?: string | null,
): Promise<RemovePlanConstraintOutput> {
  const raw = await apiRequest<unknown>(`/plan-control/threads/${threadId}/constraints/remove`, {
    method: "POST", body: input, query: { projectId: projectId ?? undefined },
  });
  return planControl.removePlanConstraint.out.parse(raw);
}

export type ConfirmPlanOutput = z.infer<typeof planControl.confirmPlan.out>;

export async function confirmPlan(
  threadId: string, input: { basedOnRevision: number }, projectId?: string | null,
): Promise<ConfirmPlanOutput> {
  const raw = await apiRequest<unknown>(`/plan-control/threads/${threadId}/confirm`, {
    method: "POST", body: input, query: { projectId: projectId ?? undefined },
  });
  return planControl.confirmPlan.out.parse(raw);
}

/**
 * issue #3132（B7）—— 确认门的「确认并执行」。
 *
 * ⚠ **不是 `confirmPlan`。** 两个动作名字像，语义完全不同，走错分支会**多起一条 run**：
 * - `confirmPlan`（UC-7）= `createConfirmedRun`：把**账本里已有的**计划交给一条**新的**
 *   run 去执行。服务的是「用户改完账本后另起一轮」那条路径。
 * - 本函数 = `decidePermissionRequest(once)`：**恢复停住的那条 run**。计划确认门下
 *   run 正停在 `write_todos` 的中断上（`awaiting_tool_permission`），账本还是空的，
 *   提案从未生效——要的是让它接着往下跑，不是另开一条。
 *
 * 人类 2026-09-08 裁决 O-2 明确切开这两个入口。走的是既有的
 * `decideToolPermission → approveAndRequeue → Command(resume=...)` 链路，一条新边都不加。
 */
export async function confirmProposedPlan(
  runId: string, permissionRequestId: string, decision: "once" | "deny" = "once",
): Promise<{ runId: string; permissionRequestId: string }> {
  const raw = await apiRequest<unknown>(
    planPermissions.operations.decidePermissionRequest.path
      .replace(":runId", encodeURIComponent(runId))
      .replace(":permissionRequestId", encodeURIComponent(permissionRequestId)),
    { method: "POST", body: { decision } },
  );
  return planPermissions.operations.decidePermissionRequest.out.parse(raw);
}

export type PausePlanRunOutput = z.infer<typeof planControl.pausePlanRun.out>;

export async function pausePlanRun(threadId: string, projectId?: string | null): Promise<PausePlanRunOutput> {
  const raw = await apiRequest<unknown>(`/plan-control/threads/${threadId}/runs/pause`, { method: "POST", query: { projectId: projectId ?? undefined } });
  return planControl.pausePlanRun.out.parse(raw);
}

export type ResumePlanRunOutput = z.infer<typeof planControl.resumePlanRun.out>;

export async function resumePlanRun(threadId: string, projectId?: string | null): Promise<ResumePlanRunOutput> {
  const raw = await apiRequest<unknown>(`/plan-control/threads/${threadId}/runs/resume`, { method: "POST", query: { projectId: projectId ?? undefined } });
  return planControl.resumePlanRun.out.parse(raw);
}

export type RetryPlanStepOutput = z.infer<typeof planControl.retryPlanStep.out>;

export async function retryPlanStep(
  threadId: string, input: { planStepId: string }, projectId?: string | null,
): Promise<RetryPlanStepOutput> {
  const raw = await apiRequest<unknown>(`/plan-control/threads/${threadId}/steps/retry`, {
    method: "POST", body: input, query: { projectId: projectId ?? undefined },
  });
  return planControl.retryPlanStep.out.parse(raw);
}
