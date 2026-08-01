/**
 * PostgreSQL 实现 —— F88 门禁的系统级读端口（`ConsentGateSubjectReader`）。
 *
 * ⚠ 故意不复用 `PgConsentSubmissionStore.latestFor`（逐个 subject 查一次、且经
 * `guard()`）：门禁要的是「这一场全部名单成员」一次查询的结果，且**不**对任何 viewer
 * 做可见性过滤（见 `consent-gate.ts` 文件头「为什么不经 `Guarded`」）。这里直接对
 * `interview_session_subjects` ⋈ `interview_subjects` 取 `mode`，`LEFT JOIN LATERAL`
 * 取每个对象在 `interview_consent_submissions` 里 `submitted_at` 最大的一行——
 * 「当前状态＝最新一次提交」这条规则只在这一处（以及 `pg-consent-submission-store.ts`
 * 的 `ORDER BY ... DESC LIMIT 1`）出现，两处算法字面一致，不是巧合。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { SubjectMode } from "../../domain/interview/subject";
import type { ConsentGateSubjectReader, ConsentGateSubjectRow } from "../../application/interview/consent-gate";

interface RosterRowShape {
  subject_id: string;
  mode: SubjectMode;
  record: boolean | null;
  transcript: boolean | null;
  ai_analysis: boolean | null;
  attribution: boolean | null;
}

export class PgConsentGateReader implements ConsentGateSubjectReader {
  constructor(private readonly db: DatabasePort) {}

  async rosterWithConsent(orgId: OrgId, interviewSessionId: string): Promise<readonly ConsentGateSubjectRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<RosterRowShape>(
        `SELECT
           iss.subject_id                AS subject_id,
           isub.mode                     AS mode,
           latest.record                 AS record,
           latest.transcript             AS transcript,
           latest.ai_analysis            AS ai_analysis,
           latest.attribution            AS attribution
         FROM interview_session_subjects iss
         JOIN interview_subjects isub
           ON isub.id = iss.subject_id AND isub.org_id = iss.org_id
         LEFT JOIN LATERAL (
           SELECT ics.record, ics.transcript, ics.ai_analysis, ics.attribution
             FROM interview_consent_submissions ics
            WHERE ics.org_id = iss.org_id
              AND ics.interview_session_id = iss.interview_session_id
              AND ics.subject_id = iss.subject_id
            ORDER BY ics.submitted_at DESC
            LIMIT 1
         ) latest ON true
         WHERE iss.org_id = $1 AND iss.interview_session_id = $2`,
        [orgId, interviewSessionId],
      );
      return r.rows.map((row) => ({
        subjectId: row.subject_id,
        mode: row.mode,
        bits:
          row.record === null
            ? null
            : {
                record: row.record,
                transcript: row.transcript as boolean,
                ai_analysis: row.ai_analysis as boolean,
                attribution: row.attribution as boolean,
              },
      }));
    });
  }
}
