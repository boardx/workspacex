/**
 * PostgreSQL 实现 —— 三步向导写入 + AI 大纲草案（F84）。
 *
 * 两个仓储放在同一个文件里，是因为它们服务同一条写路径（三步向导）且都很薄：
 * `PgWizardInterviewRepository` 只在「不用模板」时插一行 `interview_sessions`
 * （与 `PgTemplateRepository.apply()` 建新访谈那几行同构，见文件内注释）；
 * `PgOutlineRepository` 管 `interview_outlines` 这一张表的 upsert。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { OutlineSectionDraft } from "../../domain/interview/outline";
import { guard } from "../../application/security/permission-filter";
import type {
  CreateBlankInterviewInput,
  CreateOutlineInput,
  GuardedOutlineRow,
  OutlineRecord,
  OutlineRepository,
  OutlineStatusName,
  WizardInterviewRepository,
} from "../../application/interview/outline-ports";

/** F90：jsonb 数组里逐段多带一个可选 `status`——不建独立列，见 `markSectionStatus` 头注。 */
type StoredOutlineSection = OutlineSectionDraft & { status?: "done" | "deferred" | null };

interface OutlineRowShape {
  id: string;
  interview_id: string;
  status: OutlineStatusName;
  sections: StoredOutlineSection[];
  manually_edited: boolean;
}

function toSectionRecords(sections: readonly StoredOutlineSection[]): OutlineRecord["sections"] {
  // `sectionId` 不落库为独立列（本迁移把 sections 存成一整个 jsonb 数组，见迁移文件头），
  // 用 `${outlineId}-${order}` 派生一个稳定 id——同一段重新生成后顺序不变则 id 不变，
  // 这对 F85 未来做「保留某一段的手改」有意义，但那是它的范围，这里只保证 id 存在且稳定。
  return sections.map((s) => ({
    sectionId: `sec-${s.order}`,
    objective: s.objective,
    openers: s.openers,
    minutes: s.minutes,
    order: s.order,
    // F90：`create`/`replaceSections`/`updateSections` 都传纯 `OutlineSectionDraft[]`
    // （没有 `status` 键），jsonb 里自然缺省 ⇒ 读回 `null`——AI 重新生成/研究员手改内容
    // 都会清空完成态标记，与「内容变了，进度重新算」的直觉一致。只有 `markSectionStatus`
    // 会往某一段写非 null 的 `status`。
    status: s.status ?? null,
  }));
}

function toRecord(row: OutlineRowShape): OutlineRecord {
  return {
    outlineId: row.id,
    interviewId: row.interview_id,
    status: row.status,
    sections: toSectionRecords(row.sections),
    manuallyEdited: row.manually_edited,
  };
}

const COLUMNS = "id, interview_id, status, sections, manually_edited";

