/**
 * CT10 / UC-WC-7 `listBoardRunCards` —— 先按实例读权限过滤，再纯函数投影（I-C12）。
 *
 * 可见性与 WF03 实例 projection 同一规则（instance-projection.ts）：发起人本人或组织管理员。
 * 无权限的实例在进入投影之前就被丢弃，所以输出里不存在它的卡 ID（E10，无占位）。
 */
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
  const visible = role === "admin" ? candidates : candidates.filter((r) => r.initiatorUserId === input.viewerUserId);
  return { cards: projectRunCards(visible) };
}
