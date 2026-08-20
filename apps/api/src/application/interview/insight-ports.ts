/**
 * Ports for F01（phase-06）—— 洞察写路径：`extractQuotes` / `generateCandidateInsights` /
 * `confirmInsight` 共用的存储与外部依赖形状。
 *
 * ⚠ 与 `domain/interview/candidate-insight.ts` 的分工：那个文件只管"给定一组已属于同一
 * 候选的引述，怎么组装/门控成一条 `Insight`"；本文件的端口负责"这组引述从哪来、
 * 组装完之后落到哪、候选态之间怎么串起来"——编排层的职责，不重复纯逻辑。
 */
import type { OrgId } from "../../domain/org-id";
import type { InterviewSourceKindT } from "../../domain/interview/candidate-insight";

/* ─────────────────────────── 引述（extractQuotes 的持久化） ─────────────────────────── */

export interface StoredQuote {
  readonly quoteId: string;
  readonly interviewId: string;
  readonly segmentId: string;
  /** `null` = 该片段没有已解析出的说话人（同 F93 `segment_text.speaker_subject_id`）。 */
  readonly subjectId: string | null;
  /** 抽取那一刻冻结的来源判定——见 migration 文件头。 */
  readonly sourceKind: InterviewSourceKindT;
  readonly text: string;
  readonly rqId: string | null;
}

export interface QuoteRepository {
  /** 批量落库；同一批引述属于同一次 `extractQuotes` 调用。 */
  insertMany(
    orgId: OrgId,
    actorId: string,
    rows: readonly StoredQuote[],
  ): Promise<void>;
  /** `generateCandidateInsights` 用：给定这场访谈 + Context Pack 授权到的片段集合，取已抽引述。 */
  listByInterviewAndSegments(
    orgId: OrgId,
    interviewId: string,
    segmentIds: readonly string[],
  ): Promise<readonly StoredQuote[]>;
  /** `confirmInsight` 用：按 id 精确取回，供固化来源快照。 */
  getByIds(orgId: OrgId, quoteIds: readonly string[]): Promise<readonly StoredQuote[]>;
}

export const QUOTE_REPOSITORY = Symbol("QuoteRepository");

/* ─────────────────────────── 片段读取（extractQuotes 的直连查询） ─────────────────────────── */

/** `extractQuotes` 读的最小片段事实——人工抽引述是直连查询（不经 Context API，见契约头注）。 */
export interface SegmentForQuote {
  readonly segmentId: string;
  readonly text: string;
  readonly subjectId: string | null;
  readonly sourceKind: InterviewSourceKindT;
}

export interface SegmentReader {
  /**
   * ⚠ 对 `ai_analysis = false` 的受访者同样返回原文——限制的是模型处理，不是这里。
   * 找不到的 `segmentId` 直接从结果中缺席（调用方不因为一个坏 id 拒绝整批）。
   */
  readSegments(orgId: OrgId, segmentIds: readonly string[]): Promise<readonly SegmentForQuote[]>;
}

export const SEGMENT_READER = Symbol("SegmentReader");

/* ─────────────────────────── Context API（generateCandidateInsights 的取材路径） ─────── */

export interface InsightContextMaterialItem {
  readonly segmentId: string;
  readonly content: string;
}

export interface InsightContextMaterial {
  readonly packId: string;
  readonly runId: string;
  readonly items: readonly InsightContextMaterialItem[];
}

/**
 * `generateCandidateInsights` 必须经 Context API 取材，不直连查询（契约头注）——
 * 与 `DigitalExpertContextApi`（F03）同一形状，复用同一套 `PgContextPackStore` 实现，
 * 不另开第二条读路径。
 */
export interface InsightContextApi {
  read(input: {
    readonly orgId: OrgId;
    readonly actorId: string;
    readonly runId: string;
  }): Promise<InsightContextMaterial | null>;
}

export const INSIGHT_CONTEXT_API = Symbol("InsightContextApi");

/* ─────────────────────────── 候选态（不入库，进程内周转） ─────────────────────────── */

