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
 * **`agents.instructions`，用户自己写的那一段**（#660 候选 A，人类 2026-08-11 签核；
 * 迁移 `20260811000000_i660_agent_instructions.sql`）。
 *
 * ⚠ 本文件**曾经**用 `name` + `role` 拼出一段系统提示词。那是错的，已删：
 *   `design-deltas/agent-instructions/design-signoff.md` 逐字禁止过这条捷径
 *   （人类 2026-08-09 裁决）——`role` 是「角色标签」不是「系统提示词」，
 *   运行时会**真的照着它执行**，属于会产生错误行为且难察觉的漂移。
 *   没有 instructions 的 agent 在 domain 门那一步就被
 *   `AGENT_NO_EXECUTABLE_DEFINITION` 拒了，**不在这里兜底**。
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
      // 用户自己写的那一段，原样铸进版本。domain 门已经保证它非空白；
      // 这里再判一次是为了让"仓储被单独调用"这条路径也不会写出空指令的版本。
      const instructions = (definition.instructions ?? "").trim();
      if (instructions === "") throw new Error("self_publish_agent_has_no_instructions");
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
      //
      // ⚠ `abbr` / `duty` 取自 agent 自己的 `initials` / `role`（#619 的
      //    `capability_listings_agent_needs_abbr_duty` CHECK 要求两者非空）。
      //    这**不是**被禁的那条捷径：被禁的是拿 `role` 当 `instructions`
      //    （运行时真的照着执行的系统提示词）。这里 `role`「职责一句话」→ `duty`
      //    「这个 agent 是干什么的」是**同一个语义**，是 roster 上给人看的标签，
      //    与 `agent_versions.instructions` 各走各的，互不顶替。
      //    同 `ensureSystemAgent` 那条 INSERT 的列与含义。
      //
      // ⚠ #1705（#728 D-1）：`role_label` 同一条投影——迁移
      //    `20260821180000_i1705_agent_role_label.sql` 头注明写「自发布时把新字段也
      //    投影进 capability_listings（同现有 role→duty 那条管道的形状，新增一条
      //    平行投影）」，这里是那条投影**唯一**发生的地方（自助发布是本仓目前
      //    ③ 步——写 `capability_listings`——的两条路径之一，另一条是
      //    `ensureSystemAgent`，那条已经带了 `role_label`）。漏了这一列，`agents`
      //    有真实头衔而面板永远拿不到，只能悄悄回退到 `duty`——不是报错，
      //    是一个不会自己暴露的功能缺口。
      await session.query(
        `INSERT INTO capability_listings
           (id,org_id,kind,name,abbr,duty,scope,owner_team_id,enabled,endpoint,
            role_label,role_label_needs_confirmation)
         VALUES ($1,$2,'agent',$3,$4,$5,'org-wide',NULL,true,NULL,$6,$7)`,
        [
          input.agentId,
          input.orgId,
          definition.name,
          definition.initials,
          definition.role,
          definition.roleLabel,
          definition.roleLabelNeedsConfirmation,
        ],
      );

      return { agentVersionId: versionId };
    });
  }
}
