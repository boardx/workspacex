/**
 * PostgreSQL 实现 —— 访谈模板数据模型（F82）。
 *
 * ## `usedCount` 在这里被现查，而不是被携带
 *
 * `list()` 与 `usedCount()` 都是 `COUNT(*) FROM interview_template_applications`，
 * 每次都对着**当下**的套用记录数，而不是把某个缓存的整数搬来搬去。迁移 20260801103000
 * 的头部把这条理由写清楚过一次：没有列可写，比「有一列但被 REVOKE」更彻底。
 *
 * ## `update()` 怎么做到「不改旧行」
 *
 * `FOR UPDATE OF t` 锁的是 `interview_templates` 这一行（身份+指针），不是版本行——
 * 版本行从不会被这个方法 UPDATE，它只会被 INSERT 一条新的。乐观并发的判断
 * （`expectedVersionNumber` 与当前 head 是否一致）在拿到锁之后、插入新版本之前完成，
 * 于是两个并发编辑请求里，后到的那个会看见前一个已经提交的新 head，而不是错过检查窗口。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type {
  ApplyTemplateInput,
  ApplyTemplateResult,
  AppliedTemplateSnapshot,
  CreateTemplateInput,
  TemplateRepository,
  TemplateRowRecord,
  TemplateVersionRecord,
  UpdateTemplateInput,
} from "../../application/interview/template-ports";
import type { TemplateFieldInput, TemplateSectionInput } from "../../domain/interview/template";

interface VersionRowShape {
  template_id: string;
  version_id: string;
  version_number: number;
  name: string;
  goal: string;
  sections: TemplateSectionInput[];
  data_fields: TemplateFieldInput[];
  tags: string[];
  content_hash: string;
  source_interview_ids: string[];
}

const VERSION_COLUMNS = `
  v.template_id, v.id AS version_id, v.version_number, v.name, v.goal,
  v.sections, v.data_fields, v.tags, v.content_hash, v.source_interview_ids`;

const toVersionRecord = (r: VersionRowShape): TemplateVersionRecord => ({
  templateId: r.template_id,
  versionId: r.version_id,
  versionNumber: Number(r.version_number),
  name: r.name,
  goal: r.goal,
  sections: r.sections,
  dataFields: r.data_fields,
  tags: r.tags,
  contentHash: r.content_hash,
  sourceInterviewIds: r.source_interview_ids,
});

export class PgTemplateRepository implements TemplateRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(input: CreateTemplateInput): Promise<TemplateVersionRecord> {
    return this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `INSERT INTO interview_templates (id, org_id, created_by) VALUES ($1,$2,$3)`,
        [input.templateId, input.orgId, input.actorId],
      );
      await s.query(
        `INSERT INTO interview_template_versions
           (id, template_id, org_id, version_number, name, goal, sections, data_fields, tags,
            content_hash, created_by)
         VALUES ($1,$2,$3,1,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)`,
        [
          input.versionId,
          input.templateId,
          input.orgId,
          input.name,
          input.goal,
          JSON.stringify(input.sections),
          JSON.stringify(input.dataFields),
          input.tags,
          input.contentHash,
          input.actorId,
        ],
      );
      await s.query(
        `UPDATE interview_templates SET current_version_id = $1 WHERE org_id = $2 AND id = $3`,
        [input.versionId, input.orgId, input.templateId],
      );
      return {
        templateId: input.templateId,
        versionId: input.versionId,
        versionNumber: 1,
        name: input.name,
        goal: input.goal,
        sections: input.sections,
        dataFields: input.dataFields,
        tags: input.tags,
        contentHash: input.contentHash,
        sourceInterviewIds: [],
      };
    });
  }

  async update(input: UpdateTemplateInput): Promise<TemplateVersionRecord | null> {
    return this.db.withTenant(input.orgId, async (s) => {
      // 锁身份行（不是版本行）：并发编辑的互斥点是「谁先把 current_version_id 前移」。
      const headRes = await s.query<{ current_version_id: string | null; version_number: number | null }>(
        `SELECT t.current_version_id, v.version_number
           FROM interview_templates t
           LEFT JOIN interview_template_versions v ON v.id = t.current_version_id
          WHERE t.org_id = $1 AND t.id = $2
          FOR UPDATE OF t`,
        [input.orgId, input.templateId],
      );
      const head = headRes.rows[0];
      if (head === undefined || head.version_number === null) return null;
      if (Number(head.version_number) !== input.expectedVersionNumber) return null;

      const nextVersionNumber = Number(head.version_number) + 1;
      await s.query(
        `INSERT INTO interview_template_versions
           (id, template_id, org_id, version_number, name, goal, sections, data_fields, tags,
            content_hash, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,
        [
          input.versionId,
          input.templateId,
          input.orgId,
          nextVersionNumber,
          input.name,
          input.goal,
          JSON.stringify(input.sections),
          JSON.stringify(input.dataFields),
          input.tags,
          input.contentHash,
          input.actorId,
        ],
      );
      await s.query(
        `UPDATE interview_templates SET current_version_id = $1 WHERE org_id = $2 AND id = $3`,
        [input.versionId, input.orgId, input.templateId],
      );

      return {
        templateId: input.templateId,
        versionId: input.versionId,
        versionNumber: nextVersionNumber,
        name: input.name,
        goal: input.goal,
        sections: input.sections,
        dataFields: input.dataFields,
        tags: input.tags,
        contentHash: input.contentHash,
        sourceInterviewIds: [],
      };
    });
  }

  async getHead(orgId: OrgId, templateId: string): Promise<TemplateVersionRecord | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<VersionRowShape>(
        `SELECT ${VERSION_COLUMNS}
           FROM interview_templates t
           JOIN interview_template_versions v ON v.id = t.current_version_id AND v.org_id = t.org_id
          WHERE t.org_id = $1 AND t.id = $2`,
        [orgId, templateId],
      );
      const row = r.rows[0];
      return row === undefined ? null : toVersionRecord(row);
    });
  }

  async getVersion(orgId: OrgId, templateId: string, versionId: string): Promise<TemplateVersionRecord | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<VersionRowShape>(
        `SELECT ${VERSION_COLUMNS}
           FROM interview_template_versions v
          WHERE v.org_id = $1 AND v.template_id = $2 AND v.id = $3`,
        [orgId, templateId, versionId],
      );
      const row = r.rows[0];
      return row === undefined ? null : toVersionRecord(row);
    });
  }

  async list(orgId: OrgId): Promise<readonly TemplateRowRecord[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        template_id: string;
        name: string;
        goal: string;
        sections: TemplateSectionInput[];
        used_count: string;
      }>(
        `SELECT t.id AS template_id, v.name, v.goal, v.sections,
                COUNT(a.id) AS used_count
           FROM interview_templates t
           JOIN interview_template_versions v ON v.id = t.current_version_id AND v.org_id = t.org_id
           LEFT JOIN interview_template_applications a
             ON a.template_id = t.id AND a.org_id = t.org_id
          WHERE t.org_id = $1
          GROUP BY t.id, v.name, v.goal, v.sections
          ORDER BY v.name ASC`,
        [orgId],
      );
      return r.rows.map((row) => {
        const minutes = row.sections.map((sec) => sec.minutes);
        return {
          templateId: row.template_id,
          name: row.name,
          usedCount: Number(row.used_count),
          oneLiner: row.goal,
          questionCount: row.sections.length,
          minutesRangeMin: minutes.length > 0 ? Math.min(...minutes) : 0,
          minutesRangeMax: minutes.length > 0 ? Math.max(...minutes) : 0,
        };
      });
    });
  }

  async usedCount(orgId: OrgId, templateId: string): Promise<number> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM interview_template_applications WHERE org_id = $1 AND template_id = $2`,
        [orgId, templateId],
      );
      return Number(r.rows[0]?.n ?? 0);
    });
  }

  async apply(input: ApplyTemplateInput): Promise<ApplyTemplateResult> {
    return this.db.withTenant(input.orgId, async (s) => {
      const versionRes = input.versionId === null
        ? await s.query<VersionRowShape>(
            `SELECT ${VERSION_COLUMNS}
               FROM interview_templates t
               JOIN interview_template_versions v ON v.id = t.current_version_id AND v.org_id = t.org_id
              WHERE t.org_id = $1 AND t.id = $2`,
            [input.orgId, input.templateId],
          )
        : await s.query<VersionRowShape>(
            `SELECT ${VERSION_COLUMNS}
               FROM interview_template_versions v
              WHERE v.org_id = $1 AND v.template_id = $2 AND v.id = $3`,
            [input.orgId, input.templateId, input.versionId],
          );
      const versionRow = versionRes.rows[0];
      if (versionRow === undefined) {
        throw new Error(`template ${input.templateId} (version ${input.versionId ?? "head"}) not found`);
      }
      const version = toVersionRecord(versionRow);

      let interviewId = input.targetInterviewId;
      if (interviewId === null) {
        interviewId = input.newInterviewId;
        await s.query(
          `INSERT INTO interview_sessions
             (id, org_id, project_id, research_project_id, source_kind, title, created_by,
              tags, archived, when_at, applied_template_version_id)
           VALUES ($1,$2,NULL,NULL,'human',$3,$4,'{}',false,NULL,$5)`,
          [interviewId, input.orgId, version.name, input.actorId, version.versionId],
        );
      } else {
        // ⚠ 只在**第一次**套用时写这一列；数据库侧的 `interview_session_template_ref_frozen`
        // 触发器会拒绝对已有值的改指——这里同一句 SQL 对「还没套用过」与「已经套用过」
        // 两种情况都安全：前者是普通 UPDATE，后者若真的发生会被数据库拒绝而不是静默覆盖。
        await s.query(
          `UPDATE interview_sessions
              SET applied_template_version_id = $1
            WHERE org_id = $2 AND id = $3`,
          [version.versionId, input.orgId, interviewId],
        );
      }

      await s.query(
        `INSERT INTO interview_template_applications
           (id, org_id, template_id, template_version_id, interview_id, sections, data_fields, applied_by)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
        [
          input.applicationId,
          input.orgId,
          input.templateId,
          version.versionId,
          interviewId,
          JSON.stringify(version.sections),
          JSON.stringify(version.dataFields),
          input.actorId,
        ],
      );

      return {
        interviewId,
        appliedTemplateVersionId: version.versionId,
        sections: version.sections,
        dataFields: version.dataFields,
      };
    });
  }

  async getAppliedSnapshot(orgId: OrgId, interviewId: string): Promise<AppliedTemplateSnapshot | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        interview_id: string;
        template_id: string;
        template_version_id: string;
        sections: TemplateSectionInput[];
        data_fields: TemplateFieldInput[];
      }>(
        `SELECT interview_id, template_id, template_version_id, sections, data_fields
           FROM interview_template_applications
          WHERE org_id = $1 AND interview_id = $2`,
        [orgId, interviewId],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        interviewId: row.interview_id,
        templateId: row.template_id,
        templateVersionId: row.template_version_id,
        sections: row.sections,
        dataFields: row.data_fields,
      };
    });
  }
}
