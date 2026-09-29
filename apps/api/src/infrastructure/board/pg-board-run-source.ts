/**
 * CT10 —— `BoardRunSource` 的 PostgreSQL 适配器（UC-WC-7 第一步：组织内候选运行，未过滤权限）。
 *
 * 读四张表：workflow_instances（状态 / 发起人 / 发起 Agent）、workflow_definition_versions（title = Workflow 名）、
 * workflow_events 的 seq=1 instance_started（发起输入里的 projectId / 发起对象标签）、agents（参与 Agent 显示名）。
 * 非管理员由调用方传 initiatorUserId 在 LIMIT 之前收窄；最终权限仍由 application 层 canView 过滤后才投影（I-C12）。
 * 已知缺口：运行时尚未持久化交接链，agents 只含发起 Agent，avatarUrl / digitalHumanId 恒为 null。
 * 只返回标识与显示名，不返回任何 Agent 指令或阶段产出内容。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { BoardRunSource } from "../../application/board/list-board-run-cards";
import type { VisibleRunSummary } from "../../domain/board/workflow-run-card";
import { toOrgId } from "../../domain/org-id";

interface RunRow {
  id: string;
  status: VisibleRunSummary["status"];
  initiator_user_id: string;
  agent_id: string;
  workflow_name: string;
  agent_name: string | null;
  project_id: string | null;
  subject_label: string | null;
}

export class PgBoardRunSource implements BoardRunSource {
  constructor(private readonly db: DatabasePort) {}

  listRuns(orgId: string, projectId: string | null, initiatorUserId: string | null): Promise<VisibleRunSummary[]> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<RunRow>(
        `SELECT i.id, i.status, i.initiator_user_id, i.agent_id,
                v.title AS workflow_name, a.name AS agent_name,
                e.data->'input'->>'projectId' AS project_id,
                COALESCE(e.data->'input'->>'subjectLabel', e.data->'input'->>'title') AS subject_label
           FROM workflow_instances i
           JOIN workflow_definition_versions v
             ON v.org_id = i.org_id AND v.key = i.workflow_key AND v.version = i.definition_version
           LEFT JOIN workflow_events e ON e.org_id = i.org_id AND e.instance_id = i.id AND e.seq = 1
           LEFT JOIN agents a ON a.org_id = i.org_id AND a.id = i.agent_id
          WHERE i.org_id = $1
            AND ($2::text IS NULL OR e.data->'input'->>'projectId' = $2)
            AND ($3::text IS NULL OR i.initiator_user_id = $3)
          ORDER BY i.created_at DESC, i.id
          LIMIT 500`,
        [orgId, projectId, initiatorUserId],
      );
      return rows.map((r) => ({
        instanceId: r.id,
        workflowName: r.workflow_name,
        subjectLabel: r.subject_label,
        status: r.status,
        initiatorUserId: r.initiator_user_id,
        agents: [{ agentId: r.agent_id, digitalHumanId: null, displayName: r.agent_name ?? r.agent_id, avatarUrl: null }],
        projectId: r.project_id,
      }));
    });
  }
}
