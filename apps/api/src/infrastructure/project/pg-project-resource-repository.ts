/**
 * `ProjectResourcePort` 的 PostgreSQL 实现（项目中枢 B2-S1，#4425；#4615 W2 扩到六类）。
 *
 * 读侧一条 UNION ALL 把六类资源合成一个形状：问卷 / 深度研究 / 个人转写 / 白板 / 设计经 `project_resource_links`
 * JOIN 各自的表（资源被删后链接行悬空 ⇒ JOIN 自然过滤掉）；访谈见下。全部 `withTenant` + 每条谓词带 `org_id`，
 * 返回 `guard({kind:"project"})`——披露由用例拿 `authorize()` 的决策解开。
 *
 * 归属校验按 `kind` 分表，谓词各自的 owner 列（`OWNER_TABLE`，`kind` 闭合枚举到表名的唯一映射）。
 *
 * ## 访谈：链接表 + 既有的 `interview_sessions.project_id`
 *
 * 访谈在 #4615 之前只按 `interview_sessions.project_id` 归属（「在本项目新建」与 F81 环节挂载投影都写这一列，
 * 访谈自己的可见性谓词 `VISIBILITY_PREDICATE` 也读它）。现在它也能「关联已有」走链接表。两者合成一条规则
 * （`INTERVIEW_IN_PROJECT`，证据采集 `pg-evidence-sources.ts` 用同一个常量）：
 *   有链接行 ⇒ 属于链接行的项目（同一资源只挂一个项目，与其它五类同一语义）；
 *   没有链接行 ⇒ 属于 `project_id`（在项目里新建的访谈照旧出现，不必补链接行）。
 * 挂 / 解挂时顺带同步 `project_id`（只动**不是**环节挂载投影给的那一种，`project_id_from_attachment = false`——
 * 投影那一列的唯一写者是 `interview_attachment_project_projection()`，这里不抢），于是访谈自己的可见性谓词
 * 与项目资源视图对「它属于哪个项目」给出同一个答案。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
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
 * 六类可链接资源各自的表、owner 列与 id 表达式——`kind` 是闭合枚举，这里是它到表名的唯一映射。
 * `whiteboards.id` 是 uuid：按文本比较（`id::text`），一个不是 uuid 的 resourceId 就只是「不存在」，不抛 22P02。
 */
const OWNER_TABLE: Record<ProjectLinkableResourceKind, { table: string; owner: string; id: string }> = {
  survey: { table: "survey_workspaces", owner: "owner_id", id: "id" },
  guided_research: { table: "guided_research_sessions", owner: "owner_user_id", id: "id" },
  personal_transcription: { table: "personal_transcriptions", owner: "owner_user_id", id: "id" },
  interview: { table: "interview_sessions", owner: "created_by", id: "id" },
  whiteboard: { table: "whiteboards", owner: "owner_id", id: "id::text" },
  design: { table: "design_projects", owner: "owner_id", id: "id" },
};

/**
 * 访谈 `i` 属于项目 `$2`（组织 `$1`）的**唯一**判据：见文件头「访谈」一节。
 * 用法：`FROM interview_sessions i ${INTERVIEW_LINK_JOIN} WHERE i.org_id = $1 AND ${INTERVIEW_IN_PROJECT}`。
 */
export const INTERVIEW_LINK_JOIN = `LEFT JOIN project_resource_links il
      ON il.org_id = i.org_id AND il.kind = 'interview' AND il.resource_id = i.id`;
export const INTERVIEW_IN_PROJECT = `(il.project_id = $2 OR (il.project_id IS NULL AND i.project_id = $2))`;

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
  SELECT 'whiteboard', w.id::text, w.name, w.owner_id,
         CASE WHEN w.archived THEN 'archived' ELSE NULL END, w.updated_at, l.linked_at
    FROM project_resource_links l
    JOIN whiteboards w ON w.org_id = l.org_id AND w.id::text = l.resource_id
   WHERE l.org_id = $1 AND l.project_id = $2 AND l.kind = 'whiteboard'
  UNION ALL
  SELECT 'design', d.id, d.name, d.owner_id,
         CASE WHEN d.pushed THEN 'pushed' ELSE NULL END, d.updated_at, l.linked_at
    FROM project_resource_links l
    JOIN design_projects d ON d.org_id = l.org_id AND d.id = l.resource_id
   WHERE l.org_id = $1 AND l.project_id = $2 AND l.kind = 'design'
  UNION ALL
  SELECT 'interview', i.id, i.title, i.created_by,
         CASE WHEN i.archived THEN 'archived' ELSE i.digital_status END, i.updated_at,
         COALESCE(il.linked_at, i.created_at)
    FROM interview_sessions i
    ${INTERVIEW_LINK_JOIN}
   WHERE i.org_id = $1 AND ${INTERVIEW_IN_PROJECT}
`;

/**
 * 挂 / 解挂一场访谈时同步 `interview_sessions.project_id`（见文件头）。环节挂载投影给的那一种不动。
 */
async function syncInterviewProject(s: TenantSession, orgId: OrgId, interviewId: string, projectId: string | null, onlyIfIn?: string): Promise<number> {
  const r = await s.query<{ id: string }>(
    `UPDATE interview_sessions
        SET project_id = $3
      WHERE org_id = $1 AND id = $2 AND NOT project_id_from_attachment
        AND project_id IS DISTINCT FROM $3
        AND ($4::text IS NULL OR project_id = $4)
      RETURNING id`,
    [orgId, interviewId, projectId, onlyIfIn ?? null],
  );
  return r.rows.length;
}

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
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ one: number }>(
        `SELECT 1 AS one FROM ${t.table} WHERE org_id = $1 AND ${t.id} = $2 AND ${t.owner} = $3`,
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
      // 访谈：`project_id` 跟着链接走（同一事务）。在本项目里新建、尚无链接行的访谈第一次「关联」时
      // 只补一条链接行，`project_id` 本来就对，不算改挂。
      const moved = input.kind === "interview"
        ? await syncInterviewProject(s, input.orgId, input.resourceId, input.projectId)
        : 0;
      return row.inserted || row.fresh || moved > 0 ? { kind: "linked" } : { kind: "already-linked" };
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
      // 访谈：解挂 = 回到「不属于任何项目」，连同在本项目里新建时写下的 `project_id`（只清指向**本项目**的那一种）。
      const cleared = kind === "interview" ? await syncInterviewProject(s, orgId, resourceId, null, projectId) : 0;
      return r.rows.length > 0 || cleared > 0;
    });
  }
}
