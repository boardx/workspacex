/**
 * #617 —— `createAgent` 的落库实现。
 *
 * 复用 20260804150000_wave2_agent_starter_import.sql 建的 `agents` 表（本仓「执行侧」
 * agent 定义的单一事实源），20260807030000_i617_create_agent.sql 给它加了
 * `AgentDefinition` 需要的列（initials/role/visibility/clone_from/source/publish_state/
 * model_id/concurrency_limit/degrade_policy/tool_whitelist/skill_mounts）。
 *
 * ⚠ 不写 `agent_versions`——那张表的行是"已发布版本"，一个刚新建的草稿没有版本
 * （见迁移文件头的理由）。`agents.published_version_id` 对新建的行保持 NULL。
 *
 * ⚠ 不写 `capability_listings`（F15 的能力目录）——那是"可被选用的已发布能力"，
 * 一个 `toolWhitelist` 恒为空、`发布` 都还没提交的 草稿态 agent 不应该出现在那张表里
 * （否则会在未来某条 `listAgents`/能力目录读取路径上让一个不可用的 agent 看起来可用）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type { AgentDefinition } from "../../domain/agent/definition";
import type { CreateAgentRepository } from "../../application/agent/create-agent";

interface AgentDefinitionRow {
  readonly id: string;
  readonly org_id: string;
  readonly name: string;
  readonly initials: string | null;
  readonly role: string | null;
  readonly visibility: string | null;
  readonly clone_from: string | null;
  readonly source: string | null;
  readonly publish_state: string | null;
  readonly model_id: string | null;
  readonly skill_mounts: unknown;
  readonly tool_whitelist: unknown;
  readonly concurrency_limit: number | null;
  readonly degrade_policy: string | null;
}

function toDefinition(row: AgentDefinitionRow): AgentDefinition | null {
  // A row this repository did not create (e.g. an agent-starter-import row, which never
  // fills these columns) is not a valid clone source: it has no visibility/source/publish
  // state to build a definition from. Treating it as "not found" rather than throwing keeps
  // the clone path's error surface at the single AGENT_NOT_FOUND the contract declares.
  if (
    row.initials === null ||
    row.role === null ||
    row.visibility === null ||
    row.source === null ||
    row.publish_state === null ||
    row.concurrency_limit === null ||
    row.degrade_policy === null
  ) {
    return null;
  }
  return {
    agentId: row.id,
    orgId: row.org_id,
    name: row.name,
    initials: row.initials,
    role: row.role,
    visibility: row.visibility as AgentDefinition["visibility"],
    cloneFrom: row.clone_from,
    source: row.source as AgentDefinition["source"],
    publishState: row.publish_state as AgentDefinition["publishState"],
    modelId: row.model_id,
    skillMounts: (row.skill_mounts as AgentDefinition["skillMounts"]) ?? [],
    toolWhitelist: (row.tool_whitelist as AgentDefinition["toolWhitelist"]) ?? [],
    concurrencyLimit: row.concurrency_limit,
    degradePolicy: row.degrade_policy as AgentDefinition["degradePolicy"],
  };
}

let counter = 0;
/** Monotonic-ish suffix so ids generated within the same millisecond in tests still differ. */
function nextId(): string {
  counter += 1;
  return `agent-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class PgCreateAgentRepository implements CreateAgentRepository {
  constructor(private readonly db: DatabasePort) {}

  newAgentId(): string {
    return nextId();
  }

  async findForClone(orgId: string, agentId: string): Promise<AgentDefinition | null> {
    return this.db.withTenant(toOrgId(orgId), async (session) => {
      const found = await session.query<AgentDefinitionRow>(
        `SELECT id, org_id, name, initials, role, visibility, clone_from, source,
                publish_state, model_id, skill_mounts, tool_whitelist, concurrency_limit,
                degrade_policy
           FROM agents
          WHERE id = $1 AND org_id = $2`,
        [agentId, orgId],
      );
      const row = found.rows[0];
      return row === undefined ? null : toDefinition(row);
    });
  }

  async insert(definition: AgentDefinition, actorId: string): Promise<void> {
    await this.db.withTenant(toOrgId(definition.orgId), async (session) => {
      const now = new Date().toISOString();
      // `stable_name`/`status` are the agent-starter-import flow's columns
      // (`agents_stable_name_uniq`/`agents_name_casefold_uniq` are both NOT NULL / hard
      // constraints on this shared table). `createAgent` has no stable-name concept of its
      // own, so the internal, never-user-facing `agentId` doubles as it -- guaranteed
      // unique by construction, unlike slugifying the display name.
      await session.query(
        `INSERT INTO agents
           (id, org_id, stable_name, name, status, creator_id, created_at, updated_at,
            published_version_id, initials, role, visibility, clone_from, source,
            publish_state, model_id, skill_mounts, tool_whitelist, concurrency_limit,
            degrade_policy)
         VALUES ($1,$2,$1,$3,'enabled',$4,$5,$5,NULL,$6,$7,$8,$9,$10,$11,$12,
                 $13::jsonb,$14::jsonb,$15,$16)`,
        [
          definition.agentId,
          definition.orgId,
          definition.name,
          actorId,
          now,
          definition.initials,
          definition.role,
          definition.visibility,
          definition.cloneFrom,
          definition.source,
          definition.publishState,
          definition.modelId,
          JSON.stringify(definition.skillMounts),
          JSON.stringify(definition.toolWhitelist),
          definition.concurrencyLimit,
          definition.degradePolicy,
        ],
      );
    });
  }
}
