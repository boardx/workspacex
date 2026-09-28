/**
 * 问卷答卷 → 证据单元（`source_kind = survey_response`）。
 *
 * 粒度：每份答卷的每一题一条（`sourceRef = <responseId>:<questionId>`），摘录是「题目：答案」；
 * `locator.ordinal` 取题号；答题人**一律匿名**（`speakerLabel = null`）——问卷的匿名承诺不因进了
 * 项目大脑而失效。被排除出分析的答卷（`analysis = excluded`）不采；没有答案文本的题跳过。
 */
import type { UpsertEvidenceCommand } from "../project-evidence-ports";
import { clipExcerpt, disclosedOrNull, EMPTY_RESULT, upsertAll, type CollectorDeps, type CollectorInput, type CollectResult } from "./shared";

/** 答案值三种形状（字符串 / 字符串列表 / 字段→值）压成一句。 */
export function answerText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).join("、");
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}：${answerText(v)}`)
      .filter((s) => !s.endsWith("："))
      .join("；");
  }
  return "";
}

export async function collectSurveyEvidence(deps: CollectorDeps, input: CollectorInput): Promise<CollectResult> {
  const docs = disclosedOrNull(await deps.sources.surveysOf(input.orgId, input.projectId), input.decision);
  if (docs === null) return EMPTY_RESULT;
  const commands: UpsertEvidenceCommand[] = [];
  for (const doc of docs) {
    const questions = new Map(doc.questions.map((q) => [q.id, q]));
    for (const resp of doc.responses) {
      if (resp.analysis === "excluded") continue;
      for (const a of resp.answers) {
        const q = questions.get(a.questionId);
        const text = answerText(a.value);
        commands.push({
          orgId: input.orgId,
          projectId: input.projectId,
          sourceKind: "survey_response",
          resourceId: doc.surveyId,
          sourceRef: `${resp.id}:${a.questionId}`,
          excerpt: text === "" ? "" : clipExcerpt(q?.title ? `${q.title}：${text}` : text),
          locator: q !== undefined && q.order > 0 ? { ordinal: q.order } : {},
          speakerLabel: null,
          resourceTitle: doc.title,
        });
      }
    }
  }
  return upsertAll(deps.evidence, commands);
}
