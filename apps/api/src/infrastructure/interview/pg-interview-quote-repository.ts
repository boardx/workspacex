/**
 * PostgreSQL 实现 —— `interview_quotes`（F01）。append-only：只 INSERT/SELECT。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { QuoteRepository, StoredQuote } from "../../application/interview/insight-ports";
import type { InterviewSourceKindT } from "../../domain/interview/candidate-insight";

interface QuoteRow {
  id: string;
  interview_id: string;
  segment_id: string;
  subject_id: string | null;
  source_kind: string;
  text: string;
  rq_id: string | null;
}

const toStored = (r: QuoteRow): StoredQuote => ({
  quoteId: r.id,
  interviewId: r.interview_id,
  segmentId: r.segment_id,
  subjectId: r.subject_id,
  sourceKind: r.source_kind as InterviewSourceKindT,
  text: r.text,
  rqId: r.rq_id,
});

export class PgInterviewQuoteRepository implements QuoteRepository {
  constructor(private readonly db: DatabasePort) {}

  async insertMany(orgId: OrgId, actorId: string, rows: readonly StoredQuote[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.withTenant(orgId, async (s) => {
      for (const row of rows) {
        await s.query(
          `INSERT INTO interview_quotes
             (id, org_id, interview_id, segment_id, subject_id, source_kind, text, rq_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO NOTHING`,
          [row.quoteId, orgId, row.interviewId, row.segmentId, row.subjectId, row.sourceKind, row.text, row.rqId, actorId],
        );
      }
    });
  }

  async listByInterviewAndSegments(
    orgId: OrgId,
    interviewId: string,
    segmentIds: readonly string[],
  ): Promise<readonly StoredQuote[]> {
    if (segmentIds.length === 0) return [];
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<QuoteRow>(
        `SELECT id, interview_id, segment_id, subject_id, source_kind, text, rq_id
           FROM interview_quotes
          WHERE org_id = $1 AND interview_id = $2 AND segment_id = ANY($3::text[])
          ORDER BY created_at ASC`,
        [orgId, interviewId, [...segmentIds]],
      );
      return r.rows.map(toStored);
    });
  }

  async getByIds(orgId: OrgId, quoteIds: readonly string[]): Promise<readonly StoredQuote[]> {
    if (quoteIds.length === 0) return [];
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<QuoteRow>(
        `SELECT id, interview_id, segment_id, subject_id, source_kind, text, rq_id
           FROM interview_quotes
          WHERE org_id = $1 AND id = ANY($2::text[])`,
        [orgId, [...quoteIds]],
      );
      return r.rows.map(toStored);
    });
  }
}
