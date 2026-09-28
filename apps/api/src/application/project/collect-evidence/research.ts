/**
 * 深研来源 → 证据单元（`source_kind = research_source`）。
 *
 * 粒度：每个已接受（`decision = accepted`）的来源一条，`sourceRef = sourceId`；摘录是「来源标题 — 摘要」
 * （摘要优先取模型整理的一句 `presentation.summary`，没有就取抓回正文的开头）；`locator` 为空对象
 * （网页来源没有页码 / 时间）；说话人为 null（来源是文章，不是人）。待定 / 已排除的来源不采。
 */
import type { UpsertEvidenceCommand } from "../project-evidence-ports";
import { clipExcerpt, disclosedOrNull, EMPTY_RESULT, upsertAll, type CollectorDeps, type CollectorInput, type CollectResult } from "./shared";

export async function collectResearchEvidence(deps: CollectorDeps, input: CollectorInput): Promise<CollectResult> {
  const docs = disclosedOrNull(await deps.sources.researchSessionsOf(input.orgId, input.projectId), input.decision);
  if (docs === null) return EMPTY_RESULT;
  const commands: UpsertEvidenceCommand[] = docs.flatMap((doc) =>
    doc.sources.map((src) => ({
      orgId: input.orgId,
      projectId: input.projectId,
      sourceKind: "research_source" as const,
      resourceId: doc.sessionId,
      sourceRef: src.sourceId,
      excerpt: clipExcerpt(src.title && src.summary ? `${src.title} — ${src.summary}` : src.summary || src.title),
      locator: {},
      speakerLabel: null,
      resourceTitle: doc.title,
    })),
  );
  return upsertAll(deps.evidence, commands);
}
