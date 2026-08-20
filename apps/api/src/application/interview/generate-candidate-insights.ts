/**
 * `generateCandidateInsights` —— AI 归纳候选洞察（F01，uc-6-5 R3 step2）。
 *
 * ⚠ **经 Context API 取材，不直连查询**（契约头注）——与 `extractQuotes` 的直连查询
 *   刻意不同，见该文件文件头。
 * ⚠ **E1 事务性**：本函数在拿到 `CandidateInsightGenerator` 的结果之前不写任何东西；
 *   生成器失败时直接向上抛 `InsightGenerationUnavailableError`，`interview_quotes` 里
 *   已经落库的引述不受影响——不是"写了再回滚"，是"这条路径压根没有到写的那一步"。
 * ⚠ **A2 退化不是错误**：全员拒绝 AI 分析时返回 `candidates: [] , degradedToQuotesOnly:
 *   true`，函数正常返回，不抛错。
 * ⚠ **排除名单写留痕**（V2 ⑤）：这次调用排除掉的 `excludedSubjectIds` 随每条候选一起
 *   放进 `InsightCandidateStore`，`confirmInsight` 入库时原样带过去，不是算完就丢。
 */
import type { OrgId } from "../../domain/org-id";
import { buildCandidateInsight, type InsightT } from "../../domain/interview/candidate-insight";
import type { IdFactory } from "../artifact/ports";
import { InsightDependencyUnavailableError, InsightGenerationUnavailableError, InsightNoEvidenceError } from "./errors";
import type {
  CandidateInsightGenerator,
  ConsentDeclineReader,
  InsightCandidateStore,
  InsightContextApi,
  QuoteForGeneration,
  QuoteRepository,
} from "./insight-ports";

export interface GenerateCandidateInsightsDeps {
  readonly context: InsightContextApi;
  readonly quotes: QuoteRepository;
  readonly consent: ConsentDeclineReader;
  readonly generator: CandidateInsightGenerator;
  readonly candidates: InsightCandidateStore;
  readonly ids: IdFactory;
}

export interface GenerateCandidateInsightsInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly interviewId: string | null;
  readonly themeScope: string | null;
  readonly contextPackId: string;
}

export interface GenerateCandidateInsightsResult {
  readonly candidates: readonly {
    insightId: string;
    text: string;
    sourceKind: "human" | "virtual";
    strong: false;
    evidenceQuoteIds: string[];
    pinnedSourceSnapshotId: null;
  }[];
  readonly excludedSubjectIds: readonly string[];
  readonly degradedToQuotesOnly: boolean;
}

export async function generateCandidateInsights(
  deps: GenerateCandidateInsightsDeps,
  input: GenerateCandidateInsightsInput,
): Promise<GenerateCandidateInsightsResult> {
  const material = await deps.context.read({
    orgId: input.orgId,
    actorId: input.actorId,
    runId: input.contextPackId,
  });
  if (material === null) throw new InsightDependencyUnavailableError();

  const segmentIds = material.items.map((item) => item.segmentId);

  // interviewId 为 null 时（跨访谈主题范围）本 feature 不追溯已抽引述——那需要一张
  // "按 segmentId 反查 interviewId" 的索引，F01 notes 未把这条纳入 R11 切分范围，
  // 如实报告为已知边界，不假装支持。
  const quotes = input.interviewId === null
    ? []
    : await deps.quotes.listByInterviewAndSegments(input.orgId, input.interviewId, segmentIds);

  if (quotes.length === 0) throw new InsightNoEvidenceError();

  const excludedSubjectIds = input.interviewId === null
    ? []
    : await deps.consent.listAiAnalysisDeclinedSubjects(input.orgId, input.interviewId);
  const excludedSet = new Set(excludedSubjectIds);

  const eligible: QuoteForGeneration[] = quotes
    .filter((q) => q.subjectId === null || !excludedSet.has(q.subjectId))
    .map((q) => ({ quoteId: q.quoteId, text: q.text, subjectId: q.subjectId, sourceKind: q.sourceKind, rqId: q.rqId }));

  if (eligible.length === 0) {
    // A2：全员拒绝 AI 分析。不是错误——显式说明"只出引述、不出候选洞察"。
    return { candidates: [], excludedSubjectIds, degradedToQuotesOnly: true };
  }

  let generated;
  try {
    generated = await deps.generator.generate(eligible);
  } catch {
    // E1：不区分生成器抛出的具体原因，统一映成 AI_GENERATION_UNAVAILABLE——
    // 与其它域"归纳失败保留上一版/已有事实"的既有先例（generate-outline.ts）同一立场。
    throw new InsightGenerationUnavailableError();
  }

  const candidates: InsightT[] = [];
  for (const g of generated) {
    const built = buildCandidateInsight(
      { text: g.text, quotes: g.quotes.map((q) => ({ quoteId: q.quoteId, sourceKind: q.sourceKind })) },
      { insightId: deps.ids.next("itv-cand") },
    );
    // 每组由 `eligible`（非空）派生而来，不会是空引述组；防御性地跳过而不是断言，
    // 与本文件其它地方"如实反映当前系统状态"的取舍一致。
    if (built.ok) candidates.push(built.candidate);
  }

  await Promise.all(candidates.map((c) => deps.candidates.put({
    candidateId: c.insightId,
    orgId: input.orgId,
    interviewId: input.interviewId ?? "",
    text: c.text,
    sourceKind: c.sourceKind,
    evidenceQuoteIds: c.evidenceQuoteIds,
    excludedSubjectIds,
  })));

  return {
    candidates: candidates.map((c) => ({
      insightId: c.insightId,
      text: c.text,
      sourceKind: c.sourceKind,
      strong: false,
      evidenceQuoteIds: [...c.evidenceQuoteIds],
      pinnedSourceSnapshotId: null,
    })),
    excludedSubjectIds,
    degradedToQuotesOnly: false,
  };
}
