/**
 * `ProjectAiSettingsRepository` 的 PostgreSQL 实现（B2-S5，#4429）——侧表 `project_ai_settings`
 * （迁移 `20260927170000_b2_project_ai_settings.sql`）。
 *
 * 读经 `guard()` 出门（正门，非白名单）；写是 `INSERT … ON CONFLICT (project_id) DO UPDATE`
 * 的 upsert（同 `pg-retention-policy-repository.ts`），`RETURNING` 回显的只是调用者自己刚提交的
 * 集合与 `updated_by = 调用者`——见 `project-ai-settings-ports.ts` 文件头的论证。
 *
 * 复合外键 `(project_id, org_id) → projects (id, org_id)` 已保证行不会跨租户挂错；这里先判
 * 「容器存在吗」是为了把「不存在」作为一个 outcome 报回去，而不是让 23503 变成 500。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  ProjectAiSettingsRepository,
  ProjectAiSettingsRow,
  ProjectAiSourceKind,
  UpsertProjectAiSettingsCommand,
  UpsertProjectAiSettingsOutcome,
} from "../../application/project/project-ai-settings-ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";

interface Row {
  project_id: string;
  allowed_sources: string[];
  updated_by: string;
  updated_at: Date | string;
}

function toRow(r: Row): ProjectAiSettingsRow {
  return {
    projectId: r.project_id,
    // CHECK 约束已把列内容限制在契约枚举闭集内，这里的断言只是把 text[] 收窄回类型。
    allowedSources: r.allowed_sources as ProjectAiSourceKind[],
    updatedBy: r.updated_by,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : new Date(r.updated_at).toISOString(),
  };
}

export class PgProjectAiSettingsRepository implements ProjectAiSettingsRepository {
  constructor(private readonly db: DatabasePort) {}

  async find(orgId: OrgId, projectId: string): Promise<Guarded<ProjectAiSettingsRow | null>> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>(
        `SELECT project_id, allowed_sources, updated_by, updated_at
           FROM project_ai_settings WHERE org_id = $1 AND project_id = $2`,
        [orgId, projectId],
      );
      const row = r.rows[0];
      return guard({ kind: "project", id: projectId }, row === undefined ? null : toRow(row));
    });
  }

  async upsert(cmd: UpsertProjectAiSettingsCommand): Promise<UpsertProjectAiSettingsOutcome> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      const found = await s.query<{ id: string }>(
        `SELECT id FROM projects WHERE id = $1 AND org_id = $2`,
        [cmd.projectId, cmd.orgId],
      );
      if (found.rows[0] === undefined) return { kind: "not-found" };

      const r = await s.query<Row>(
        `INSERT INTO project_ai_settings (project_id, org_id, allowed_sources, updated_by, updated_at)
         VALUES ($1, $2, $3::text[], $4, now())
         ON CONFLICT (project_id) DO UPDATE SET
           allowed_sources = excluded.allowed_sources,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at
         RETURNING project_id, allowed_sources, updated_by, updated_at`,
        [cmd.projectId, cmd.orgId, [...cmd.allowedSources], cmd.updatedBy],
      );
      return { kind: "upserted", row: toRow(r.rows[0]!) };
    });
  }
}
