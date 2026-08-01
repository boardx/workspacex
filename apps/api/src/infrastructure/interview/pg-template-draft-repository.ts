/**
 * PostgreSQL 实现 —— 反向抽取草案存储（F83）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type {
  SaveTemplateDraftInput,
  TemplateDraftRecord,
  TemplateDraftStore,
} from "../../application/interview/template-draft-ports";
import type { TemplateFieldInput, TemplateSectionInput } from "../../domain/interview/template";

interface DraftRowShape {
  id: string;
  org_id: string;
  name: string;
  goal: string;
  sections: TemplateSectionInput[];
  data_fields: TemplateFieldInput[];
  source_interview_ids: string[];
  confirmed_template_id: string | null;
}

const toRecord = (r: DraftRowShape): TemplateDraftRecord => ({
  draftId: r.id,
  orgId: r.org_id as OrgId,
  name: r.name,
  goal: r.goal,
  sections: r.sections,
  dataFields: r.data_fields,
  tags: [],
  sourceInterviewIds: r.source_interview_ids,
  confirmedTemplateId: r.confirmed_template_id,
});

const DRAFT_COLUMNS = `id, org_id, name, goal, sections, data_fields, source_interview_ids, confirmed_template_id`;

export class PgTemplateDraftRepository implements TemplateDraftStore {
  constructor(private readonly db: DatabasePort) {}

  async save(input: SaveTemplateDraftInput): Promise<TemplateDraftRecord> {
    return this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `INSERT INTO interview_template_drafts
           (id, org_id, name, goal, sections, data_fields, source_interview_ids, created_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
        [
          input.draftId,
          input.orgId,
          input.name,
          input.goal,
          JSON.stringify(input.sections),
          JSON.stringify(input.dataFields),
          input.sourceInterviewIds,
          input.actorId,
        ],
      );
      return {
        draftId: input.draftId,
        orgId: input.orgId,
        name: input.name,
        goal: input.goal,
        sections: input.sections,
        dataFields: input.dataFields,
        tags: [],
        sourceInterviewIds: input.sourceInterviewIds,
        confirmedTemplateId: null,
      };
    });
  }

  async get(orgId: OrgId, draftId: string): Promise<TemplateDraftRecord | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<DraftRowShape>(
        `SELECT ${DRAFT_COLUMNS} FROM interview_template_drafts WHERE org_id = $1 AND id = $2`,
        [orgId, draftId],
      );
      const row = r.rows[0];
      return row === undefined ? null : toRecord(row);
    });
  }

  async markConfirmed(orgId: OrgId, draftId: string, templateId: string): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `UPDATE interview_template_drafts
            SET confirmed_template_id = $1, confirmed_at = now()
          WHERE org_id = $2 AND id = $3`,
        [templateId, orgId, draftId],
      );
    });
  }
}
