/**
 * PostgreSQL 实现 —— `extractQuotes` 的直连片段读取（F01）。
 *
 * 读 `segment_text.content` + F93 加的 `speaker_subject_id`，联 `interview_subjects` 取
 * 该说话人的 `source_kind`（真人/虚拟）。`speaker_subject_id` 为 null 或未解析到
 * `interview_subjects` 行时，`subjectId` 一律 null、`sourceKind` 默认 `human`——
 * 这是"没有已解析说话人"，不是"虚拟"，两者不可混同。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { SegmentForQuote, SegmentReader } from "../../application/interview/insight-ports";
import type { InterviewSourceKindT } from "../../domain/interview/candidate-insight";

interface SegmentRow {
  segment_id: string;
  content: string;
  subject_id: string | null;
  source_kind: string | null;
}

export class PgSegmentReader implements SegmentReader {
  constructor(private readonly db: DatabasePort) {}

  async readSegments(orgId: OrgId, segmentIds: readonly string[]): Promise<readonly SegmentForQuote[]> {
    if (segmentIds.length === 0) return [];
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<SegmentRow>(
        `SELECT st.segment_id                AS segment_id,
                st.content                    AS content,
                st.speaker_subject_id          AS subject_id,
                isub.source_kind               AS source_kind
           FROM segment_text st
           LEFT JOIN interview_subjects isub
             ON isub.id = st.speaker_subject_id AND isub.org_id = st.org_id
          WHERE st.org_id = $1 AND st.segment_id = ANY($2::text[])`,
        [orgId, [...segmentIds]],
      );
      return r.rows.map((row) => ({
        segmentId: row.segment_id,
        text: row.content,
        subjectId: row.subject_id,
        sourceKind: (row.source_kind ?? "human") as InterviewSourceKindT,
      }));
    });
  }
}
