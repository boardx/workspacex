/**
 * `ProjectTopicRepository` 的 PostgreSQL 实现（F950，delta——F24 签的契约，这是它第一次
 * 落库；此前只有内存假仓储撑单元测试）。
 *
 * `topicId` 恒等于 `projectId`：`project_topics` 是 1:1 upsert-by-`projectId` 的表，
 * 不另造一个 id 列——多一个 id 只是「同一件事的第二种称呼」，不是新的实体。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  ProjectTopicRepository,
  ProjectTopicRow,
  SaveAndSyncTopicCommand,
  SavedTopic,
} from "../../application/templates/save-and-sync-topic-ports";
import { TopicRevisionConflictError } from "../../application/templates/save-and-sync-topic-ports";
import type { OrgId } from "../../domain/org-id";

interface TopicSqlRow {
  project_id: string;
  title: string;
  background: string;
  revision: string;
}

export class PgProjectTopicRepository implements ProjectTopicRepository {
  constructor(private readonly db: DatabasePort) {}

  async saveAndSync(cmd: SaveAndSyncTopicCommand): Promise<SavedTopic> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      // upsert：第一次调用（表里没有这一行）无条件建行；此后每次调用都要求
      // `revision = $expectedTopicRevision` 才允许更新——`ON CONFLICT ... WHERE` 无法
      // 表达「新建不设限、更新要设限」这两种前提，所以拆成「先试着建」+「建不成就按条件更新」
      // 两条语句，而不是一条 upsert，行为上仍然是一次原子事务（同一个 withTenant 内）。
      const inserted = await s.query<{ project_id: string; revision: string }>(
        `INSERT INTO project_topics (project_id, org_id, title, background, revision)
         VALUES ($1, $2, $3, $4, '1')
         ON CONFLICT (project_id) DO NOTHING
         RETURNING project_id, revision`,
        [cmd.projectId, cmd.orgId, cmd.title, cmd.background],
      );
      if (inserted.rows[0] !== undefined) {
        return { topicId: cmd.projectId, revision: inserted.rows[0].revision };
      }

      const updated = await s.query<{ project_id: string; revision: string }>(
        `UPDATE project_topics
            SET title = $1, background = $2, revision = (revision::int + 1)::text, updated_at = now()
          WHERE project_id = $3 AND revision = $4
        RETURNING project_id, revision`,
        [cmd.title, cmd.background, cmd.projectId, cmd.expectedTopicRevision],
      );
      if (updated.rows[0] === undefined) throw new TopicRevisionConflictError();
      return { topicId: cmd.projectId, revision: updated.rows[0].revision };
    });
  }

  async getTopic(orgId: OrgId, projectId: string): Promise<ProjectTopicRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<TopicSqlRow>(
        `SELECT project_id, title, background, revision FROM project_topics WHERE project_id = $1`,
        [projectId],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return { topicId: row.project_id, title: row.title, background: row.background, revision: row.revision };
    });
  }
}
