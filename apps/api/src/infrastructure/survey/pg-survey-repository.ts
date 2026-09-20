import type { SurveyLibraryTemplate, SurveyTemplateInput } from "@repo/contracts/survey-template-library";
import { assertTemplateUpdate, type SurveyTemplateRepository } from "../../application/survey/survey-template-service";
import type { DatabasePort } from "../../application/ports/database.port";
import {
  SurveyError,
  type SurveyRecord,
  type SurveyRepository,
} from "../../application/survey/survey-service";
import type { OrgId } from "../../domain/org-id";
import type { SurveyRuntime } from "@repo/contracts/survey-runtime";
export class PgSurveyRepository implements SurveyRepository, SurveyTemplateRepository {
  constructor(private readonly db: DatabasePort) {}
  list(orgId: OrgId, ownerId: string) {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ document: SurveyRecord }>(
        "SELECT document FROM survey_workspaces WHERE org_id=$1 AND owner_id=$2 ORDER BY updated_at DESC",
        [orgId, ownerId],
      );
      return r.rows.map((r) => r.document.model);
    });
  }
  async create(orgId: OrgId, record: SurveyRecord) {
    await this.db.withTenant(orgId, (s) =>
      s.query(
        "INSERT INTO survey_workspaces(org_id,id,owner_id,document) VALUES($1,$2,$3,$4::jsonb)",
        [orgId, record.model.id, record.ownerId, JSON.stringify(record)],
      ),
    );
  }
  transact<T>(
    orgId: OrgId,
    id: string,
    work: (record: SurveyRecord) => T,
  ): Promise<T> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ document: SurveyRecord }>(
        "SELECT document FROM survey_workspaces WHERE org_id=$1 AND id=$2 FOR UPDATE",
        [orgId, id],
      );
      const record = result.rows[0]?.document;
      if (!record) throw new SurveyError("not_found");
      const before = JSON.stringify(record);
      const value = work(record);
      const after = JSON.stringify(record);
      if (before !== after)
        await s.query(
          "UPDATE survey_workspaces SET document=$3::jsonb,updated_at=now() WHERE org_id=$1 AND id=$2",
          [orgId, id, after],
        );
      return value;
    });
  }
  async delete(orgId: OrgId, id: string, ownerId: string, version: number) {
    await this.db.withTenant(orgId, async (s) => {
      const rows = await s.query<{ owner_id: string; document: SurveyRecord }>(
        "SELECT owner_id,document FROM survey_workspaces WHERE org_id=$1 AND id=$2 FOR UPDATE",
        [orgId, id],
      );
      const row = rows.rows[0];
      if (!row || row.owner_id !== ownerId) throw new SurveyError("not_found");
      if (row.document.model.version !== version)
        throw new SurveyError("version_conflict");
      await s.query("DELETE FROM survey_workspaces WHERE org_id=$1 AND id=$2", [
        orgId,
        id,
      ]);
    });
  }
  listTemplates(orgId: OrgId, ownerId: string, kind?: SurveyTemplateInput["kind"]) {
    return this.db.withTenant(orgId, async session => {
      const result = await session.query<{ document: SurveyLibraryTemplate }>(
        "SELECT document FROM survey_library_templates WHERE org_id=$1 AND owner_id=$2 AND ($3::text IS NULL OR kind=$3) ORDER BY updated_at DESC,id",
        [orgId, ownerId, kind ?? null],
      );
      return result.rows.map(row => row.document);
    });
  }
  async createTemplate(orgId: OrgId, ownerId: string, model: SurveyLibraryTemplate) {
    await this.db.withTenant(orgId, session => session.query(
      "INSERT INTO survey_library_templates(org_id,id,owner_id,kind,document) VALUES($1,$2,$3,$4,$5::jsonb)",
      [orgId, model.id, ownerId, model.kind, JSON.stringify(model)],
    ));
  }
  getTemplate(orgId: OrgId, ownerId: string, id: string) {
    return this.db.withTenant(orgId, async session => {
      const result = await session.query<{ document: SurveyLibraryTemplate }>(
        "SELECT document FROM survey_library_templates WHERE org_id=$1 AND owner_id=$2 AND id=$3", [orgId, ownerId, id],
      );
      if (!result.rows[0]) throw new SurveyError("not_found");
      return result.rows[0].document;
    });
  }
  updateTemplate(orgId: OrgId, ownerId: string, id: string, version: number, input: SurveyTemplateInput) {
    return this.db.withTenant(orgId, async session => {
      const result = await session.query<{ document: SurveyLibraryTemplate }>(
        "SELECT document FROM survey_library_templates WHERE org_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE", [orgId, ownerId, id],
      );
      const current = result.rows[0]?.document;
      if (!current) throw new SurveyError("not_found");
      assertTemplateUpdate(current, version, input.kind);
      const model: SurveyLibraryTemplate = { kind: input.kind, title: input.title, description: input.description, questions: input.questions, template: input.template, id, version: current.version + 1, updatedAt: new Date().toISOString() };
      await session.query("UPDATE survey_library_templates SET document=$4::jsonb,updated_at=now() WHERE org_id=$1 AND owner_id=$2 AND id=$3", [orgId, ownerId, id, JSON.stringify(model)]);
      return model;
    });
  }
  async deleteTemplate(orgId: OrgId, ownerId: string, id: string, version: number) {
    await this.db.withTenant(orgId, async session => {
      const result = await session.query<{ document: SurveyLibraryTemplate }>(
        "SELECT document FROM survey_library_templates WHERE org_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE", [orgId, ownerId, id],
      );
      const current = result.rows[0]?.document;
      if (!current) throw new SurveyError("not_found");
      assertTemplateUpdate(current, version, current.kind);
      const deleted = await session.query("DELETE FROM survey_library_templates WHERE org_id=$1 AND owner_id=$2 AND id=$3 RETURNING id", [orgId, ownerId, id]);
      if (!deleted.rows.length) throw new SurveyError("invalid_survey");
    });
  }

}
