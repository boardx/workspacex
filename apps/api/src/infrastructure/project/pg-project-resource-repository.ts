/**
 * `ProjectResourcePort` 的 PostgreSQL 实现（项目中枢 B2-S1，#4425）。
 *
 * 读侧一条 UNION ALL 把四类资源合成一个形状：三类经 `project_resource_links` JOIN 各自的表
 * （资源被删后链接行悬空 ⇒ JOIN 自然过滤掉），访谈直接按 `interview_sessions.project_id`。
 * 全部 `withTenant` + 每条谓词带 `org_id`，返回 `guard({kind:"project"})`——披露由用例拿
 * `authorize()` 的决策解开。
 *
 * 归属校验按 `kind` 分三张表，谓词各自的 owner 列（`survey_workspaces.owner_id` /
 * `guided_research_sessions.owner_user_id` / `personal_transcriptions.owner_user_id`）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  LinkResourceOutcome,
  ProjectLinkableResourceKind,
  ProjectResourcePort,
  ProjectResourceRow,
} from "../../application/project/project-resource-ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";

interface ResourceSqlRow {
  kind: ProjectResourceRow["kind"];
  id: string;
  title: string;
  owner_user_id: string;
  status: string | null;
  updated_at: Date;
  linked_at: Date;
}

/**
 * 可链接资源各自的表与 owner 列——`kind` 是闭合枚举，这里是它到表名的唯一映射。
 * ⚠ #4615 契约新增的 interview / whiteboard / design 暂无条目（链接表扩展属 W2 切片）：
 *   `isOwnedResource` 对它们答 `false` ⇒ 用例抛 RESOURCE_NOT_FOUND，不会写出一条无主链接。
 */
const OWNER_TABLE: Partial<Record<ProjectLinkableResourceKind, { table: string; owner: string }>> = {
  survey: { table: "survey_workspaces", owner: "owner_id" },
  guided_research: { table: "guided_research_sessions", owner: "owner_user_id" },
  personal_transcription: { table: "personal_transcriptions", owner: "owner_user_id" },
};

const LIST_SQL = `
  SELECT 'survey'::text AS kind, s.id, s.document->'model'->>'title' AS title, s.owner_id AS owner_user_id,
         s.document->'model'->>'status' AS status, s.updated_at, l.linked_at
    FROM project_resource_links l
    JOIN survey_workspaces s ON s.org_id = l.org_id AND s.id = l.resource_id
   WHERE l.org_id = $1 AND l.project_id = $2 AND l.kind = 'survey'
  UNION ALL
  SELECT 'guided_research', g.id, g.title, g.owner_user_id, g.stage, g.updated_at, l.linked_at
    FROM project_resource_links l
    JOIN guided_research_sessions g ON g.org_id = l.org_id AND g.id = l.resource_id
   WHERE l.org_id = $1 AND l.project_id = $2 AND l.kind = 'guided_research'
  UNION ALL
  SELECT 'personal_transcription', t.id, t.name, t.owner_user_id, t.status, t.updated_at, l.linked_at
    FROM project_resource_links l
    JOIN personal_transcriptions t ON t.org_id = l.org_id AND t.id = l.resource_id
   WHERE l.org_id = $1 AND l.project_id = $2 AND l.kind = 'personal_transcription'
  UNION ALL
  SELECT 'interview', i.id, i.title, i.created_by,
         CASE WHEN i.archived THEN 'archived' ELSE i.digital_status END, i.updated_at, i.created_at
    FROM interview_sessions i
   WHERE i.org_id = $1 AND i.project_id = $2
`;

export class PgProjectResourceRepository implements ProjectResourcePort {
  constructor(private readonly db: DatabasePort) {}

  async listProjectResources(orgId: OrgId, projectId: string): Promise<Guarded<readonly ProjectResourceRow[] | null>> {
    const ref = { kind: "project" as const, id: projectId };
    return this.db.withTenant(orgId, async (s) => {
      const found = await s.query<{ id: string }>(`SELECT id FROM projects WHERE id = $1 AND org_id = $2`, [projectId, orgId]);
      if (found.rows[0] === undefined) return guard(ref, null);
      const r = await s.query<ResourceSqlRow>(LIST_SQL, [orgId, projectId]);
      return guard(
        ref,
        r.rows.map((row) => ({
          kind: row.kind,
          id: row.id,
          // 问卷标题住在 jsonb 里；理论上非空（契约 `title: min(1)`），落库前的旧文档兜一个空串。
          title: row.title ?? "",
          ownerUserId: row.owner_user_id,
          status: row.status,
          updatedAt: row.updated_at.toISOString(),
          linkedAt: row.linked_at.toISOString(),
        })),
      );
    });
  }

  async isOwnedResource(orgId: OrgId, kind: ProjectLinkableResourceKind, resourceId: string, ownerUserId: string): Promise<boolean> {
    const t = OWNER_TABLE[kind];
    if (t === undefined) return false;
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ one: number }>(
        `SELECT 1 AS one FROM ${t.table} WHERE org_id = $1 AND id = $2 AND ${t.owner} = $3`,
        [orgId, resourceId, ownerUserId],
      );
      return r.rows.length > 0;
    });
  }

  async linkResource(input: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly kind: ProjectLinkableResourceKind;
    readonly resourceId: string;
    readonly linkedBy: string;
  }): Promise<LinkResourceOutcome> {
    return this.db.withTenant(input.orgId, async (s) => {
      const found = await s.query<{ id: string }>(`SELECT id FROM projects WHERE id = $1 AND org_id = $2`, [
        input.projectId,
        input.orgId,
      ]);
      if (found.rows[0] === undefined) return { kind: "project-not-found" };
      // 主键 (org_id, kind, resource_id)：同一资源只挂一个项目。已在本项目 ⇒ 不动（xmax=0 判新插）；
      // 在别的项目 ⇒ 改挂到这里。
      const r = await s.query<{ inserted: boolean }>(
        `INSERT INTO project_resource_links (org_id, project_id, kind, resource_id, linked_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (org_id, kind, resource_id) DO UPDATE
           SET project_id = EXCLUDED.project_id,
               linked_by = EXCLUDED.linked_by,
               linked_at = CASE WHEN project_resource_links.project_id = EXCLUDED.project_id
                                THEN project_resource_links.linked_at ELSE now() END
         RETURNING (xmax = 0) AS inserted, (linked_at = now()) AS fresh`,
        [input.orgId, input.projectId, input.kind, input.resourceId, input.linkedBy],
      );
      const row = r.rows[0] as { inserted: boolean; fresh: boolean } | undefined;
      if (row === undefined) return { kind: "project-not-found" };
      return row.inserted || row.fresh ? { kind: "linked" } : { kind: "already-linked" };
    });
  }

  async unlinkResource(orgId: OrgId, projectId: string, kind: ProjectLinkableResourceKind, resourceId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ resource_id: string }>(
        `DELETE FROM project_resource_links
          WHERE org_id = $1 AND project_id = $2 AND kind = $3 AND resource_id = $4
          RETURNING resource_id`,
        [orgId, projectId, kind, resourceId],
      );
      return r.rows.length > 0;
    });
  }
}
