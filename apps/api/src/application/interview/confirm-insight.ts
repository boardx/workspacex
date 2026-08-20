/**
 * `confirmInsight` —— 确认候选入库，固化来源快照（F01，uc-6-5 R3 step3）。
 *
 * ⚠ **至少 1 条证据**（I-29）：`checkConfirmable` 是 `generateCandidateInsights` 里
 *   `buildCandidateInsight` 复用的**同一道门**（见 `domain/interview/candidate-insight.ts`
 *   文件头），这里再核一次是因为候选可能带着客户端直传的编辑态（`edits`）经过，
 *   不能只信任生成时已经查过。
 * ⚠ **固化来源快照**（R7）：`InsightRepository.confirm` 在一个事务内插快照 + 插洞察，
 *   两者要么都进去要么都不进去；快照文本是抽取那一刻的冻结副本，不是对
 *   `interview_quotes` 行的引用（migration 文件头）。
 */
import type { OrgId } from "../../domain/org-id";
import { checkConfirmable } from "../../domain/interview/candidate-insight";
import { InsightCandidateNotFoundError, InsightNoEvidenceError } from "./errors";
import type { InsightCandidateStore, InsightRepository, QuoteRepository } from "./insight-ports";

export interface ConfirmInsightDeps {
  readonly candidates: InsightCandidateStore;
  readonly quotes: QuoteRepository;
  readonly insights: InsightRepository;
}

export interface ConfirmInsightInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly candidateId: string;
  readonly edits: string | null;
}

export async function confirmInsight(deps: ConfirmInsightDeps, input: ConfirmInsightInput) {
  const candidate = await deps.candidates.get(input.orgId, input.candidateId);
  if (candidate === null) throw new InsightCandidateNotFoundError(input.candidateId);

  const gate = checkConfirmable({ evidenceQuoteIds: [...candidate.evidenceQuoteIds] });
  if (!gate.ok) throw new InsightNoEvidenceError();

  const quoteRows = await deps.quotes.getByIds(input.orgId, candidate.evidenceQuoteIds);
  // 候选引用的引述在确认这一刻必须仍然找得到；找不全同样是"证据不足"，
  // 与生成阶段的空引述拒绝是同一条规则（checkConfirmable 的文件头注释②）。
  if (quoteRows.length !== candidate.evidenceQuoteIds.length) throw new InsightNoEvidenceError();

  const stored = await deps.insights.confirm({
    orgId: input.orgId,
    actorId: input.actorId,
    insightId: candidate.candidateId,
    interviewId: candidate.interviewId,
    text: input.edits ?? candidate.text,
    sourceKind: candidate.sourceKind,
    excludedSubjectIds: candidate.excludedSubjectIds,
    frozenQuotes: quoteRows.map((q) => ({
      quoteId: q.quoteId,
      segmentId: q.segmentId,
      subjectId: q.subjectId,
      sourceKind: q.sourceKind,
      text: q.text,
      rqId: q.rqId,
    })),
  });

  await deps.candidates.remove(input.orgId, input.candidateId);

  return {
    insightId: stored.insightId,
    text: stored.text,
    sourceKind: stored.sourceKind,
    strong: stored.strong,
    evidenceQuoteIds: [...stored.evidenceQuoteIds],
    pinnedSourceSnapshotId: stored.pinnedSourceSnapshotId,
  };
}
