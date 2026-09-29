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

const roleCols = Object.values(AGENT_ROLE_COLUMN_OF).map((c) => `v.${c}`).join(", ");

interface Row extends AgentRoleColumnsRow {
  agent_id: string;
  version_id: string;
  name: string;
  role_label: string;
  tool_policy: readonly unknown[];
}

const SELECT = `
  SELECT a.id AS agent_id, v.id AS version_id, a.name, a.role_label, v.tool_policy, ${roleCols}
    FROM agents a
    JOIN agent_versions v
      ON v.id = a.published_version_id AND v.agent_id = a.id AND v.org_id = a.org_id
    JOIN capability_listings cl
      ON cl.id = a.id AND cl.org_id = a.org_id
   WHERE a.org_id = $1 AND a.status = 'enabled' AND cl.kind = 'agent'
     AND cl.scope = 'org-wide' AND cl.enabled = true AND v.role_category IS NOT NULL`;

function toRow(row: Row): AgentDirectoryRow {
  const fields = toRoleFieldsTolerant(row, row.agent_id);
  return {
    agentId: row.agent_id,
    versionId: row.version_id,
    name: row.name,
    roleLabel: row.role_label,
    avatar: fields.avatar,
    roleCategory: fields.roleCategory,
    catalogSource: fields.catalogSource,
    workflowAllowlist: fields.workflowAllowlist,
    toolPolicyLength: Array.isArray(row.tool_policy) ? row.tool_policy.length : 0,
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
