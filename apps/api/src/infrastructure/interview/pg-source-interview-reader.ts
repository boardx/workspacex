/**
 * PostgreSQL 实现 —— 反向抽取的来源访谈素材读取（F83）。
 *
 * ⚠ **不判可访问性**——那道门在 `extract-template-draft.ts` 用例里已经过一遍
 * `InterviewScopeRepository.findVisibleById` + `decideInterviewVisibility`（与
 * `getInterview` 同一条既有路径）。这个文件只在那道门放行**之后**才会被调用，
 * 因此它读的 `interview_consent_submissions` / `interview_template_applications`
 * 不是第二道未判定的门，而是已授权动作范围内的取数——与
 * `pg-agenda-segment-repository.ts`（F119）、`pg-project-archive-repository.ts`（F124）
 * 那两条允许清单条目同一个形状：授权已经在上一层做过，这里只是继续做那件被批准的事。
 *
 * ## 两件事，逐个查
 *
 * 1. **O-05 过滤**（本实现选定的粒度，见 `domain/interview/template-draft.ts` 文件头）：
 *    这场访谈的受访者里，有没有人对 `ai_analysis` 明确表示拒绝（取每个受访者
 *    `submitted_at` 最新一条）。有 ⇒ 整场排除在抽取输入之外。
 * 2. **素材**：这场访谈实际套用过的三样东西（`interview_template_applications`，F82 已建）。
 *    没套用过任何模板 ⇒ 素材为空数组，仍然不算错误，只是不贡献任何 sections/dataFields。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type {
  SourceInterviewMaterialLookup,
  TemplateDraftSourceReader,
} from "../../application/interview/template-draft-ports";
import type { TemplateFieldInput, TemplateSectionInput } from "../../domain/interview/template";

export class PgSourceInterviewReader implements TemplateDraftSourceReader {
  constructor(private readonly db: DatabasePort) {}

  async readSourceMaterials(
    orgId: OrgId,
    sourceInterviewIds: readonly string[],
  ): Promise<readonly SourceInterviewMaterialLookup[]> {
    if (sourceInterviewIds.length === 0) return [];

    return this.db.withTenant(orgId, async (s) => {
      const results: SourceInterviewMaterialLookup[] = [];

      for (const interviewId of sourceInterviewIds) {
        const declinedRes = await s.query<{ any_declined: boolean | null }>(
          `WITH latest AS (
             SELECT DISTINCT ON (subject_id) subject_id, ai_analysis
               FROM interview_consent_submissions
              WHERE org_id = $1 AND interview_session_id = $2
              ORDER BY subject_id, submitted_at DESC
           )
           SELECT bool_or(NOT ai_analysis) AS any_declined FROM latest`,
          [orgId, interviewId],
        );
        const aiAnalysisAllowed = declinedRes.rows[0]?.any_declined !== true;

        const appliedRes = await s.query<{
          sections: TemplateSectionInput[];
          data_fields: TemplateFieldInput[];
        }>(
          `SELECT sections, data_fields
             FROM interview_template_applications
            WHERE org_id = $1 AND interview_id = $2`,
          [orgId, interviewId],
        );
        const applied = appliedRes.rows[0];

        results.push({
          interviewId,
          aiAnalysisAllowed,
          sections: applied?.sections ?? [],
          dataFields: applied?.data_fields ?? [],
        });
      }

      return results;
    });
  }
}
