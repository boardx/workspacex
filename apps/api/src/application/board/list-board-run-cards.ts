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
  /** 组织内候选运行（未过滤权限）；projectId 缺省 = 全局视图。 */
  listRuns(orgId: string, projectId: string | null): Promise<VisibleRunSummary[]>;
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
  const candidates = await deps.runs.listRuns(input.orgId, input.projectId ?? null);
  // 唯一读权限谓词：WF03 instance-projection 的 canView（不在此处另写一份）。
  const actor = { userId: input.viewerUserId, orgRole: role };
  const visible = candidates.filter((r) => canView(r, actor));
  return { cards: projectRunCards(visible) };
}

/** Nest 注入令牌：interface 层只经此拿到已装配的依赖（infrastructure 在 kernel.module 装配）。 */
export const BOARD_RUN_CARDS_DEPS = Symbol("BOARD_RUN_CARDS_DEPS");
