/**
 * #2514 —— `EnabledSkillVersionReader` 的 PostgreSQL 适配器：run 创建时读「这个组织
 * 此刻已启用、且运行时读得到的」全部 skill 各自当前生效的版本 id。
 *
 * ## 与 `listAll()` 同一条判据
 *
 * `pg-skill-contract-repository.ts` `listAll()` 的 wave2 分支决定了目录里「已启用」
 * 一行长什么样：`skills.status = 'enabled'`、`org_id` 是自己或平台组织、当前版本 =
 * 最新一条 `published` 的 `skill_versions`。这里逐字复用那三个条件——目录里看得到、
 * 标着已启用、有生效版本的，就是 agent 默认加载的那些；一个不多一个不少。
 *
 * ## 为什么排除没有已发布版本的 skill
 *
 * `readPinnedSkills`（`pg-agent-run-repository.ts`）只读 `v.published` 的 `SKILL.md`。
 * 把一个只有草稿的 skill 塞进 `agent_runs.skill_version_ids`，run 会因「钉了 N 个、
 * 读回 M < N 个」以 `SKILL_VERSION_UNAVAILABLE` 整体失败——那不是「有个 skill 没
 * 正文」，是一次用户可见的故障。子查询为 null 的行在这里 `WHERE` 掉，与
 * `skill-mount.controller.ts` 对 `currentVersionId === null` 折成 `SKILL_NOT_FOUND`
 * 是同一个判断。
 *
 * ⚠ 顺序 `created_at ASC, id ASC`（先建的在前）：`skillVersionIds` 的顺序是语义属性
 *   （`execute-run.ts` 的 `buildSystemPrompt` 头注），必须确定。
 * ⚠ 返回 `Guarded`：调用方必须先 `discloseDecided`（`lint-permission-paths.mjs` 只认
 *   结构，理由逐字同 `pg-thread-mounted-skill-reader.ts`）。
 * ⚠ `withTenant` 恰好一次，WHERE 仍显式带 `org_id`——第二道防线。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { PLATFORM_ORG_ID } from "../../domain/org-id";
import type { OrgId } from "../../domain/org-id";
import { guard } from "../../application/security/permission-filter";
import type { EnabledSkillVersionReader } from "../../application/chat/message-command-ports";

export class PgEnabledSkillVersionReader implements EnabledSkillVersionReader {
  constructor(private readonly db: DatabasePort) {}

  async currentEnabledSkillVersionIds(
    orgId: OrgId,
    input: { projectId: string | null; threadId: string },
  ) {
    const versionIds = await this.db.withTenant(orgId, async (s) => {
      const { rows } = await s.query<{ version_id: string }>(
        `SELECT current.version_id
           FROM skills sk
           CROSS JOIN LATERAL (
             SELECT sv.id AS version_id
               FROM skill_versions sv
              WHERE sv.skill_id = sk.id AND sv.org_id = sk.org_id AND sv.published
              ORDER BY sv.created_at DESC LIMIT 1
           ) AS current
          WHERE (sk.org_id = $1 OR sk.org_id = $2) AND sk.status = 'enabled'
          ORDER BY sk.created_at ASC, sk.id ASC`,
        [orgId, PLATFORM_ORG_ID],
      );
      return rows.map((row) => row.version_id) as readonly string[];
    });
    // 同 `pg-thread-mounted-skill-reader.ts`：`ref.id` 只是描述性元数据，个人线程用合成 id。
    return guard({ kind: "project", id: input.projectId ?? `personal:${input.threadId}` }, versionIds);
  }
}
