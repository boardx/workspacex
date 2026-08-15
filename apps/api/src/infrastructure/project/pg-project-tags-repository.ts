/**
 * `ProjectTagsRepository` 的 PostgreSQL 实现（F185，2026-08-16 delta）。
 *
 * 同 `pg-project-archive-repository.ts` 的形状：读容器是否存在 + 在同一个事务内写，
 * 不拆成两次仓储调用。整体替换 = 同一事务里 `DELETE` 旧集合 + `INSERT` 新集合，
 * 不是逐条 diff——标签没有「改这一条」的操作。
 *
 * ⚠ 独立文件、独立白名单条目（`lint-permission-paths.mjs`）：这是一个 WRITE 路径 +
 *   一条把调用者刚写的内容原样回显的 `RETURNING`，同 `pg-project-repository.ts`
 *   （F117）「echo of the caller's own request」那条豁免同型——它不披露任何人的
 *   内容，只把这个组织的 `lead`/`admin` 刚提交的标签集合报回给他自己。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { ProjectTagsRepository, UpdateProjectTagsOutcome } from "../../application/project/ports";
import type { OrgId } from "../../domain/org-id";

export class PgProjectTagsRepository implements ProjectTagsRepository {
  constructor(private readonly db: DatabasePort) {}

  async updateTags(orgId: OrgId, projectId: string, tags: readonly string[]): Promise<UpdateProjectTagsOutcome> {
    return this.db.withTenant(orgId, async (s) => {
      // 锁住容器行：与并发的 archive/unarchive 序列化，且顺带确认它属于这个组织
      // （复合外键 `(project_id, org_id) REFERENCES projects (id, org_id)` 已经保证
      // `project_tags` 不会跨租户挂错行，这里只是先判「存在吗」）。
      const found = await s.query<{ id: string }>(
        `SELECT id FROM projects WHERE id = $1 AND org_id = $2 FOR UPDATE`,
        [projectId, orgId],
      );
      if (found.rows[0] === undefined) return { kind: "not-found" };

      await s.query(`DELETE FROM project_tags WHERE project_id = $1`, [projectId]);

      // 去重（客户端可能重复提交同一个标签两次）——`PRIMARY KEY (project_id, tag)`
      // 本来就会在第二条 INSERT 上报 23505，这里先去重是为了不让整批写入因此失败。
      const deduped = [...new Set(tags)];
      if (deduped.length > 0) {
        const values = deduped.map((_, i) => `($1, $2, $${i + 3})`).join(", ");
        await s.query(
          `INSERT INTO project_tags (project_id, org_id, tag) VALUES ${values}`,
          [projectId, orgId, ...deduped],
        );
      }

      return { kind: "updated", projectId, tags: deduped };
    });
  }
}