export class PgOutlineRepository implements OutlineRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(input: CreateOutlineInput): Promise<OutlineRecord> {
    return this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<OutlineRowShape>(
        `INSERT INTO interview_outlines (id, org_id, interview_id, status, sections, manually_edited, generated_by)
         VALUES ($1,$2,$3,'pending_confirm',$4::jsonb,false,$5)
         ON CONFLICT (org_id, interview_id) DO UPDATE
           SET sections = EXCLUDED.sections, status = 'pending_confirm', manually_edited = false,
               generated_by = EXCLUDED.generated_by, generated_at = now(), confirmed_at = NULL
         RETURNING ${COLUMNS}`,
        [input.outlineId, input.orgId, input.interviewId, JSON.stringify(input.sections), input.generatedBy],
      );
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return toRecord(r.rows[0]!);
    });
  }

  /**
   * ⚠ 大纲不是独立的可授权对象——`ref` 复用 `{kind: "interview", id: interviewId}`,
   * `facts` 是那场访谈自己的可见性事实（与 `pg-interview-scope-repository.ts` 的
   * `toGuarded` 同一个 ref 身份、同一条 `is_collaborator` 现算规则,见 `outline-ports.ts`
   * `GuardedOutlineRow` 的注释）。调用方必须经 `decideInterviewVisibility` +
   * `discloseDecided` 才能拿到大纲内容。
   */
  async getByInterview(orgId: OrgId, viewerUserId: string, interviewId: string): Promise<GuardedOutlineRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<
        OutlineRowShape & { project_id: string | null; created_by: string; is_collaborator: boolean }
      >(
        `SELECT ${COLUMNS.split(", ").map((c) => `o.${c}`).join(", ")},
                s.project_id, s.created_by,
                EXISTS (
                  SELECT 1 FROM interview_collaborators ic
                   WHERE ic.interview_id = s.id AND ic.org_id = $1 AND ic.user_id = $2
                ) AS is_collaborator
           FROM interview_outlines o
           JOIN interview_sessions s ON s.id = o.interview_id AND s.org_id = o.org_id
          WHERE o.org_id = $1 AND o.interview_id = $3`,
        [orgId, viewerUserId, interviewId],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        item: guard({ kind: "interview", id: interviewId }, toRecord(row)),
        facts: {
          projectId: row.project_id,
          createdBy: row.created_by,
          isExplicitCollaborator: row.is_collaborator,
        },
      };
    });
  }

  async replaceSections(
    orgId: OrgId,
    outlineId: string,
    sections: readonly OutlineSectionDraft[],
  ): Promise<OutlineRecord> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<OutlineRowShape>(
        `UPDATE interview_outlines
            SET sections = $1::jsonb, status = 'pending_confirm', manually_edited = false, confirmed_at = NULL
          WHERE org_id = $2 AND id = $3
          RETURNING ${COLUMNS}`,
        [JSON.stringify(sections), orgId, outlineId],
      );
      const row = r.rows[0];
      if (row === undefined) throw new Error(`outline ${outlineId} not found`);
      return toRecord(row);
    });
  }

  async confirm(orgId: OrgId, outlineId: string): Promise<OutlineRecord> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<OutlineRowShape>(
        `UPDATE interview_outlines
            SET status = 'confirmed', confirmed_at = now()
          WHERE org_id = $1 AND id = $2
          RETURNING ${COLUMNS}`,
        [orgId, outlineId],
      );
      const row = r.rows[0];
      if (row === undefined) throw new Error(`outline ${outlineId} not found`);
      return toRecord(row);
    });
  }

  async getById(orgId: OrgId, outlineId: string): Promise<OutlineRecord | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<OutlineRowShape>(
        `SELECT ${COLUMNS} FROM interview_outlines WHERE org_id = $1 AND id = $2`,
        [orgId, outlineId],
      );
      const row = r.rows[0];
      return row === undefined ? null : toRecord(row);
    });
  }

  /** F85——逐段手改覆盖点：`manually_edited` 恒置 true；已确认过的大纲改后打回 `pending_confirm`。 */
  async updateSections(
    orgId: OrgId,
    outlineId: string,
    sections: readonly OutlineSectionDraft[],
  ): Promise<OutlineRecord> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<OutlineRowShape>(
        `UPDATE interview_outlines
            SET sections = $1::jsonb,
                manually_edited = true,
                status = CASE WHEN status = 'confirmed' THEN 'pending_confirm' ELSE status END,
                confirmed_at = CASE WHEN status = 'confirmed' THEN NULL ELSE confirmed_at END
          WHERE org_id = $2 AND id = $3
          RETURNING ${COLUMNS}`,
        [JSON.stringify(sections), orgId, outlineId],
      );
      const row = r.rows[0];
      if (row === undefined) throw new Error(`outline ${outlineId} not found`);
      return toRecord(row);
    });
  }

  /**
   * F90——逐段人工勾选完成态。⚠ 只重写命中的那一段的 `status`，`sections` 数组其余
   * 元素原样带回：用 `jsonb_agg` + `CASE ... WHEN order 命中 THEN 覆盖 status`
   * 重建整个数组，而不是先 `SELECT` 再在应用层拼好整份 `sections` 传回去——避免
   * 「读出旧数组、拼接、整体覆盖」这种两步之间可能与 `updateSections`/`replaceSections`
   * 交错的写-写竞争（同一行上直接一条 UPDATE 语句完成，数据库层面原子）。
   * `sectionId` 是 `sec-${order}` 派生的（见 `toSectionRecords`），所以按
   * `(elem->>'order')::int` 反解出 order 再比较。
   */
  async markSectionStatus(
    orgId: OrgId,
    outlineId: string,
    sectionId: string,
    status: "done" | "deferred",
  ): Promise<OutlineRecord> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<OutlineRowShape>(
        `UPDATE interview_outlines
            SET sections = (
              SELECT jsonb_agg(
                CASE
                  WHEN ('sec-' || (elem->>'order')) = $4
                    THEN elem || jsonb_build_object('status', $3::text)
                  ELSE elem
                END
                ORDER BY (elem->>'order')::int
              )
              FROM jsonb_array_elements(sections) AS elem
            )
          WHERE org_id = $1 AND id = $2
          RETURNING ${COLUMNS}`,
        [orgId, outlineId, status, sectionId],
      );
      const row = r.rows[0];
      if (row === undefined) throw new Error(`outline ${outlineId} not found`);
      return toRecord(row);
    });
  }
}

export class PgWizardInterviewRepository implements WizardInterviewRepository {
  constructor(private readonly db: DatabasePort) {}

  /**
   * 「不用模板,从空白开始」（A2）——与 `PgTemplateRepository.apply()` 创建新访谈的那几行
   * 同构（都是插一行 `interview_sessions`),区别只是这里没有 `applied_template_version_id`
   * 要写。
   */
  async createBlankInterview(input: CreateBlankInterviewInput): Promise<{ readonly interviewId: string }> {
    await this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `INSERT INTO interview_sessions
           (id, org_id, project_id, research_project_id, source_kind, title, created_by,
            tags, archived, when_at, applied_template_version_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'{}',false,NULL,NULL)`,
        [
          input.interviewId,
          input.orgId,
          input.projectId,
          input.researchProjectId,
          input.sourceKind,
          input.title,
          input.createdBy,
        ],
      );
    });
    return { interviewId: input.interviewId };
  }
}