/**
 * 候选洞察不直接入库（契约头注「候选不直接入库」）——与 F98 `CandidateStore`（人选候选）
 * 同一立场：短生命周期、进程内即可，`confirmInsight` 消费后即失效。
 */
export interface InsightCandidate {
  readonly candidateId: string;
  readonly orgId: OrgId;
  readonly interviewId: string;
  readonly text: string;
  readonly sourceKind: InterviewSourceKindT;
  readonly evidenceQuoteIds: readonly string[];
  /** 这条候选诞生那次生成调用的排除名单，随候选一起带到confirm，入库时一并留痕。 */
  readonly excludedSubjectIds: readonly string[];
}

export interface InsightCandidateStore {
  put(candidate: InsightCandidate): Promise<void>;
  get(orgId: OrgId, candidateId: string): Promise<InsightCandidate | null>;
  /** 确认或忽略都终结候选态——不是可重复消费的。 */
  remove(orgId: OrgId, candidateId: string): Promise<void>;
}

export const INSIGHT_CANDIDATE_STORE = Symbol("InsightCandidateStore");

/* ─────────────────────────── 洞察（confirmInsight 的持久化落点） ─────────────────────────── */

export interface StoredInsight {
  readonly insightId: string;
  readonly interviewId: string;
  readonly text: string;
  readonly sourceKind: InterviewSourceKindT;
  readonly strong: boolean;
  readonly evidenceQuoteIds: readonly string[];
  readonly pinnedSourceSnapshotId: string;
}

export interface ConfirmInsightWrite {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly insightId: string;
  readonly interviewId: string;
  readonly text: string;
  readonly sourceKind: InterviewSourceKindT;
  readonly excludedSubjectIds: readonly string[];
  /** 固化的来源快照内容——写入即冻结，此后任何路径都不再更新这些字段。 */
  readonly frozenQuotes: readonly {
    readonly quoteId: string;
    readonly segmentId: string;
    readonly subjectId: string | null;
    readonly sourceKind: InterviewSourceKindT;
    readonly text: string;
    readonly rqId: string | null;
  }[];
}

export interface InsightRepository {
  /** 一个事务内：插快照 + 插洞察，两者要么都进去要么都不进去。 */
  confirm(write: ConfirmInsightWrite): Promise<StoredInsight>;
  getById(orgId: OrgId, insightId: string): Promise<StoredInsight | null>;
}

export const INSIGHT_REPOSITORY = Symbol("InsightRepository");

/* ─────────────────────────── AI 归纳（可替换，供 E1 反证注入失败） ─────────────────────────── */

export interface QuoteForGeneration {
  readonly quoteId: string;
  readonly text: string;
  readonly subjectId: string | null;
  readonly sourceKind: InterviewSourceKindT;
  readonly rqId: string | null;
}

export interface GeneratedCandidateInput {
  readonly text: string;
  readonly quotes: readonly QuoteForGeneration[];
}

/**
 * 把一批已授权引述归纳成若干候选——**分组算法本身**（哪些引述属于同一个候选）不是
 * `domain/interview/candidate-insight.ts` 的职责（该文件头注明确排除），落在这个可替换端口。
 * 默认实现是确定性启发式（按 `rqId` 分组），不是真实模型调用——如实登记，同
 * `candidate-ports.ts`（F98 人选建议）的既有先例，不假装做了 AI 判断。
 */
export interface CandidateInsightGenerator {
  generate(quotes: readonly QuoteForGeneration[]): Promise<readonly GeneratedCandidateInput[]>;
}

export const CANDIDATE_INSIGHT_GENERATOR = Symbol("CandidateInsightGenerator");

/* ─────────────────────────── 同意声明读取（A2 全员拒绝 AI 分析退化判定） ─────────────────────────── */

export interface ConsentDeclineReader {
  /** 这场访谈里，最新一次提交明确拒绝 `ai_analysis` 的受访者 id 集合。 */
  listAiAnalysisDeclinedSubjects(orgId: OrgId, interviewId: string): Promise<readonly string[]>;
}

export const CONSENT_DECLINE_READER = Symbol("ConsentDeclineReader");
