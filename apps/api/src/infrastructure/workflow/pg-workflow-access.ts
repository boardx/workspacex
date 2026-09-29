/**
 * WF03 —— `WorkflowAccessPort` 的 PostgreSQL 适配器：组织角色（可见性）与「发起人可运行的已发布 Agent 版本」（E6）。
 *
 * 只返回标识（org_role / agent_versions.id），不返回任何 Agent 内容。
 * 准入判据：发起人是本组织成员，且 Agent 在本组织内 enabled 并有已发布版本（与聊天/能力可用性同一谓词
 * PUBLISHED_AGENT_*）。按 Agent 的 `workflowAllowlist` 收窄属于角色 Agent 契约（agent-role 束），
 * 通用 start 仍对所有已发布 Agent 放行；内容线（CT06）经 `publishedWorkflowAllowlist` 读已发布版本冻结的
 * `workflow_allowlist`，由 application/work-content/start-content-workflow 判定（E3）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { AgentWorkflowAllowlistPort } from "../../application/work-content/start-content-workflow";
import type { WorkflowAccessPort } from "../../application/workflow/workflow-runtime-ports";
import { toOrgId } from "../../domain/org-id";
import { PUBLISHED_AGENT_ENABLED, PUBLISHED_AGENT_VERSION_MATCH } from "../agent/published-agent-sql";

export class PgWorkflowAccess implements WorkflowAccessPort, AgentWorkflowAllowlistPort {
  constructor(private readonly db: DatabasePort) {}

  orgRoleOf(orgId: string, userId: string): Promise<"admin" | "member" | null> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<{ org_role: string }>(
        "SELECT org_role FROM org_memberships WHERE org_id = $1 AND user_id = $2",
        [orgId, userId],
      );
      const role = rows[0]?.org_role;
      if (!role) return null;
      return role === "admin" ? "admin" : "member";
    });
  }

  runnableAgentVersion(orgId: string, userId: string, agentId: string, _workflowKey: string): Promise<string | null> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<{ version_id: string }>(
        `SELECT v.id AS version_id
           FROM agents a JOIN agent_versions v ON ${PUBLISHED_AGENT_VERSION_MATCH}
          WHERE a.org_id = $1 AND a.id = $2 AND ${PUBLISHED_AGENT_ENABLED}
            AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = $1 AND m.user_id = $3)`,
        [orgId, agentId, userId],
      );
      return rows[0]?.version_id ?? null;
    });
  }

  /** CT06 / E3：发起 Agent 已发布版本冻结的 workflow_allowlist；与 runnableAgentVersion 同一准入谓词。 */
  publishedWorkflowAllowlist(orgId: string, userId: string, agentId: string): Promise<readonly string[] | null> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<{ workflow_allowlist: string[] }>(
        `SELECT v.workflow_allowlist
           FROM agents a JOIN agent_versions v ON ${PUBLISHED_AGENT_VERSION_MATCH}
          WHERE a.org_id = $1 AND a.id = $2 AND ${PUBLISHED_AGENT_ENABLED}
            AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = $1 AND m.user_id = $3)`,
        [orgId, agentId, userId],
      );
      return rows[0] ? [...rows[0].workflow_allowlist] : null;
    });
  }
}
