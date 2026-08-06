/**
 * #595 A2 —— pin 一组 skill 版本到某个 agent 上，**发布成新版本**（不原地改）。
 *
 * ## 为什么不 UPDATE `agent_versions`
 *
 * `agent_versions` 上有 `agent_versions_immutable_trg`（DB 级触发器，UPDATE/DELETE
 * 一律 `RAISE EXCEPTION`）——与 `skill_versions` 同一形状。⇒ 唯一合法动作是
 * **INSERT 一行新版本 + UPDATE `agents.published_version_id` 指过去**，与
 * `pg-agent-starter-import-repository.ts` 创建 agent 时用的正是同一对语句
 * （`INSERT agent_versions` 紧跟 `UPDATE agents SET published_version_id=...`）。
 *
 * ## 为什么校验与写入在同一笔事务、同一把锁下
 *
 * `expectedVersion` 并发判定与 skill 版本存在性校验必须对着**同一个快照**判——
 * 否则两次独立查询之间可能被另一次并发 pin 穿透：查的时候还没变，写的时候已经变了。
 * 用 `pg_advisory_xact_lock` 把同一个 agent 的并发 pin 串行化（与 URL 导入对同组织
 * 串行化同一形状），再在锁内一次性 `SELECT ... FOR UPDATE` 拿到权威快照。
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type { AgentSkillPinsRepository } from "../../application/agent-skill-pins/set-agent-skill-pins";

interface AgentRow {
  readonly published_version_id: string | null;
}

interface VersionRow {
  readonly id: string;
  readonly semantic_label: string;
  readonly instruction_digest: string;
  readonly instructions: string;
  readonly model_provider: string;
  readonly model_id: string;
  readonly tool_policy: unknown;
}

export class PgAgentSkillPinsRepository implements AgentSkillPinsRepository {
  constructor(private readonly db: DatabasePort) {}

  async publishPins(
    input: Parameters<AgentSkillPinsRepository["publishPins"]>[0],
  ): ReturnType<AgentSkillPinsRepository["publishPins"]> {
    return this.db.withTenant(toOrgId(input.orgId), async (session) => {
      // 同一个 agent 的并发 pin 串行化——`hashtextextended` 的第二个参数是任意的
      // 命名空间常量，选一个与 URL 导入（用的是 0）不同的值，避免两条互不相关的
      // 写路径共享同一把锁而彼此空等。
      await session.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 1))",
        [`${input.orgId}:${input.agentId}`],
      );

      const agentFound = await session.query<AgentRow>(
        `SELECT published_version_id FROM agents WHERE id = $1 AND org_id = $2 FOR UPDATE`,
        [input.agentId, input.orgId],
      );
      const agentRow = agentFound.rows[0];
      if (agentRow === undefined) return { kind: "agent-not-found" };
      if (agentRow.published_version_id === null) return { kind: "agent-not-published" };
      if (agentRow.published_version_id !== input.expectedVersion) {
        return { kind: "version-changed" };
      }

      const baseFound = await session.query<VersionRow>(
        `SELECT id, semantic_label, instruction_digest, instructions,
                model_provider, model_id, tool_policy
           FROM agent_versions
          WHERE id = $1 AND org_id = $2 AND agent_id = $3`,
        [agentRow.published_version_id, input.orgId, input.agentId],
      );
      const base = baseFound.rows[0];
      // ⚠ 上面已经用同一把锁确认了 `agents.published_version_id` 指向这一行；
      //   查不到只可能是数据不一致（外键本应挡住），不是正常业务分支，
      //   但仍然按"没有可扩展的基线版本"处理而不是让调用方看见 500。
      if (base === undefined) return { kind: "agent-not-published" };

      /**
       * ⚠ skill 版本存在性校验：必须**在同一笔事务里**、必须要求 `published = true`——
       * 与 `pg-agent-starter-import-repository.ts` 校验 starter pack 引用的 skill 版本
       * 时的判据逐字一致（`published=true`），理由也一致：`readPinnedSkills`
       * （`pg-agent-run-repository.ts`）执行期只读已发布版本，pin 一个草稿版本
       * 会让这次 pin 在写入时看似成功、却在下一次 chat 调用时才因
       * `SKILL_VERSION_UNAVAILABLE` 现出原形——那是本该在 pin 这一步就能截住的错误。
       */
      const skillVersionsFound = await session.query<{ id: string }>(
        `SELECT id FROM skill_versions WHERE org_id = $1 AND id = ANY($2::text[]) AND published = true`,
        [input.orgId, [...input.skillVersionIds]],
      );
      const found = new Set(skillVersionsFound.rows.map((r) => r.id));
      if (input.skillVersionIds.some((id) => !found.has(id))) {
        return { kind: "skill-version-not-found" };
      }

      const versionId = `agent-version-${randomUUID()}`;
      const now = new Date().toISOString();
      // 语义标签只需要在本 agent 下唯一（`agent_versions_semantic_uniq`）；
      // 用当前时间戳而不是重放 `base.semantic_label`，避免与它撞唯一约束。
      const semanticLabel = `pin-${Date.now()}-${versionId.slice(-8)}`;

      await session.query(
        `INSERT INTO agent_versions
           (id, org_id, agent_id, semantic_label, instruction_digest, instructions,
            skill_version_ids, model_provider, model_id, tool_policy, creator_id,
            created_at, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10::jsonb,$11,$12,$12)`,
        [
          versionId,
          input.orgId,
          input.agentId,
          semanticLabel,
          base.instruction_digest,
          base.instructions,
          [...input.skillVersionIds],
          base.model_provider,
          base.model_id,
          JSON.stringify(base.tool_policy),
          input.actorId,
          now,
        ],
      );
      // `agents` 本身没有不可变触发器——只有 `agent_versions` 行是不可变的。
      // 与 `pg-agent-starter-import-repository.ts` 建 agent 时用的是同一条语句形状。
      await session.query(
        `UPDATE agents SET published_version_id = $3, updated_at = $4 WHERE id = $1 AND org_id = $2`,
        [input.agentId, input.orgId, versionId, now],
      );

      return {
        kind: "ok",
        result: { agentId: input.agentId, versionId, skillVersionIds: [...input.skillVersionIds] },
      };
    });
  }
}
