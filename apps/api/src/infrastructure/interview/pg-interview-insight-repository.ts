/**
 * PostgreSQL 实现 —— `interview_insights` + `interview_insight_source_snapshots`（F01）。
 *
 * ⚠ `confirm` 在**一次 `withTenant` 回调**（= 一个事务）里做两次 INSERT：快照先落、
 *   洞察引用它的 id 后落。两者要么都提交要么都不提交——不存在"快照进去了、洞察没进去"
 *   的中间态，也不存在反过来的（洞察的 FK 会直接拒绝后者）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type {
  ConfirmInsightWrite,
  InsightRepository,
  StoredInsight,
} from "../../application/interview/insight-ports";
import type { InterviewSourceKindT } from "../../domain/interview/candidate-insight";

interface InsightRow {
  id: string;
  interview_id: string;
  text: string;
  source_kind: string;
  strong: boolean;
  evidence_quote_ids: string[];
  pinned_source_snapshot_id: string;
}

const toStored = (r: InsightRow): StoredInsight => ({
  insightId: r.id,
  interviewId: r.interview_id,
  text: r.text,
  sourceKind: r.source_kind as InterviewSourceKindT,
  strong: r.strong,
  evidenceQuoteIds: r.evidence_quote_ids,
  pinnedSourceSnapshotId: r.pinned_source_snapshot_id,
});

export class PgInterviewInsightRepository implements InsightRepository {
  constructor(private readonly db: DatabasePort) {}

  async confirm(write: ConfirmInsightWrite): Promise<StoredInsight> {
    return this.db.withTenant(write.orgId, async (s) => {
      const snapshotId = `${write.insightId}-snap`;
      await s.query(
        `INSERT INTO interview_insight_source_snapshots (id, org_id, quotes)
         VALUES ($1, $2, $3::jsonb)`,
        [snapshotId, write.orgId, JSON.stringify(write.frozenQuotes)],
      );

      const evidenceQuoteIds = write.frozenQuotes.map((q) => q.quoteId);
      const r = await s.query<InsightRow>(
        `INSERT INTO interview_insights
           (id, org_id, interview_id, text, source_kind, strong, evidence_quote_ids,
            pinned_source_snapshot_id, excluded_subject_ids, created_by)
         VALUES ($1, $2, $3, $4, $5, false, $6::text[], $7, $8::text[], $9)
         RETURNING id, interview_id, text, source_kind, strong, evidence_quote_ids, pinned_source_snapshot_id`,
        [
          write.insightId, write.orgId, write.interviewId, write.text, write.sourceKind,
          evidenceQuoteIds, snapshotId, [...write.excludedSubjectIds], write.actorId,
        ],
      );
      const row = r.rows[0];
      if (row === undefined) throw new Error(`confirmInsight: insert did not return a row for ${write.insightId}`);
      return toStored(row);
    });
  }

  async getById(orgId: OrgId, insightId: string): Promise<StoredInsight | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<InsightRow>(
        `SELECT id, interview_id, text, source_kind, strong, evidence_quote_ids, pinned_source_snapshot_id
           FROM interview_insights
          WHERE org_id = $1 AND id = $2`,
        [orgId, insightId],
      );
      const row = r.rows[0];
      return row === undefined ? null : toStored(row);
    });
  }
}
