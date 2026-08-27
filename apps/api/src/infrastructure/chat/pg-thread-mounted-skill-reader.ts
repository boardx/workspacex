/**
 * #1559 —— `ThreadMountedSkillReader` 的 PostgreSQL 适配器：run 创建时读「这条线程
 * 此刻生效、**且运行时读得到**的」skill 版本 id。
 *
 * ## ⚠ 为什么这里有一个 JOIN，而不是一个判别列 + 外键
 *
 * #1559 的 issue 正文要求「把 `thread_skill_mounts` 的外键改指模型 A」。**那一半
 * 已经在 #1534（PR #1539，2026-08-18 合入）被以相反的方向裁掉了**：那条迁移
 * （`20260818090000_i1534_thread_skill_mounts_wave2_fk.sql`）把
 * `thread_skill_mounts_skill_fk` **整个删掉**，理由逐字写在它的文件头——一个列对
 * 指不了两张表，而 skill 的身份事实横跨模型 A / 模型 B 两套，所以引用完整性
 * 属于应用层（先例：`agent_versions.skill_version_ids` 是无外键的 `text[]`）。
 * ⇒ 本文件**不**回头再加一个库级外键去推翻那次裁决；那次裁决把这件事交给了这里。
 *
 * 于是「这条挂载运行时读不读得到」就在这条 SQL 里当场回答，而不是靠一个要维护的
 * 判别列：JOIN 上 `skill_versions` + `skills`，**join 得上就是模型 A**。
 * 这与运行时 `readPinnedSkills`（`pg-agent-run-repository.ts`）的可达性条件同源，
 * 不是第二份规则。
 *
 * ## 为什么必须把模型 B 的存量挂载排除在外
 *
 * `readPinnedSkills` 只读模型 A。把一条模型 B 的挂载塞进
 * `agent_runs.skill_version_ids`，`execute-run.ts` 会按「钉了 N 个、读回 M < N 个」
 * 判 `SKILL_VERSION_UNAVAILABLE` 让**整次 run 失败**——把一个存量数据问题变成一次
 * 用户可见的故障。存量行本身**不删不迁**（I-19：挂载行是「这场对话当时挂过什么」
 * 的事实），它们在挂载列表里照常显示，只是不参与注入。
 *
 * ⚠ 这**不是**静默 mock fallback：被排除的只有运行时**结构上**读不到的行，
 *   而不是「读失败了就跳过」。一条模型 A 的挂载如果版本被取消发布，它照样会被
 *   注入，然后由 `execute-run.ts` 以 `SKILL_VERSION_UNAVAILABLE` **明确失败**——
 *   这里刻意**不**筛 `published`：筛掉它就会让使用者看着一个还挂在列表里的 skill、
 *   而它对回答没有任何影响，那又是一遍 #1559。
 *
 * ⚠ 返回 `Guarded`：调用方必须先 `discloseDecided` 才拿得到值。判权本身发生在
 *   `acceptHumanMessage` 的 `authorize()` 里，这里是把「必须判过」从一句约定变成
 *   一个类型——`lint-permission-paths.mjs` 只认结构，而它是对的：一个返回裸数组的
 *   租户读口，下一个调用方就能在没判权的地方用上它。
 *
 * ⚠ `withTenant` 恰好一次：那一次调用**就是**事务，且它负责 `SET LOCAL
 *   app.current_org`。没有 `withoutTenant`——那条路会关掉 RLS 并把「读到 0 行」
 *   伪装成「没有数据」（同 `pg-thread-mount-store.ts` 头注）。每个 WHERE 仍显式
 *   带 `org_id`，第二道防线。
 *
 * ⚠ 顺序 `mounted_at, mount_id` 升序（先挂的在前）：`skillVersionIds` 的顺序是语义
 *   属性（`execute-run.ts` 的 `buildSystemPrompt` 头注），所以它必须是确定的。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { PLATFORM_ORG_ID } from "../../domain/org-id";
import type { OrgId } from "../../domain/org-id";
import { guard } from "../../application/security/permission-filter";
import type { ThreadMountedSkillReader } from "../../application/chat/message-command-ports";

export class PgThreadMountedSkillReader implements ThreadMountedSkillReader {
  constructor(private readonly db: DatabasePort) {}

  async activeMountedSkillVersionIds(
    orgId: OrgId,
    input: { projectId: string | null; threadId: string },
  ) {
    const versionIds = await this.db.withTenant(orgId, async (s) => {
      const { rows } = await s.query<{ version_id: string }>(
        // ⚠ `sk.id = m.skill_id` 那一条不是多余的：它把「挂载记的 skill」与「这个版本
        //   真正属于的 skill」钉成同一个。#1534 删掉库级外键时说的「引用完整性归应用层」
        //   指的就是这一句——少了它，一条 skill_id 与 version_id 对不上的挂载会被
        //   当作有效注入，而没有任何东西会红。
        //
        // design-delta `platform-owned-skills`（实测补上，不是原设计就有）—— `v.org_id
        // = m.org_id` 原本假设一条挂载引用的版本永远和挂载行同一个 org，但一条挂载
        // `org-platform` 名下 skill 的行，`m.org_id` 是挂载方自己的组织、`v.org_id` 是
        // `org-platform`，两者天生不相等，原 JOIN 条件让平台 skill 的挂载**永远 join
        // 不上任何版本行**——读出来的 `mountedVersionIds` 悄悄少了这一条，run 的
        // `skillVersionIds` 因此为空，`execute-run.ts` 的执行判据（`skills.length > 0`）
        // 从不成立，脚本从不执行，且**不报任何错**（run 正常 succeeded，只是模型的话
        // 里没有任何文件）——这是四处该加 OR 子句的地方里最隐蔽的一处，真栈测试
        // （`platform-owned-skills-real-stack.test.ts` V3）跑起来才第一次现形，
        // 之前的静态审查（contract.md §4）完全没预见到这第五个点。
        `SELECT m.version_id
           FROM thread_skill_mounts m
           JOIN skill_versions v ON v.id = m.version_id AND (v.org_id = m.org_id OR v.org_id = $3)
           JOIN skills sk ON sk.id = v.skill_id AND sk.org_id = v.org_id AND sk.id = m.skill_id
          WHERE m.org_id = $1 AND m.thread_id = $2 AND m.removed_at IS NULL
          ORDER BY m.mounted_at ASC, m.mount_id ASC`,
        [orgId, input.threadId, PLATFORM_ORG_ID],
      );
      return rows.map((row) => row.version_id) as readonly string[];
    });
    // #594 的先例：`ref.id` 只是 `Guarded` 的描述性元数据（`discloseDecided` 不查它），
    // 个人线程没有真实 projectId 时用一个恒无绑定行的合成 id，同
    // `pg-chat-message-command-repository.ts`。
    return guard({ kind: "project", id: input.projectId ?? `personal:${input.threadId}` }, versionIds);
  }
}
