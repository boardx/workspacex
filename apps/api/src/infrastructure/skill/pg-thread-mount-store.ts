/**
 * #467 —— 线程内临时挂载（F65）的 PostgreSQL 适配器。
 *
 * 实现 `ThreadMountStorePort` 的 `load` / `save` 两个方法，落到
 * `thread_skill_mounts`（迁移 `20260805170000_i467_thread_skill_mounts.sql`）。
 *
 * ⚠ 每个方法恰好一次 `withTenant`：那一次调用**就是**事务，且它负责
 *   `SET LOCAL app.current_org`。本文件没有 `withoutTenant` —— 业务仓储用它
 *   等于关掉 RLS 后读到「没有数据」而不是报错（同 `pg-skill-contract-repository.ts`）。
 * ⚠ 每个 WHERE 仍然带 `org_id = $1`，即使 RLS 已经在挡。第二道防线，同既有仓储。
 *
 * ## `save` 为什么是 upsert 而不是「删了重写」
 *
 * 端口的形状是「读出整份列表 → 用例返回新列表 → 写回」，最省事的实现是
 * `DELETE FROM … WHERE thread_id = $1` 再全量插入。那样会把 I-19 的
 * 「摘除是打时间戳、不删行」在存储层悄悄废掉——每次挂载都会重写一遍
 * 历史行的主键。所以这里按 `mount_id` upsert，且**唯一允许变化的列是
 * `removed_at`**：`ON CONFLICT` 的 `DO UPDATE SET` 里只有它。
 * 想改 `skill_id` / `version_id` / `mounted_at` 得先改这一句 SQL，
 * 那是一次会被 review 看见的改动，而不是一行漏写的 WHERE。
 * 迁移里 `app_rw` 没有 DELETE 权限，是同一条纪律的第二半。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type { ThreadSkillMount } from "../../domain/skill/thread-mount";
import type {
  ThreadMountStoreFactory,
  ThreadMountStorePort,
} from "../../application/skill/ports";

interface ThreadSkillMountDbRow {
  readonly mount_id: string;
  readonly thread_id: string;
  readonly skill_id: string;
  readonly version_id: string;
  readonly mounted_at: Date;
  readonly removed_at: Date | null;
}

/**
 * 时间戳一律以 **ISO-8601 字符串**穿过端口。
 *
 * ⚠ 契约的 `ThreadSkillMount.mountedAt` / `removedAt` 是 `z.string()`，而 `pg` 把
 *   `timestamptz` 解成 `Date`。不显式转，`out.parse()` 会在**响应序列化那一刻**
 *   才炸（或者更糟：被某个非 strict 的边界静默转成别的格式）。
 */
function toMount(row: ThreadSkillMountDbRow): ThreadSkillMount {
  return {
    mountId: row.mount_id,
    threadId: row.thread_id,
    skillId: row.skill_id,
    versionId: row.version_id,
    mountedAt: row.mounted_at.toISOString(),
    removedAt: row.removed_at === null ? null : row.removed_at.toISOString(),
  };
}

class ScopedPgThreadMountStore implements ThreadMountStorePort {
  constructor(
    private readonly db: DatabasePort,
    private readonly orgId: string,
  ) {}

  async load(threadId: string): Promise<readonly ThreadSkillMount[]> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<ThreadSkillMountDbRow>(
        `SELECT mount_id, thread_id, skill_id, version_id, mounted_at, removed_at
           FROM thread_skill_mounts
          WHERE org_id = $1 AND thread_id = $2
          ORDER BY mounted_at ASC, mount_id ASC`,
        [this.orgId, threadId],
      );
      return rows.map(toMount);
    });
  }

  async save(threadId: string, mounts: readonly ThreadSkillMount[]): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      for (const mount of mounts) {
        // ⚠ `thread_id = $3` 也进 WHERE-等价的 ON CONFLICT 目标行判定之外：
        //   `mount_id` 是主键，一条挂载天生属于一个线程，跨线程改写在这里
        //   不是「被拒绝」而是**不可表示**——INSERT 的 thread_id 来自参数，
        //   而 DO UPDATE 分支根本不碰它。
        await s.query(
          `INSERT INTO thread_skill_mounts
             (mount_id, org_id, thread_id, skill_id, version_id, mounted_at, removed_at)
           VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)
           ON CONFLICT (mount_id) DO UPDATE SET removed_at = EXCLUDED.removed_at`,
          [
            mount.mountId,
            this.orgId,
            threadId,
            mount.skillId,
            mount.versionId,
            mount.mountedAt,
            mount.removedAt,
          ],
        );
      }
    });
  }
}

export class PgThreadMountStore implements ThreadMountStoreFactory {
  constructor(private readonly db: DatabasePort) {}

  forOrg(orgId: string): ThreadMountStorePort {
    return new ScopedPgThreadMountStore(this.db, orgId);
  }
}
