/**
 * PostgreSQL 实现 —— A2 全员拒绝 AI 分析判定所需的"谁拒绝了"（F01）。
 *
 * 算法与 `pg-source-interview-reader.ts` 的 `declinedRes`（同一个"取每个受访者
 * `submitted_at` 最新一条"口径）字面一致：本文件要的是**名单**而不是那个查询的
 * 布尔汇总，所以不能直接复用它的 SQL，但判定口径必须是同一个，不能自己另发明一套。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { ConsentDeclineReader } from "../../application/interview/insight-ports";

export class PgConsentDeclineReader implements ConsentDeclineReader {
  constructor(private readonly db: DatabasePort) {}

  async listAiAnalysisDeclinedSubjects(orgId: OrgId, interviewId: string): Promise<readonly string[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ subject_id: string }>(
        `WITH latest AS (
           SELECT DISTINCT ON (subject_id) subject_id, ai_analysis
             FROM interview_consent_submissions
            WHERE org_id = $1 AND interview_session_id = $2
            ORDER BY subject_id, submitted_at DESC
         )
         SELECT subject_id FROM latest WHERE NOT ai_analysis`,
        [orgId, interviewId],
      );
      return r.rows.map((row) => row.subject_id);
    });
  }
}
