/**
 * `ProjectArchiveRepository` 的 PostgreSQL 实现（F124）。
 *
 * ## 归档：读状态 + 判 active 环节 + 写，在同一个事务里
 *
 * `archive()` 用一条 CTE 在同一次往返里读出容器当前状态与「是否存在 active 议程
 * 环节」，据此决定要不要真的执行 `UPDATE`。⚠ 判断与更新在**同一个** `withTenant`
 * 事务内完成——不是先用一次查询决定「能不能归档」、再发第二条语句去写：拆成两次
 * 调用会在两次往返之间留一个窗口，另一个请求可能在窗口内把某条环节推进为
 * `active`，那时「刚才查到的『没有 active 环节』」已经不成立，而写入仍会照常发生。
 *
 * ⚠ `agenda_segments` 是**工作坊机件**（F118 头部逐字：挂 `workshops` 不是
 * `projects`），非工作坊两类容器（`research_project` / `user_insight`）没有议程
 * 环节这回事——对它们而言 `EXISTS (... workshop_id = $1 AND state = 'active')`
 * 天然为 false（没有任何一行的 `workshop_id` 会等于一个非工作坊容器的 id），
 * 不需要在这里另外按 `kind` 分支。
 *
 * ## 冻结不在这里——那是迁移 `20260801120000_f124_*.sql` 的交付物
 *
 * 「归档后其它表写入被拒」是 PG RESTRICTIVE 策略的断言,这个仓储不重复判断
 * `status='archived'` 再抛错——那会把「强制」这件事变成两处声明,理由与
 * `PgOrgLifecycleRepository` 文件头对 F22 的论证完全相同。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  ArchiveOutcome,
  ProjectArchiveRepository,
  UnarchiveOutcome,
} from "../../application/project/ports";
import type { OrgId } from "../../domain/org-id";

interface ArchiveCheckRow {
  status: "active" | "archived";
  has_active_segment: boolean;
}

export class PgProjectArchiveRepository implements ProjectArchiveRepository {
  constructor(private readonly db: DatabasePort) {}

  async archive(orgId: OrgId, projectId: string): Promise<ArchiveOutcome> {
    return this.db.withTenant(orgId, async (s) => {
      // `FOR UPDATE` 锁住容器行：与另一个并发的 archive/unarchive 调用序列化,
      // 不与 `advanceAgendaSegment` 冲突——那条路径锁的是 `agenda_segments` 行,
      // 不是 `projects` 行。
      const check = await s.query<ArchiveCheckRow>(
        `SELECT p.status,
                EXISTS (
                  SELECT 1 FROM agenda_segments a
                   WHERE a.workshop_id = p.id AND a.state = 'active'
                ) AS has_active_segment
           FROM projects p
          WHERE p.id = $1
          FOR UPDATE`,
        [projectId],
      );
      const row = check.rows[0];
      if (row === undefined) return { kind: "not-found" };
      if (row.status === "archived") return { kind: "already-archived" };
      if (row.has_active_segment) return { kind: "active-segment-exists" };

      const updated = await s.query<{ id: string }>(
        `UPDATE projects SET status = 'archived' WHERE id = $1 RETURNING id`,
        [projectId],
      );
      const updatedRow = updated.rows[0]!;
      return { kind: "archived", projectId: updatedRow.id };
    });
  }

  async unarchive(orgId: OrgId, projectId: string): Promise<UnarchiveOutcome> {
    return this.db.withTenant(orgId, async (s) => {
      // 无条件幂等：不先判「是不是 archived」,已经是 active 时这句 UPDATE
      // 原样把它 SET 回 active,不改变任何东西,也不报错（同 F22 reactivate）。
      const updated = await s.query<{ id: string }>(
        `UPDATE projects SET status = 'active' WHERE id = $1 RETURNING id`,
        [projectId],
      );
      const row = updated.rows[0];
      if (row === undefined) return { kind: "not-found" };
      return { kind: "unarchived", projectId: row.id };
    });
  }
}
