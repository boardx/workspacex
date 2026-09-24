import { research as C } from "@repo/contracts";
import type { z } from "zod";
import type { ResearchRuntime } from "./guided-runtime-ports";

type Coverage = z.infer<typeof C.GuidedResearchCoverageItem>;
type ClaimEvidence = z.infer<typeof C.GuidedResearchClaimEvidenceView>;
type Conflict = z.infer<typeof C.GuidedResearchEvidenceConflict>;
type Quality = z.infer<typeof C.GuidedResearchQualityScore>;
type Readiness = z.infer<typeof C.GuidedResearchPublicationReadiness>;
export interface GuidedResearchTrustProjection {
  coverage: Coverage[];
  claimEvidence: ClaimEvidence[];
  conflicts: Conflict[];
  qualityScore: Quality;
  publicationReadiness: Readiness;
}

function rounded(value: number): number { return Math.round(value * 10) / 10; }
function average(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? rounded(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
}

export function projectResearchTrust(runtime: ResearchRuntime): GuidedResearchTrustProjection {
  const sourceById = new Map(runtime.sources.map((source) => [source.id, source]));
  const reportBySection = new Map(runtime.report?.sections.map((section) => [section.sectionId, section]) ?? []);
  const coverage = runtime.outline.filter((section) => section.enabled).flatMap((section) => section.questions.map((question, questionIndex) => {
    const evidenceIds = (reportBySection.get(section.id)?.sourceIds ?? []).filter((id) => sourceById.has(id));
    const warned = runtime.reportEvidenceWarnings?.some((warning) => warning.questionIds.includes(`${section.id}:q${questionIndex + 1}`)) ?? false;
    return C.GuidedResearchCoverageItem.parse({ sectionId: section.id, questionId: `${section.id}:q${questionIndex + 1}`,
      status: evidenceIds.length === 0 ? "missing" : warned ? "weak" : "answered", evidenceIds,
      reasons: evidenceIds.length === 0 ? ["没有可定位的已接受来源"] : warned ? ["证据校验存在警告"] : ["报告章节包含可定位来源"] });
  }));
  const claimEvidence = (runtime.report?.sections ?? []).flatMap((section) => section.sourceIds.flatMap((sourceId, index) => {
    const source = sourceById.get(sourceId);
    if (!source) return [];
    return [C.GuidedResearchClaimEvidenceView.parse({ claimId: `${section.sectionId}:claim:${index + 1}`, evidenceId: sourceId,
      quote: (source.document?.text ?? source.content).slice(0, 2000), sourceId, retrievedAt: source.document?.retrievedAt ?? source.retrievedAt,
      confidence: source.document ? "high" : "medium", traceIds: source.taskIds ?? [source.taskId] })];
  }));
  const conflicts = (runtime.conflicts ?? []).map((conflict) => C.GuidedResearchEvidenceConflict.parse(conflict));
  const answered = coverage.filter((item) => item.status === "answered").length;
  const citationCoverage = coverage.length ? rounded(answered / coverage.length * 100) : null;
  const accepted = runtime.sources.filter((source) => source.decision === "accepted");
  const authority = accepted.length ? rounded(accepted.filter((source) => source.document && !source.document.truncated).length / accepted.length * 100) : null;
  const now = Date.now();
  const recent = accepted.filter((source) => Number.isFinite(Date.parse(source.retrievedAt)) && now - Date.parse(source.retrievedAt) <= 365 * 86400000).length;
  const recency = accepted.length ? rounded(recent / accepted.length * 100) : null;
  const crossValidated = coverage.filter((item) => new Set(item.evidenceIds).size >= 2).length;
  const crossValidation = coverage.length ? rounded(crossValidated / coverage.length * 100) : null;
  const openGapCount = coverage.filter((item) => item.status !== "answered").length;
  const qualityScore = C.GuidedResearchQualityScore.parse({ citationCoverage, authority, recency, crossValidation,
    openGapCount, overall: average([citationCoverage, authority, recency, crossValidation]),
    explanations: ["引用覆盖按已回答问题计算", "权威性按具有完整读取文档的来源计算", "时效性按近一年检索时间计算", "交叉验证按至少两个来源的问题计算"] });
  const blockers: string[] = [];
  if (!coverage.length || coverage.some((item) => item.status === "missing")) blockers.push("核心问题覆盖不足");
  if (runtime.report && !claimEvidence.length) blockers.push("关键结论缺少来源");
  if (conflicts.some((conflict) => conflict.severity === "severe" && conflict.status === "open")) blockers.push("存在未解决的严重冲突");
  const publicationReadiness = C.GuidedResearchPublicationReadiness.parse({ status: blockers.length ? "limited" : "ready", blockers,
    warnings: coverage.some((item) => item.status === "weak") ? ["部分问题证据较弱"] : [], evaluatedAt: new Date().toISOString() });
  return { coverage, claimEvidence, conflicts, qualityScore, publicationReadiness };
}
