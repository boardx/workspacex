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
import type { AgentCapabilityGraphRow, CreateAgentRepository } from "../../application/agent/create-agent";
import type { SetAgentInstructionsRepository } from "../../application/agent/set-agent-instructions";
import type {
  AgentListRow,
  ListAgentsFilters,
  ListAgentsRepository,
} from "../../application/agent/list-agents";

/**
 * ⚠ #660 起，行→定义的映射被 `pg-self-publish-agent-repository.ts` 复用（`export`）。
 * 复用而不是各写一份，是因为「哪些列为 NULL 就说明这一行不是 `createAgent` 建的」
 * 这条判据（见下方 `toDefinition`）是**同一个事实**：自助发布同样只对
 * `createAgent` 建出来的行有意义，一个 starter-import 行也拿不到 `toolWhitelist`
 * 这些列，若两处各判一次，迟早一处会把 NULL 当成"空白名单"而放行。
 */
export interface AgentDefinitionRow {
  readonly id: string;
  readonly org_id: string;
  readonly name: string;
  readonly initials: string | null;
  readonly role: string | null;
  /**
   * #1705。列本身允许 NULL（迁移 `20260821180000_i1705_agent_role_label.sql` 头注：
   * 刻意不对整张 `agents` 表加 NOT NULL，避免连带破坏其它写路径/测试）——
   * `createAgent` 这条写路径通过契约 `.min(1)` + 应用层保证非空，
   * 但一行 `agents` 未必是经 `createAgent` 建的，读侧不能假设非空。
   */
  readonly role_label: string | null;
  readonly role_label_needs_confirmation: boolean;
  readonly instructions: string | null;
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

/**
 * #1918 hotfix（#1923）—— `findForCapabilityGraph` 的窄行形状。刻意不复用
 * `AgentDefinitionRow`：那个类型的字段集合是为 `toDefinition` 的七列判据服务的，
 * 混进同一个类型容易让人以为能力图也要过那组判据。
 */
interface CapabilityGraphColumnsRow {
  readonly id: string;
  readonly name: string;
  readonly role_label: string | null;
  readonly skill_mounts: unknown;
  readonly tool_whitelist: unknown;
}

export const AGENT_DEFINITION_COLUMNS =
  `id, org_id, name, initials, role, role_label, role_label_needs_confirmation, visibility,
   clone_from, source, publish_state, model_id, skill_mounts, tool_whitelist, concurrency_limit,
   degrade_policy, instructions`;

export function toDefinition(row: AgentDefinitionRow): AgentDefinition | null {
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
    // ⚠ #1705：`role_label` 列允许 NULL（见字段注释），且**不**参与上面那组
    // "这一行不是 createAgent 建的"判据——那组判据靠的是 #617 那批只在 createAgent
    // 落库的列。`createAgent` 写路径本身通过契约保证非空，但一行没有 role_label
    // 的合法 `AgentDefinition` 仍然读得出来（同其它可为默认值的字段），空字符串
    // 兜底而不是抛错——一个读路径不该因为某条其它写路径没填这个字段而整体炸掉。
    roleLabel: row.role_label ?? "",
    roleLabelNeedsConfirmation: row.role_label_needs_confirmation,
    // ⚠ NULL 是合法值（「还没配可执行定义」），不参与上面那组"这一行不是 createAgent
    // 建的"判据——那组判的是 #617 那批列，而 instructions 是 #660 才加的，
    // 存量行本来就该是 NULL。
    instructions: row.instructions,
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

export class PgCreateAgentRepository implements CreateAgentRepository, ListAgentsRepository {
  constructor(private readonly db: DatabasePort) {}

  newAgentId(): string {
    return nextId();
  }

  async findForClone(orgId: string, agentId: string): Promise<AgentDefinition | null> {
    return this.db.withTenant(toOrgId(orgId), async (session) => {
      const found = await session.query<AgentDefinitionRow>(
        `SELECT ${AGENT_DEFINITION_COLUMNS}
           FROM agents
          WHERE id = $1 AND org_id = $2`,
        [agentId, orgId],
      );
      const row = found.rows[0];
      return row === undefined ? null : toDefinition(row);
    });
  }

  /**
   * #1918 hotfix（#1923）—— 能力图只读路径，**不**经过 `toDefinition` 的
   * 「七列非空才算数」判据（那条判据是为「能不能当克隆源」服务的）。只要这一行
   * 存在（同组织），就能读出能力图要用的几个字段——`role_label`/`skill_mounts`/
   * `tool_whitelist` 允许为 NULL，分别兜底成 `""`/`[]`/`[]`，与 `toDefinition`
   * 对这几列的兜底逻辑一致（它们本就不参与那组七列判据）。
   *
   * ⚠ `listAgents`（#1915，下方 `list()`）与 `cloneFrom`（`findForClone` 上方）
   * 都**不**照抄这条宽松判据——克隆源必须是「可被复制的完整定义」，`listAgents`
   * 的整条 SQL 谓词也是同一条七列判据的 SQL 化（见 `list()` 头注），两者刻意保持
   * 与 `toDefinition` 一致的严格口径。宽松只属于「只读展示」这一条路径。
   */
  async findForCapabilityGraph(orgId: string, agentId: string): Promise<AgentCapabilityGraphRow | null> {
    return this.db.withTenant(toOrgId(orgId), async (session) => {
      const found = await session.query<CapabilityGraphColumnsRow>(
        `SELECT id, name, role_label, skill_mounts, tool_whitelist
           FROM agents
          WHERE id = $1 AND org_id = $2`,
        [agentId, orgId],
      );
      const row = found.rows[0];
      if (row === undefined) return null;
      return {
        agentId: row.id,
        name: row.name,
        roleLabel: row.role_label ?? "",
        skillMounts: (row.skill_mounts as AgentDefinition["skillMounts"]) ?? [],
        toolWhitelist: (row.tool_whitelist as AgentDefinition["toolWhitelist"]) ?? [],
      };
    });
  }

  /**
   * `listAgents`（#1915）——F55 Agent 库的读路径。
   *
   * `WHERE initials IS NOT NULL` 起的那一段谓词与 `toDefinition` 的 null 判据同一个
   * 理由：把一行是否经 `createAgent` 落库这件事写死在 SQL 里，而不是查出全部行、
   * 拿到应用层再逐行判——那样会让一个 agent-starter-import 行（无 initials/role/
   * visibility/publish_state）在中间态里被短暂当成「查出来了只是过滤掉」，
   * 与「SQL 层面它本就不属于这条读路径」不是同一件事。
   *
   * ⚠ #1923 hotfix 之后新增了一条更宽松的 `findForCapabilityGraph`（上方），
   *   本方法**刻意不复用**它——「Agent 库列表」与「克隆源」都要求一个完整、
   *   可被复制的定义（同 `findForClone`/`toDefinition` 的七列判据），只有
   *   「能力图只读展示」这一种场景才需要放宽到「行存在就够」。混用会让一个
   *   `initials`/`role` 都还没配的补种行（如「通用助手」）出现在可克隆的列表里。
   *
   * `tag` 过滤器不接——`list-agents.ts` 头注「为什么 tag 过滤器不生效」是唯一事实源，
   * 这里不重复第二遍理由，只重复它的结论：不查那一列，因为那一列不存在。
   */
  async list(orgId: string, filters: ListAgentsFilters): Promise<readonly AgentListRow[]> {
    return this.db.withTenant(toOrgId(orgId), async (session) => {
      const conditions = [
        "org_id = $1",
        "initials IS NOT NULL",
        "role IS NOT NULL",
        "visibility IS NOT NULL",
        "publish_state IS NOT NULL",
      ];
      const params: unknown[] = [orgId];
      if (filters.publishState !== null) {
        params.push(filters.publishState);
        conditions.push(`publish_state = $${params.length}`);
      }
      if (filters.visibility !== null) {
        params.push(filters.visibility);
        conditions.push(`visibility = $${params.length}`);
      }
      const found = await session.query<{
        id: string;
        initials: string;
        name: string;
        role: string;
        role_label: string | null;
        visibility: string;
        publish_state: string;
        model_id: string | null;
        skill_mounts: unknown;
      }>(
        `SELECT id, initials, name, role, role_label, visibility, publish_state, model_id, skill_mounts
           FROM agents
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC`,
        params,
      );
      return found.rows.map((row) => ({
        agentId: row.id,
        initials: row.initials,
        name: row.name,
        role: row.role,
        roleLabel: row.role_label ?? "",
        visibility: row.visibility as AgentListRow["visibility"],
        publishState: row.publish_state as AgentListRow["publishState"],
        modelId: row.model_id,
        skillCount: Array.isArray(row.skill_mounts) ? row.skill_mounts.length : 0,
      }));
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
            published_version_id, initials, role, role_label, role_label_needs_confirmation,
            visibility, clone_from, source,
            publish_state, model_id, skill_mounts, tool_whitelist, concurrency_limit,
            degrade_policy, instructions)
         VALUES ($1,$2,$1,$3,'enabled',$4,$5,$5,NULL,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 $15::jsonb,$16::jsonb,$17,$18,$19)`,
        [
          definition.agentId,
          definition.orgId,
          definition.name,
          actorId,
          now,
          definition.initials,
          definition.role,
          definition.roleLabel,
          definition.roleLabelNeedsConfirmation,
          definition.visibility,
          definition.cloneFrom,
          definition.source,
          definition.publishState,
          definition.modelId,
          JSON.stringify(definition.skillMounts),
          JSON.stringify(definition.toolWhitelist),
          definition.concurrencyLimit,
          definition.degradePolicy,
          definition.instructions,
        ],
      );
    });
  }
}

/**
 * #660 候选 A —— `agents.instructions` 的写入。
 *
 * 放在本文件而不是新建一个仓储文件：它写的是**同一张表的同一行**，而
 * `lint-permission-paths` 的白名单条目是**按文件**登记的。多开一个文件就要多一条
 * 白名单条目 + 多一份守卫测试，而那条条目要讲的理由与本文件那条**逐字相同**
 * （写路径 + 授权在用例层且在仓储调用之前）。同一个理由登记两遍，正是本仓
 * 「同一事实不得声明在两处」要防的形状。
 *
 * ⚠ 本文件那条白名单条目的前提「只命名 `agents` 一张租户表」因此仍然成立，
 *   `create-agent-repo-guard.test.ts` 会继续机械校验它。
 */
export class PgSetAgentInstructionsRepository implements SetAgentInstructionsRepository {
  constructor(private readonly db: DatabasePort) {}

  async setInstructions(input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly instructions: string;
  }): Promise<boolean> {
    return this.db.withTenant(toOrgId(input.orgId), async (session) => {
      // ⚠ `RETURNING id` 而不是受影响行数：`TenantSession.query` 只回 `rows`。
      // 命中 0 行 ⇒ 该 org 下没有这个 agent ⇒ 用例抛 AGENT_NOT_FOUND，
      // **不是**静默成功。
      const updated = await session.query<{ id: string }>(
        `UPDATE agents SET instructions = $3, updated_at = $4
          WHERE id = $1 AND org_id = $2
      RETURNING id`,
        [input.agentId, input.orgId, input.instructions, new Date().toISOString()],
      );
      return updated.rows.length === 1;
    });
  }
}
