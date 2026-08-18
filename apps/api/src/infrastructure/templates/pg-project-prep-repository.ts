/**
 * `ProjectPrepRepository` 的 PostgreSQL 实现（F950，delta——F24 签的契约，这是它第一次
 * 落库；此前只有内存假仓储撑单元测试）。
 *
 * 四类计数里**只有两类今天有真实来源**：
 *   `groupCount` ← `groups` 表（本次接线）
 *   `agendaSegmentCount` ← `agenda_segments` 表（F118 已落库）
 * 另外两类（`materialsCount`「材料准备」、`preTasksDone`/`preTasksTotal`「会前任务」）
 * **没有任何后端表**——F27/F28 从未实现，属本 feature 明确排除的范围（见计划文档）。
 * 这里恒返回 0，不是「暂时忘了接」，是「诚实的空态」：`domain/templates/project-prep.ts`
 * 头注 V15 允许全 0 计数，`getProjectPrep` 的空态纪律本来就覆盖这种情况。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { ProjectPrepRepository } from "../../application/templates/project-prep-ports";
import type { ProjectPrepCounts } from "../../domain/templates/project-prep";
import type { OrgId } from "../../domain/org-id";

export class PgProjectPrepRepository implements ProjectPrepRepository {
  constructor(private readonly db: DatabasePort) {}

  async loadCounts(orgId: OrgId, projectId: string): Promise<ProjectPrepCounts | null> {
    return this.db.withTenant(orgId, async (s) => {
      const found = await s.query<{ id: string }>(`SELECT id FROM projects WHERE id = $1`, [projectId]);
      if (found.rows[0] === undefined) return null;

      const groupCountResult = await s.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM groups WHERE project_id = $1 AND kind = 'workshop'`,
        [projectId],
      );
      const agendaCountResult = await s.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM agenda_segments WHERE workshop_id = $1`,
        [projectId],
      );

      return {
        groupCount: groupCountResult.rows[0]?.cnt ?? 0,
        agendaSegmentCount: agendaCountResult.rows[0]?.cnt ?? 0,
        // 材料/会前任务无后端来源——见文件头注，恒 0 是诚实空态不是遗漏。
        materialsCount: 0,
        preTasksDone: 0,
        preTasksTotal: 0,
      };
    });
  }
}
