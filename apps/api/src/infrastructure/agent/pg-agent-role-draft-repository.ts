/**
 * AG01 —— `updateAgentRoleDraft` 的落库：读/写 `agents` 草稿角色 7 列，读当前已发布版本
 * （`agent_versions`，经 `agents.published_version_id`）的同 7 列作对照。
 *
 * 授权在用例层（`update-agent-role-draft.ts`）作为第一件事完成；本类只落库。
 * 写是条件 UPDATE：并发号与 `catalog_source='org'` 都在 WHERE 里，读后被改 ⇒ 0 行 ⇒ null。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type {
  AgentRoleDraftRepository,
  AgentRoleDraftState,
} from "../../application/agent/update-agent-role-draft";
import type { AgentRoleFieldsT } from "../../domain/agent/definition";
import { AGENT_ROLE_COLUMN_OF, toRoleFieldsTolerant, type AgentRoleColumnsRow } from "./agent-version-insert";

const cols = (alias: string, prefix: string): string =>
  Object.values(AGENT_ROLE_COLUMN_OF).map((c) => `${alias}.${c} AS ${prefix}${c}`).join(", ");

function pick(row: Record<string, unknown>, prefix: string): AgentRoleColumnsRow {
  const out: Record<string, unknown> = {};
  for (const c of Object.values(AGENT_ROLE_COLUMN_OF)) out[c] = row[`${prefix}${c}`];
  return out as unknown as AgentRoleColumnsRow;
}

export class PgAgentRoleDraftRepository implements AgentRoleDraftRepository {
  constructor(private readonly db: DatabasePort) {}

  async find(orgId: string, agentId: string): Promise<AgentRoleDraftState | null> {
    return this.db.withTenant(toOrgId(orgId), async (session) => {
      const found = await session.query<Record<string, unknown>>(
        `SELECT a.role_draft_version, v.id AS published_id, v.tool_policy, ${cols("a", "d_")}, ${cols("v", "p_")}
           FROM agents a
           LEFT JOIN agent_versions v
             ON v.id = a.published_version_id AND v.agent_id = a.id AND v.org_id = a.org_id
          WHERE a.id = $1 AND a.org_id = $2`,
        [agentId, orgId],
      );
      const row = found.rows[0];
      if (row === undefined) return null;
      return {
        draft: toRoleFieldsTolerant(pick(row, "d_"), agentId),
        published: row.published_id === null ? null : toRoleFieldsTolerant(pick(row, "p_"), agentId),
        version: Number(row.role_draft_version),
        // `tool_policy` 在导入时冻结进已发布版本；草稿编辑不改它（AG04 管理详情角色区块用）。
        toolPolicy: Array.isArray(row.tool_policy) ? (row.tool_policy as readonly string[]) : [],
      };
    });
  }

  async save(input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly expectedVersion: number;
    readonly fields: AgentRoleFieldsT;
  }): Promise<{ readonly version: number } | null> {
    const f = input.fields;
    return this.db.withTenant(toOrgId(input.orgId), async (session) => {
      const updated = await session.query<{ role_draft_version: number }>(
        `UPDATE agents
            SET avatar = $4::jsonb, role_category = $5, workflow_allowlist = $6::text[],
                delegation_policy = $7::jsonb, escalation_policy = $8::jsonb, kpi = $9::jsonb,
                role_draft_version = role_draft_version + 1, updated_at = now()
          WHERE id = $1 AND org_id = $2 AND role_draft_version = $3 AND catalog_source = 'org'
      RETURNING role_draft_version`,
        [
          input.agentId, input.orgId, input.expectedVersion,
          f.avatar === null ? null : JSON.stringify(f.avatar), f.roleCategory, [...f.workflowAllowlist],
          JSON.stringify(f.delegationPolicy), JSON.stringify(f.escalationPolicy), JSON.stringify(f.kpi),
        ],
      );
      const row = updated.rows[0];
      return row === undefined ? null : { version: Number(row.role_draft_version) };
    });
  }
}
