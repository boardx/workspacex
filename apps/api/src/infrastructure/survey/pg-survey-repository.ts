import type { DatabasePort } from "../../application/ports/database.port";
import {
  SurveyError,
  type SurveyRecord,
  type SurveyRepository,
} from "../../application/survey/survey-service";
import type { OrgId } from "../../domain/org-id";
import type { SurveyRuntime } from "@repo/contracts/survey-runtime";
export class PgSurveyRepository implements SurveyRepository {
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
}
