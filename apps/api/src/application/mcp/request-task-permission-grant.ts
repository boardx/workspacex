/**
 * `requestTaskPermissionGrant` -- F53: 第③层（任务权限包）的**申请**接口
 * (contract `operations.requestTaskPermissionGrant`).
 *
 * ⚠ **只申请，不授予**。`user_visible_behavior` 逐字：「授权由人在任务侧完成
 * （`[去授权]`），agent 不能自行加」——本用例落库的状态恒为 `pending-human`，
 * 没有任何分支能把它直接判成已授权。真正的授予/判定属 00-core / 11-board（X-1，
 * design-signoff.md 交叉点表），本文件只是"申请"这一半。
 *
 * ⚠ 不重新发明角色判定：`ROLE_INSUFFICIENT` 由调用方（controller 层）依据
 * `org-admin` 束已有的角色解析结果传入，这里不查库、不判角色规则本身，
 * 避免又造一份"谁能申请"的判定（本仓已因"同一事实两处声明"漂移五次）。
 */
import type { RequestIdFactory, TaskPermissionGrantStore } from "./ports";

export interface RequestTaskPermissionGrantDeps {
  readonly store: TaskPermissionGrantStore;
  readonly ids: RequestIdFactory;
}

export interface RequestTaskPermissionGrantInput {
  readonly taskId: string;
  readonly toolFullName: string;
  readonly requestedByAgentId: string;
  readonly reason: string;
  /** 调用方（controller）已经判过的角色结论；`false` ⇒ 本用例拒并不落库。 */
  readonly requesterRoleSufficient: boolean;
}

export type RequestTaskPermissionGrantResult =
  | { readonly ok: true; readonly requestId: string; readonly state: "pending-human" }
  | { readonly ok: false; readonly code: "ROLE_INSUFFICIENT" }
  | { readonly ok: false; readonly code: "TASK_PERMISSION_MISSING"; readonly reason: string };

export async function requestTaskPermissionGrant(
  deps: RequestTaskPermissionGrantDeps,
  input: RequestTaskPermissionGrantInput,
): Promise<RequestTaskPermissionGrantResult> {
  if (!input.requesterRoleSufficient) {
    return { ok: false, code: "ROLE_INSUFFICIENT" };
  }
  if (input.reason.trim().length === 0) {
    // 契约的 `reason: z.string().min(1)` 已经在边界挡了空串；这里的检查是给
    // 已经过了 zod 但仍是纯空白的输入（"   "）多一道，避免申请记录里写一条空理由。
    return { ok: false, code: "TASK_PERMISSION_MISSING", reason: "申请理由不可为空" };
  }

  const requestId = deps.ids.next();
  await deps.store.create({
    requestId,
    taskId: input.taskId,
    toolFullName: input.toolFullName,
    requestedByAgentId: input.requestedByAgentId,
    reason: input.reason,
  });

  // ⚠ 恒为 pending-human——这是本用例唯一能返回的成功态，agent 侧的授权由此打住。
  return { ok: true, requestId, state: "pending-human" };
}
