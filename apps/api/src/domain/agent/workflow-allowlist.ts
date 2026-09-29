/**
 * AG05 —— Workflow 白名单判定（03-agent-role.md R3 / E3；契约束 agent-role I-9；ADR-118 #9）。
 *
 * 一个判定、两个调用点（同一事实不两处声明）：
 * - WF03 Runtime start 准入（`PgWorkflowAccess.workflowAllowlistRefusal`，按 Agent **已发布**版本的白名单）；
 * - Agent 在 run 内经 `start_workflow` 工具请求发起（`request-agent-workflow-start.ts`，按该 run **钉住**的
 *   版本快照白名单）。
 *
 * 白名单存 Workflow 稳定编号（`W0xx`，契约 `agentRole.WorkflowStableId`），Runtime 按 key 寻址；两者的
 * 对照只来自代码自带的内容线 Definition 注册表（产品线 / 研究线 / 销售线）。纯函数、无 IO。
 */
import { checkWorkflowAllowlisted, contentWorkflowIdOfKey } from "../work-content/content-workflow-registration";
import { RESEARCH_WORKFLOW_DEFINITIONS } from "../work-content/definitions";
import { SALES_WORKFLOW_DEFINITIONS } from "../work-content/definitions/sales";
import { PRODUCT_LINE_WORKFLOWS } from "../work-content/product-workflow-definitions";
import { officialRoleWorkflowAllowlists } from "./official-role-packs";

const CONTENT_WORKFLOW_CATALOGS: ReadonlyArray<ReadonlyArray<{ key: string; workflowId?: string; id?: string }>> = [
  PRODUCT_LINE_WORKFLOWS,
  RESEARCH_WORKFLOW_DEFINITIONS,
  SALES_WORKFLOW_DEFINITIONS,
];

/** Runtime key → 受白名单约束的内容线稳定编号；非内容线（演示 / 组织自建）返回 null。 */
export function contentWorkflowIdOf(key: string): string | null {
  return contentWorkflowIdOfKey(key, CONTENT_WORKFLOW_CATALOGS);
}

/** 稳定编号 → Runtime key；未注册的编号返回 null（不猜、不改走其它 Workflow）。 */
export function contentWorkflowKeyOf(workflowId: string): string | null {
  for (const list of CONTENT_WORKFLOW_CATALOGS) {
    const hit = list.find((d) => (d.workflowId ?? d.id) === workflowId);
    if (hit) return hit.key;
  }
  return null;
}

export interface WorkflowAllowlistRefusal {
  code: "workflow_not_allowlisted";
  requestedWorkflowId: string;
  /** 白名单内含该 Workflow 的官方角色（可转交提示）；只列官方角色，不泄露组织自建 Agent。 */
  handoffCandidates: string[];
}

/**
 * 精确匹配：`workflowId` 在 `allowlist` 内 ⇒ null（放行）；否则拒绝 + 可转交角色。
 * 不做前缀/模糊匹配，不回退到任何其它 Workflow。
 */
export function workflowAllowlistRefusal(
  agentId: string,
  workflowId: string,
  allowlist: readonly string[],
): WorkflowAllowlistRefusal | null {
  const roles = officialRoleWorkflowAllowlists();
  const decision = checkWorkflowAllowlisted(agentId, workflowId, { ...roles, [agentId]: allowlist });
  if (decision.ok) return null;
  return {
    code: decision.code,
    requestedWorkflowId: decision.requestedWorkflowId,
    handoffCandidates: decision.handoffCandidates.filter((r) => r in roles),
  };
}
