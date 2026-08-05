/**
 * #467 —— 会话内 skill 临时挂载的 PostgreSQL 适配器（`ThreadMountStorePort`）。
 *
 * 这个端口在此之前**没有任何实现**：application 层的 `mount-skill-to-thread` /
 * `unmount-skill-from-thread` 早就写好了，domain 的 `activeMounts` 也在，
 * 但它们背后是空的 —— 所以核心闭环第 8 步「会话内挂载一个 skill」
 * 无论前端怎么接都落不了库。本文件补的是那一段。
 *
 * ⚠ 每个方法恰好一次 `withTenant`：那一次调用**就是**事务，且它负责
 *   `SET LOCAL app.current_org`。本文件没有 `withoutTenant` —— 业务仓储用它
 *   等于关掉 RLS 后读到「没有数据」而不是报错。
 * ⚠ 每个 WHERE 仍然带 `org_id = $1`，即使 RLS 已经在挡。第二道防线，同既有仓储。
 *
 * ## `save` 为什么是「差集写」而不是「删了重插」
 *
 * 端口的形状是 `save(threadId, mounts)` —— 一个全量列表。最省事的实现是
 * `DELETE ... WHERE thread_id = $1` 再全量 INSERT。**那会毁掉 I-19/V3**：
 * 摘除必须是打 `removed_at` 时间戳而不是删行，否则「这条消息生成时挂着什么」
 * 就再也答不上来了。而且迁移里**根本没给 `app_rw` DELETE 权限**，
 * 删了重插这条路在数据库层就是关着的。
 *
 * 所以这里按 mountId 做 upsert：新条目 INSERT，已存在的只把 `removed_at` 对齐。
 * 历史行一条都不动。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import { activeMounts, type ThreadSkillMount } from "../../domain/skill/thread-mount";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { ThreadMountStorePort } from "../../application/skill/ports";

interface ThreadMountDbRow {
  readonly id: string;
  readonly thread_id: string;
  readonly skill_id: string;
  readonly version_id: string;
  readonly mounted_at: Date;
  readonly removed_at: Date | null;
}

function toDomain(row: ThreadMountDbRow): ThreadSkillMount {
  return {
    mountId: row.id,
    threadId: row.thread_id,
    skillId: row.skill_id,
    versionId: row.version_id,
    mountedAt: row.mounted_at.toISOString(),
    removedAt: row.removed_at === null ? null : row.removed_at.toISOString(),
  };
}

export class PgThreadMountRepository implements ThreadMountStorePort {
  constructor(
    private readonly db: DatabasePort,
    private readonly orgId: string,
    /** 谁挂的。审计列，不参与任何判定 —— 判定在 application 层已经做过了。 */
    private readonly mountedBy: string,
  ) {}

  async load(threadId: string): Promise<readonly ThreadSkillMount[]> {
    return this.db.withTenant(toOrgId(this.orgId), async (s) => {
      const result = await s.query<ThreadMountDbRow>(
        `SELECT id, thread_id, skill_id, version_id, mounted_at, removed_at
           FROM thread_skill_mounts
          WHERE org_id = $1 AND thread_id = $2
          ORDER BY mounted_at ASC, id ASC`,
        [this.orgId, threadId],
      );
      // ⚠ 这里**不过滤** `removed_at`。端口叫 `load` 不叫 `loadActive`：
      //   「哪些算活动的」是 domain 的 `activeMounts` 说了算，仓储只负责如实取回。
      //   在这儿顺手加一个 `WHERE removed_at IS NULL` 就等于把那条规则复制到第二处。
      return result.rows.map(toDomain);
    });
  }

  /**
   * 对外读：**这条会话当前挂着什么**，包成 `Guarded`（契约 `listThreadSkillMounts`）。
   *
   * ## 为什么它与上面的 `load` 是两个方法，而不是一个加个参数
   *
   * `load` 服务的是 mount/unmount 用例——它取回的东西**从不离开服务端**，
   * 是状态机的输入。这一个的载荷**要下发给浏览器**，所以必须经
   * `permission-filter`：谁看得见这条会话，是一次要留痕的判定，
   * 不是仓储可以顺手替人回答的问题。
   *
   * 两者混成一个方法就会出现「同一次查询有时要判权限有时不用」，
   * 而那正是 `lint-permission-paths` 存在的理由——它挡的不是「读了租户表」，
   * 是「读了租户表却没人判过谁能看」。
   *
   * ⚠ 作用域 ref 用 **project** 而不是 thread：本仓所有 chat 读路径
   *   （`pg-chat-repository.ts:162`、`pg-chat-message-command-repository.ts:46/105/143`）
   *   一律 `guard({ kind: "project", id: projectId }, …)`——会话的可见性
   *   派生自它的项目。这里发明第二种作用域就是同一事实的第二份声明。
   *
   * ⚠ 这里**过滤** `removed_at`（经 domain 的 `activeMounts`），而 `load` 不过滤：
   *   对外回答的是「现在挂着什么」，摘除历史不属于这个问题。
   *   过滤仍然由 domain 那一份做，本文件不重写那条规则。
   */
  async listActive(
    threadId: string,
    projectId: string,
  ): Promise<Guarded<readonly ThreadSkillMount[]>> {
    const all = await this.load(threadId);
    return guard({ kind: "project", id: projectId }, activeMounts(all));
  }

  async save(threadId: string, mounts: readonly ThreadSkillMount[]): Promise<void> {
    if (mounts.length === 0) return;
    await this.db.withTenant(toOrgId(this.orgId), async (s) => {
      for (const m of mounts) {
        await s.query(
          `INSERT INTO thread_skill_mounts
             (id, org_id, thread_id, skill_id, version_id, mounted_by, mounted_at, removed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET removed_at = EXCLUDED.removed_at`,
          [
            m.mountId, this.orgId, threadId, m.skillId, m.versionId,
            this.mountedBy, m.mountedAt, m.removedAt,
          ],
        );
      }
    });
  }
}

/** 一个请求内、已绑定租户与操作者的仓储工厂。 */
export class PgThreadMountRepositoryFactory {
  constructor(private readonly db: DatabasePort) {}
  forOrg(orgId: string, mountedBy: string): ThreadMountStorePort {
    return new PgThreadMountRepository(this.db, orgId, mountedBy);
  }
}
