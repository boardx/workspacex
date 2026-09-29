/**
 * CT10 / UC-WC-7 `listBoardRunCards` —— 先按实例读权限过滤，再纯函数投影（I-C12）。
 *
 * 可见性与 WF03 实例 projection 同一规则（instance-projection.ts）：发起人本人或组织管理员。
 * 无权限的实例在进入投影之前就被丢弃，所以输出里不存在它的卡 ID（E10，无占位）。
 */
import { canView } from "../workflow/instance-projection";
import type { WorkflowAccessPort } from "../workflow/workflow-runtime-ports";
import {
  projectRunCards,
  type BoardWorkflowRunCard,
  type VisibleRunSummary,
} from "../../domain/board/workflow-run-card";

export interface BoardRunSource {
  /**
   * 组织内候选运行；projectId 缺省 = 全局视图。initiatorUserId 非 null 时在库里先按发起人收窄
   * （非管理员的可见集只可能是自己发起的，必须在 LIMIT 之前收窄，否则他人的新运行会把自己的挤掉）。
   */
  listRuns(orgId: string, projectId: string | null, initiatorUserId: string | null): Promise<VisibleRunSummary[]>;
}

export interface ListBoardRunCardsDeps {
  readonly runs: BoardRunSource;
  readonly access: Pick<WorkflowAccessPort, "orgRoleOf">;
}

export async function listBoardRunCards(
  deps: ListBoardRunCardsDeps,
  input: { readonly orgId: string; readonly viewerUserId: string; readonly projectId?: string | null },
): Promise<{ cards: BoardWorkflowRunCard[] }> {
  const role = await deps.access.orgRoleOf(input.orgId, input.viewerUserId);
  if (role === null) return { cards: [] };
  const actor = { userId: input.viewerUserId, orgRole: role };
  // SQL 预收窄：若 canView 对「他人发起」的运行为假（即非管理员），就只取本人发起的候选。
  // 推导自 canView 本身，不另写角色判断；canView 仍是下面的最终守卫。
  const seesOthers = canView({ initiatorUserId: "\u0000other" }, actor);
  const candidates = await deps.runs.listRuns(input.orgId, input.projectId ?? null, seesOthers ? null : input.viewerUserId);
  // 唯一读权限谓词：WF03 instance-projection 的 canView（不在此处另写一份）。
  const visible = candidates.filter((r) => canView(r, actor));
  return { cards: projectRunCards(visible) };
}

/** Nest 注入令牌：interface 层只经此拿到已装配的依赖（infrastructure 在 kernel.module 装配）。 */
export const BOARD_RUN_CARDS_DEPS = Symbol("BOARD_RUN_CARDS_DEPS");
