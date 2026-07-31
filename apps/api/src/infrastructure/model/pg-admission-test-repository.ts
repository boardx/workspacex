/**
 * PostgreSQL implementation of the admission log (F49 / migration 0031).
 *
 * ## Append-only is enforced BELOW this class, and that distinction is the point
 *
 * There is no `update` and no `delete` method here. On its own that means "this class does
 * not offer one", which is worth nothing: it says the convenient path has no mutation, not
 * that a mutation is impossible. 0013's header records a GRANT that read as correct and was
 * measured to be bypassable through a cascade. So 0031 carries two triggers as well as a
 * narrow GRANT, and `test-verdict-immutable.test.ts` attacks the table in raw SQL as
 * `app_rw` -- never through this class.
 *
 * ## `judged_at` comes from the database, `record_id` from here
 *
 * The timestamp is the store's, so two judgements cannot be ordered by a clock the caller
 * controls; `seq` (an identity column) is the actual tie-break and is likewise the store's.
 * The id is generated here because it is not ordering information -- it is a handle.
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { AdmissionTestRepository } from "../../application/model/ports";
import type { StoredAdmissionTest } from "../../domain/model/admission";
import { toOrgId } from "../../domain/org-id";

interface Row {
  record_id: string;
  model_id: string;
  item: string;
  verdict: string;
  evidence: string;
  judged_by: string;
  judged_at: Date;
  seq: string;
}

const toRecord = (r: Row): StoredAdmissionTest => ({
  recordId: r.record_id,
  modelId: r.model_id,
  item: r.item as StoredAdmissionTest["item"],
  verdict: r.verdict as StoredAdmissionTest["verdict"],
  evidence: r.evidence,
  judgedBy: r.judged_by,
  // ISO 8601, as `AdmissionTestRecord` declares. A `Date` here would serialise to the same
  // string today and stop doing so the moment anything wraps this in another serialiser.
  judgedAt: r.judged_at.toISOString(),
  // bigint arrives as a string from node-postgres. Number() is safe for an identity counter
  // and keeps `seq` comparable with `>`; a lexicographic comparison on the string would
  // order 10 before 9, which is precisely the "which verdict is later" question.
  seq: Number(r.seq),
});

export class PgAdmissionTestRepository implements AdmissionTestRepository {
  constructor(private readonly db: DatabasePort) {}

  async append(input: {
    readonly orgId: string;
    readonly modelId: string;
    readonly item: StoredAdmissionTest["item"];
    readonly verdict: StoredAdmissionTest["verdict"];
    readonly evidence: string;
    readonly judgedBy: string;
  }): Promise<StoredAdmissionTest> {
    return this.db.withTenant(toOrgId(input.orgId), async (s) => {
      const r = await s.query<Row>(
        `INSERT INTO model_admission_tests
           (record_id, model_id, org_id, item, verdict, evidence, judged_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING record_id, model_id, item, verdict, evidence, judged_by, judged_at, seq`,
        [
          randomUUID(),
          input.modelId,
          input.orgId,
          input.item,
          input.verdict,
          input.evidence,
          input.judgedBy,
        ],
      );
      return toRecord(r.rows[0]!);
    });
  }

  async listForModel(orgId: string, modelId: string): Promise<readonly StoredAdmissionTest[]> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const r = await s.query<Row>(
        `SELECT record_id, model_id, item, verdict, evidence, judged_by, judged_at, seq
           FROM model_admission_tests
          WHERE model_id = $1
          ORDER BY seq ASC`,
        [modelId],
      );
      return r.rows.map(toRecord);
    });
  }
}
