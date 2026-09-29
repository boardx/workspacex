/**
 * CT10 —— `BoardRunSource` 的 PostgreSQL 适配器（UC-WC-7 第一步：组织内候选运行，未过滤权限）。
 *
 * 读六张表：
 * - workflow_instances（状态 / 发起人 / 发起 Agent）、workflow_definition_versions（title = Workflow 名）、
 *   workflow_events 的 seq=1 instance_started（发起输入里的 projectId / 发起对象标签）；
 * - 参与 Agent 链：发起 Agent 在前，其后是 workflow_receipts 里已 finalize 的副作用 receipt 的
 *   `stable_response.provenance.agentId`（EffectGateway 写入的执行 provenance），按首次出现先后去重——
 *   这是运行时真实持久化的「谁在这次运行里干了活」，即 ui.md「发起 Agent + 转交链」的数据来源；
 * - agents（显示名、`avatar->>'key'` 插画头像）与 capability_listings（官方 Agent 的 `abbr` = 数字人编号 D0xx）。
 *
 * 非管理员由调用方传 initiatorUserId 在 LIMIT 之前收窄；最终权限仍由 application 层 canView 过滤后才投影（I-C12）。
 *
 * ⚠ projectId 过滤信任的是发起输入 `e.data->'input'->>'projectId'`——本文件**不**校验该项目存在、也不校验
 * 查看者能看该项目。这只因为可见性的唯一边界是 application 层的 WF03 `canView`（发起人本人或组织管理员）：
 * 发起人本来就能看自己的运行，管理员本来就能看全部，projectId 只是在已可见集合里再切片，不可能放大可见集。
 * 若 canView 以后放宽到「项目成员可见」，这里必须改成校验项目归属——由
 * tests/work-content/board-run-source-e2e.test.ts「伪造 projectId 不放大可见集」钉住。
 *
 * 只返回标识与显示名 / 头像 key，不返回任何 Agent 指令或阶段产出内容。
 */
import { workContent } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import type { BoardRunSource } from "../../application/board/list-board-run-cards";
import type { RunCardAgent, VisibleRunSummary } from "../../domain/board/workflow-run-card";
import { toOrgId } from "../../domain/org-id";

interface RunRow {
  id: string;
  status: VisibleRunSummary["status"];
  initiator_user_id: string;
  agent_id: string;
  workflow_name: string;
  project_id: string | null;
  subject_label: string | null;
}

interface ParticipantRow {
  instance_id: string;
  agent_id: string;
}

interface AgentRow {
  id: string;
  name: string;
  avatar_key: string | null;
  role_ref: string | null;
}

const AvatarKeySchema = workContent.BoardRunCardAgent.shape.avatarKey;
const DigitalHumanSchema = workContent.BoardRunCardAgent.shape.digitalHumanId;

function toAgent(agentId: string, row: AgentRow | undefined): RunCardAgent {
  const key = AvatarKeySchema.safeParse(row?.avatar_key ?? null);
  const dh = DigitalHumanSchema.safeParse(row?.role_ref ?? null);
  return {
    agentId,
    digitalHumanId: dh.success ? dh.data : null,
    displayName: row?.name ?? agentId,
    avatarKey: key.success ? key.data : null,
    avatarUrl: null,
  };
}

export class PgBoardRunSource implements BoardRunSource {
  constructor(private readonly db: DatabasePort) {}

  listRuns(orgId: string, projectId: string | null, initiatorUserId: string | null): Promise<VisibleRunSummary[]> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<RunRow>(
        `SELECT i.id, i.status, i.initiator_user_id, i.agent_id,
                v.title AS workflow_name,
                e.data->'input'->>'projectId' AS project_id,
                COALESCE(e.data->'input'->>'subjectLabel', e.data->'input'->>'title') AS subject_label
           FROM workflow_instances i
           JOIN workflow_definition_versions v
             ON v.org_id = i.org_id AND v.key = i.workflow_key AND v.version = i.definition_version
           LEFT JOIN workflow_events e ON e.org_id = i.org_id AND e.instance_id = i.id AND e.seq = 1
          WHERE i.org_id = $1
            AND ($2::text IS NULL OR e.data->'input'->>'projectId' = $2)
            AND ($3::text IS NULL OR i.initiator_user_id = $3)
          ORDER BY i.created_at DESC, i.id
          LIMIT 500`,
        [orgId, projectId, initiatorUserId],
      );
      if (rows.length === 0) return [];
      const instanceIds = rows.map((r) => r.id);

      const { rows: participants } = await s.query<ParticipantRow>(
        `SELECT r.instance_id, r.stable_response->'provenance'->>'agentId' AS agent_id
           FROM workflow_receipts r
          WHERE r.org_id = $1 AND r.scope = 'effect' AND r.status = 'finalized'
            AND r.instance_id = ANY($2::text[])
            AND r.stable_response->'provenance'->>'agentId' IS NOT NULL
          ORDER BY r.instance_id, r.created_at, r.request_key`,
        [orgId, instanceIds],
      );
      const chain = new Map<string, string[]>(rows.map((r) => [r.id, [r.agent_id]]));
      for (const p of participants) {
        const list = chain.get(p.instance_id);
        if (list && !list.includes(p.agent_id)) list.push(p.agent_id);
      }

      const agentIds = [...new Set([...chain.values()].flat())];
      const { rows: agentRows } = await s.query<AgentRow>(
        `SELECT a.id, a.name, a.avatar->>'key' AS avatar_key,
                CASE WHEN a.catalog_source = 'official' THEN l.abbr END AS role_ref
           FROM agents a
           LEFT JOIN capability_listings l ON l.org_id = a.org_id AND l.id = a.id AND l.kind = 'agent'
          WHERE a.org_id = $1 AND a.id = ANY($2::text[])`,
        [orgId, agentIds],
      );
      const byId = new Map(agentRows.map((a) => [a.id, a]));

      return rows.map((r) => ({
        instanceId: r.id,
        workflowName: r.workflow_name,
        subjectLabel: r.subject_label,
        status: r.status,
        initiatorUserId: r.initiator_user_id,
        agents: (chain.get(r.id) ?? [r.agent_id]).map((id) => toAgent(id, byId.get(id))),
        projectId: r.project_id,
      }));
    });
  }
}
