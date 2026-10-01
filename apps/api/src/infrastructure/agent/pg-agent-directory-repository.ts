/**
 * AG04 —— `listAgentDirectory` / `getAgentDirectoryCard` 落库读。
 *
 * 读**已发布版本**（`agent_versions`，经 `agents.published_version_id`）的角色冻结列——
 * 目录是给成员看的「当前生效」形态，不是草稿（草稿只在管理端 `getAgentRoleAdmin` 里出现）。
 * 可见范围联 `capability_listings`：`id = agents.id` 是官方角色包导入时写下的同一行
 * （见 `pg-official-agent-role-pack-import-repository.ts`），`scope='org-wide' AND enabled`
 * 才进目录（AR13 同款 fail-closed，见用例文件头）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId, type OrgId } from "../../domain/org-id";
import type { AgentDirectoryRepository, AgentDirectoryRow } from "../../application/agent/list-agent-directory";
import { AGENT_ROLE_COLUMN_OF, toRoleFieldsTolerant, type AgentRoleColumnsRow } from "./agent-version-insert";

/**
 * 角色列取发布快照；`tags` 例外：官方 Agent 的标签是组织策展元数据（管理员在 `agents.tags` 上改，
 * 发布快照不可变），所以官方 Agent 读 `agents.tags`，组织自建 Agent 仍读发布快照。
 */
const roleCols = Object.values(AGENT_ROLE_COLUMN_OF)
  .map((c) => (c === "tags" ? "CASE WHEN a.catalog_source = 'official' THEN a.tags ELSE v.tags END AS tags" : `v.${c}`))
  .join(", ");

interface Row extends AgentRoleColumnsRow {
  agent_id: string;
  version_id: string;
  name: string;
  role_label: string;
  tool_policy: readonly unknown[];
  duty: string | null;
  abbr: string | null;
  skill_mounts: unknown;
  skill_version_ids: readonly string[] | null;
}

const SELECT = `
  SELECT a.id AS agent_id, v.id AS version_id, a.name, a.role_label, v.tool_policy,
         cl.duty, CASE WHEN a.catalog_source = 'official' THEN cl.abbr END AS abbr,
         a.skill_mounts, v.skill_version_ids, ${roleCols}
    FROM agents a
    JOIN agent_versions v
      ON v.id = a.published_version_id AND v.agent_id = a.id AND v.org_id = a.org_id
    JOIN capability_listings cl
      ON cl.id = a.id AND cl.org_id = a.org_id
   WHERE a.org_id = $1 AND a.status = 'enabled' AND cl.kind = 'agent'
     AND cl.scope = 'org-wide' AND cl.enabled = true`;

/** `agents.skill_mounts` 是 `[{skillId, skillVersion}]` jsonb；形状不对的元素直接跳过（容错读，不抛）。 */
function skillIdsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m) => (m && typeof m === "object" && typeof (m as { skillId?: unknown }).skillId === "string" ? [(m as { skillId: string }).skillId] : []));
}

function toRow(row: Row): AgentDirectoryRow {
  const fields = toRoleFieldsTolerant(row, row.agent_id);
  return {
    agentId: row.agent_id,
    versionId: row.version_id,
    name: row.name,
    roleLabel: row.role_label,
    avatar: fields.avatar,
    // UIUX r4：没有角色分类的组织可见 Agent（系统预置「通用助手」、组织自建）归入「通用」，
    // 不再被目录整个挡在外面——它们对成员可用，目录不列就找不到。
    roleCategory: fields.roleCategory ?? "general",
    tags: fields.tags,
    catalogSource: fields.catalogSource,
    workflowAllowlist: fields.workflowAllowlist,
    toolPolicyLength: Array.isArray(row.tool_policy) ? row.tool_policy.length : 0,
    duty: row.duty,
    roleRef: row.abbr,
    skillMountIds: skillIdsOf(row.skill_mounts),
    skillVersionIds: Array.isArray(row.skill_version_ids) ? row.skill_version_ids.filter((id) => typeof id === "string") : [],
    delegationTargetRefs: [...fields.delegationPolicy.allowedTargets],
    requireApprovalForHandoff: fields.delegationPolicy.requireApproval,
  };
}

export class PgAgentDirectoryRepository implements AgentDirectoryRepository {
  constructor(private readonly db: DatabasePort) {}

  async listVisible(orgId: OrgId): Promise<readonly AgentDirectoryRow[]> {
    return this.db.withTenant(toOrgId(orgId), async (session) => {
      const result = await session.query<Row>(`${SELECT} ORDER BY a.name`, [orgId]);
      return result.rows.map(toRow);
    });
  }

  async findVisible(orgId: OrgId, agentId: string): Promise<AgentDirectoryRow | null> {
    return this.db.withTenant(toOrgId(orgId), async (session) => {
      const result = await session.query<Row>(`${SELECT} AND a.id = $2`, [orgId, agentId]);
      const row = result.rows[0];
      return row === undefined ? null : toRow(row);
    });
  }
}
