import { research as C } from "@repo/contracts";
import type { z } from "zod";
import type { ResearchRuntime } from "./guided-runtime-ports";
import { reportQuestions } from "./guided-report-evidence";

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
function detectedEvidenceConflicts(runtime: ResearchRuntime): Conflict[] {
  const grouped = new Map<string, NonNullable<ResearchRuntime["questionEvidence"]>>();
  for (const item of runtime.questionEvidence ?? []) grouped.set(item.questionId, [...(grouped.get(item.questionId) ?? []), item]);
  const conflicts: Conflict[] = [];
  for (const [questionId, evidence] of grouped) {
    const direct = evidence.filter((item) => item.relevance === "direct");
    for (let left = 0; left < direct.length; left++) for (let right = left + 1; right < direct.length; right++) {
      if (direct[left]!.sourceId === direct[right]!.sourceId) continue;
      const a = [...direct[left]!.quote.matchAll(/\b\d+(?:\.\d+)?%/g)].map((match) => match[0]);
      const b = [...direct[right]!.quote.matchAll(/\b\d+(?:\.\d+)?%/g)].map((match) => match[0]);
      if (!a.length || !b.length || a.some((value) => b.includes(value))) continue;
      // Identify the pair by stable, sorted source IDs (not by position in `direct`), so
      // report regeneration that inserts/reorders evidence cannot make a persisted human
      // resolution for one source pair silently apply to a different pair under the same ID.
      const pairSourceIds = [direct[left]!.sourceId, direct[right]!.sourceId].sort();
      conflicts.push(C.GuidedResearchEvidenceConflict.parse({ id: `detected:${questionId}:${pairSourceIds.join(":")}`,
        claimIds: [questionId, questionId], sourceIds: pairSourceIds,
        severity: "moderate", status: "open", resolution: null }));
    }
  }
  return conflicts;
}

export function projectResearchTrust(runtime: ResearchRuntime): GuidedResearchTrustProjection {
  const sourceById = new Map(runtime.sources.map((source) => [source.id, source]));
  const enabledOutline = runtime.outline.filter((section) => section.enabled);
  const questions = enabledOutline.length ? reportQuestions(enabledOutline) : [];
  const coverage = questions.map((question) => {
    const evidence = (runtime.questionEvidence ?? []).filter((item) => item.questionId === question.id && sourceById.has(item.sourceId));
    const evidenceIds = [...new Set(evidence.map((item) => item.sourceId))];
    const warned = runtime.reportEvidenceWarnings?.some((warning) => warning.questionIds.includes(question.id)) ?? false;
    return C.GuidedResearchCoverageItem.parse({ sectionId: question.sectionId, questionId: question.id,
      status: evidenceIds.length === 0 ? "missing" : warned ? "weak" : "answered", evidenceIds,
      reasons: evidenceIds.length === 0 ? ["没有可定位的逐问题证据"] : warned ? ["证据校验存在警告"] : ["问题具有可定位原文"] });
  });
  const claimEvidence = (runtime.questionEvidence ?? []).flatMap((evidence, index) => {
    const source = sourceById.get(evidence.sourceId);
    if (!source) return [];
    if (!source.document) return [];
    if (!source.document.text.includes(evidence.quote)) return [];
    return [C.GuidedResearchClaimEvidenceView.parse({ claimId: evidence.questionId, evidenceId: `${evidence.questionId}:${index + 1}`,
      quote: evidence.quote, sourceId: evidence.sourceId, retrievedAt: source.document.retrievedAt,
      confidence: evidence.relevance === "direct" ? "high" : "medium", traceIds: source.taskIds ?? [source.taskId] })];
  });
  // A persisted conflict (including a human resolution) is only carried forward while its
  // source pair is still present in freshly detected evidence for that question. Source
  // removal or `refine_scope` can invalidate `questionEvidence`; without this check a stale
  // conflict could keep an `accept`ed/`prefer_source`d decision for evidence that no longer
  // exists, and readiness would be computed from an obsolete resolution.
  const currentEvidenceSourceIds = new Map<string, Set<string>>();
  for (const item of runtime.questionEvidence ?? []) {
    const set = currentEvidenceSourceIds.get(item.questionId) ?? new Set<string>();
    set.add(item.sourceId);
    currentEvidenceSourceIds.set(item.questionId, set);
  }
  const stillEvidenced = (conflict: Conflict) => {
    const questionId = conflict.claimIds[0];
    const sources = questionId ? currentEvidenceSourceIds.get(questionId) : undefined;
    return !!sources && conflict.sourceIds.every((sourceId) => sources.has(sourceId));
  };
  // An explicit human resolution has priority over a mechanically re-detected pair.
  const conflicts = [...new Map([...detectedEvidenceConflicts(runtime), ...(runtime.conflicts ?? []).filter(stillEvidenced)]
    .map((conflict) => [conflict.id, C.GuidedResearchEvidenceConflict.parse(conflict)])).values()];
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
  if (runtime.report && (!claimEvidence.length || coverage.some((item) => item.status === "weak"))) blockers.push("关键结论缺少来源");
  if (conflicts.some((conflict) => conflict.severity === "severe" && conflict.status === "open")) blockers.push("存在未解决的严重冲突");
  const publicationReadiness = C.GuidedResearchPublicationReadiness.parse({ status: blockers.length ? "limited" : "ready", blockers,
    warnings: coverage.some((item) => item.status === "weak") ? ["部分问题证据较弱"] : [], evaluatedAt: new Date().toISOString() });
  return { coverage, claimEvidence, conflicts, qualityScore, publicationReadiness };
}
