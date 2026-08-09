/**
 * #660 —— `selfPublishToollessAgent` 的落库。**⚠⚠ 草案边，尚未经人类签核**（AR11）。
 *
 * ## 落库形状照抄已验证的那一条，不新造
 *
 * 「一个 agent 变成真的能跑」在本仓已经有**一条被反复验证过**的形状
 * （`pg-agent-starter-import-repository.ts` → `ensureSystemAgent` → 本文件）：
 *
 *   ① 一行 `agent_versions`（`published_at` 非空、不可变）
 *   ② `agents.published_version_id` 指过去
 *   ③ 一行 `capability_listings`（**`id = agentId`**）
 *
 * ③ 的 id 相等不是可有可无：chat 选择器把 `listCapabilities` 返回的 `row.id` 原样
 * 当 `agentId` 发消息，而后端 `PgPublishedAgentReader` 按 `agents.id` 查。两个 id
 * 不相等 ⇒ 选出来的 agent 发消息就是 422，#660 等于没修（`ensure-default-agent.ts`
 * 头注里逐字记过这条教训）。
 *
 * ## ⚠ 三步在同一个事务里
 *
 * `withTenant` 的回调是一个事务。半途失败必须整体回滚——留下"有版本但
 * `published_version_id` 还是 NULL"或者"能在目录里选到但发消息 422"的行，
 * 比干脆失败更难查。
 *
 * ## `semantic_label` 为什么是 `自助发布-v1`
 *
 * 契约要求这样发布出来的版本**在审计里可与双人评审发出的版本分辨**
 * （`selfPublishToollessAgent.out.publishRoute`）。`agent_versions` 没有
 * "发布路径"这一列，而**加一列是 schema 变更、要等签核**；`semantic_label` 是
 * 现成的、每 (org, agent) 唯一的自由文本列，用它承载这个事实不需要动 schema。
 * ⚠ 这是**权宜**，如实记在这里：签核通过后若要正式化，应该加一列显式的
 * `publish_route`，而不是让审计去 `LIKE '自助发布%'`。
 *
 * ## `instructions` 从哪来
 *
 * `agent_versions.instructions` NOT NULL，而草稿 agent 没有"指令"这个字段——
 * `createAgent.in` 收的是 `name` / `role`（「我自己建的助手」这类）。这里用用户
 * **自己填的那两项**拼出系统提示词，不是编一段默认人格：拼出来的每一个字都来自
 * 用户输入，改了 `role` 再发一版就会变。⚠ 不是 mock，也不是静默兜底。
 */
import { createHash, randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type { AgentDefinition } from "../../domain/agent/definition";
import type { SelfPublishAgentRepository } from "../../application/agent/self-publish-toolless-agent";
import {
  AGENT_DEFINITION_COLUMNS,
  toDefinition,
  type AgentDefinitionRow,
} from "./pg-create-agent-repository";
import { resolveDeepAgentModel } from "./pg-default-agent-repository";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** ⚠ 审计可分辨性靠这个前缀，见文件头注的权宜说明。 */
export const SELF_PUBLISH_SEMANTIC_LABEL = "自助发布-v1";

/**
 * 由用户自己填的 `name` / `role` 拼出系统提示词。
 * 导出是为了让测试断言"这一版的 instructions 确实来自用户输入"，
 * 而不是断言一个抄在测试里的字面量（那样两边会一起漂）。
 */
export function selfPublishedInstructions(agent: Pick<AgentDefinition, "name" | "role">): string {
  return `你是「${agent.name}」，${agent.role}。请友好、简洁、诚实地完成用户交给你的任务；遇到你不确定或做不到的事，直接说明，不要编造。`;
}

export class PgSelfPublishAgentRepository implements SelfPublishAgentRepository {
  constructor(private readonly db: DatabasePort) {}

  async findForSelfPublish(orgId: string, agentId: string): Promise<AgentDefinition | null> {
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

  async publish(input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<{ readonly agentVersionId: string }> {
    return this.db.withTenant(toOrgId(input.orgId), async (session) => {
      // 同一事务内重新读一次并上行锁：授权与判定发生在这之前，两者之间可能有
      // 并发的第二次 self-publish。`FOR UPDATE` + 下面的 `publish_state='草稿'`
      // 条件让第二次落到 0 行更新 ⇒ 抛错，而不是铸出第二个版本。
      const found = await session.query<AgentDefinitionRow>(
        `SELECT ${AGENT_DEFINITION_COLUMNS}
           FROM agents
          WHERE id = $1 AND org_id = $2
          FOR UPDATE`,
        [input.agentId, input.orgId],
      );
      const definition = found.rows[0] === undefined ? null : toDefinition(found.rows[0]);
      if (definition === null) throw new Error("self_publish_agent_row_vanished");

      const versionId = `agent-version-${randomUUID()}`;
      const nowIso = input.now.toISOString();
      const instructions = selfPublishedInstructions(definition);
      const { provider, modelId } = resolveDeepAgentModel();

      await session.query(
        `INSERT INTO agent_versions
           (id,org_id,agent_id,semantic_label,instruction_digest,instructions,
            skill_version_ids,model_provider,model_id,tool_policy,creator_id,
            created_at,published_at)
         VALUES ($1,$2,$3,$4,$5,$6,'{}'::text[],$7,$8,'[]'::jsonb,$9,$10,$10)`,
        [
          versionId,
          input.orgId,
          input.agentId,
          SELF_PUBLISH_SEMANTIC_LABEL,
          sha256(instructions),
          instructions,
          provider,
          modelId,
          input.actorId,
          nowIso,
        ],
      );

      // ⚠ `publish_state` 与 `published_version_id` **同一条 UPDATE**：只改前者
      // 会让界面显示"运行中"而 `resolvePublished` 的 JOIN 依然查不到 ⇒ 发消息仍是 422
      // （见证测试的 C 反证盯的就是这一刀）。
      // ⚠ `publish_state='草稿'` 是并发保护：第二次调用更新 0 行。
      // ⚠ `RETURNING id` 而不是看受影响行数：`TenantSession.query` 的返回形状只有
      //   `rows`（见 `database.port.ts`），没有 `rowCount`。
      const updated = await session.query<{ id: string }>(
        `UPDATE agents
            SET publish_state = '运行中', published_version_id = $3, updated_at = $4
          WHERE id = $1 AND org_id = $2 AND publish_state = '草稿'
      RETURNING id`,
        [input.agentId, input.orgId, versionId, nowIso],
      );
      if (updated.rows.length !== 1) throw new Error("self_publish_agent_not_draft_anymore");

      // ③ 能力目录。`id = agentId`（见文件头注）。`scope` 恒 `org-wide`：
      //    `仅某组` 在 domain 门那一步就已经被 `AGENT_VISIBILITY_UNSUPPORTED` 拒掉，
      //    所以这里不会、也不该出现 `team-only`。
      await session.query(
        `INSERT INTO capability_listings (id,org_id,kind,name,scope,owner_team_id,enabled,endpoint)
         VALUES ($1,$2,'agent',$3,'org-wide',NULL,true,NULL)`,
        [input.agentId, input.orgId, definition.name],
      );

      return { agentVersionId: versionId };
    });
  }
}
