/**
 * AG01（契约束 agent-role，ADR-116 #3）—— `agent_versions` 的**唯一**插入语句。
 *
 * 七个角色冻结列（avatar/role_category/catalog_source/workflow_allowlist/delegation_policy/
 * escalation_policy/kpi）在发布那一刻从同一 agent 的 `agents` 草稿行原样拷入。之前五处写路径
 * 各自手写 `INSERT INTO agent_versions (...)`，新列一加就全部漏掉（发布行永远拿列默认值）；
 * 收敛为这一个函数后，「发布快照含草稿角色字段」只有一处实现。
 *
 * `INSERT ... SELECT ... FROM agents` 而不是 VALUES：拷贝发生在同一条语句里，
 * 没有「先读草稿、再写版本」之间的窗口。来源行不存在 ⇒ 插入 0 行 ⇒ 抛错，不静默成功。
 */
import { agentRole } from "@repo/contracts";
import type { TenantSession } from "../../application/ports/database.port";
import type { AgentRoleFieldsT } from "../../domain/agent/definition";

/** 列名 ↔ 契约字段名。顺序即 SELECT 顺序。 */
export const AGENT_ROLE_COLUMN_OF = {
  avatar: "avatar",
  roleCategory: "role_category",
  catalogSource: "catalog_source",
  workflowAllowlist: "workflow_allowlist",
  delegationPolicy: "delegation_policy",
  escalationPolicy: "escalation_policy",
  kpi: "kpi",
} as const satisfies Record<(typeof agentRole.AGENT_ROLE_FROZEN_FIELDS)[number], string>;

export const AGENT_ROLE_COLUMNS = Object.values(AGENT_ROLE_COLUMN_OF).join(", ");

export interface AgentRoleColumnsRow {
  readonly avatar: unknown;
  readonly role_category: string | null;
  readonly catalog_source: string;
  readonly workflow_allowlist: readonly string[];
  readonly delegation_policy: unknown;
  readonly escalation_policy: unknown;
  readonly kpi: unknown;
}

/** 行 → 契约形状。过一遍契约 schema：库里的值若比契约宽（见迁移头注），读侧当场炸而不是带病传播。 */
export function toRoleFields(row: AgentRoleColumnsRow): AgentRoleFieldsT {
  return agentRole.AgentRoleFields.parse({
    avatar: row.avatar,
    roleCategory: row.role_category,
    catalogSource: row.catalog_source,
    workflowAllowlist: row.workflow_allowlist,
    delegationPolicy: row.delegation_policy,
    escalationPolicy: row.escalation_policy,
    kpi: row.kpi,
  });
}

export interface AgentVersionInsert {
  readonly versionId: string;
  readonly orgId: string;
  readonly agentId: string;
  readonly semanticLabel: string;
  readonly instructionDigest: string;
  readonly instructions: string;
  readonly skillVersionIds: readonly string[];
  readonly modelProvider: string;
  readonly modelId: string;
  /** 已是 JSON 可序列化的值；本函数负责 stringify。 */
  readonly toolPolicy: unknown;
  readonly creatorId: string;
  /** created_at = published_at。 */
  readonly at: string;
  /**
   * 角色列从哪一行拷：默认 `agents` 草稿（发布 = 冻结当前草稿）。只在已发布版本上追加
   * skill pin 的写路径传 `roleFromVersionId`——它沿用基线版本的指令/模型，角色也必须沿用基线，
   * 否则未经发布审核的草稿改动会借 pin 混进新版本。
   */
  readonly roleFromVersionId?: string;
}

export async function insertAgentVersionFromDraft(
  session: TenantSession,
  v: AgentVersionInsert,
): Promise<void> {
  const draftCols = Object.values(AGENT_ROLE_COLUMN_OF).map((c) => `d.${c}`).join(", ");
  const inserted = await session.query<{ id: string }>(
    `INSERT INTO agent_versions
       (id, org_id, agent_id, semantic_label, instruction_digest, instructions,
        skill_version_ids, model_provider, model_id, tool_policy, creator_id,
        created_at, published_at, ${AGENT_ROLE_COLUMNS})
     SELECT $1::text, $2::text, $3::text, $4::text, $5::text, $6::text,
            $7::text[], $8::text, $9::text, $10::jsonb, $11::text,
            $12::timestamptz, $12::timestamptz, ${draftCols}
       FROM ${v.roleFromVersionId === undefined ? "agents" : "agent_versions"} d
      WHERE ${v.roleFromVersionId === undefined
        ? "d.id = $3 AND d.org_id = $2"
        : "d.id = $13 AND d.org_id = $2 AND d.agent_id = $3"}
  RETURNING id`,
    [
      v.versionId, v.orgId, v.agentId, v.semanticLabel, v.instructionDigest, v.instructions,
      [...v.skillVersionIds], v.modelProvider, v.modelId, JSON.stringify(v.toolPolicy), v.creatorId,
      v.at,
      ...(v.roleFromVersionId === undefined ? [] : [v.roleFromVersionId]),
    ],
  );
  if (inserted.rows.length !== 1) throw new Error("agent_version_insert_role_source_missing");
}
