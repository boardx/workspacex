/**
 * `extractQuotes` —— 人工抽引述（F01，uc-6-5 R3 step1）。
 *
 * ⚠ **直连查询，不经 Context API**——契约头注区分了两件事：`extractQuotes` 是研究员的
 *   人工判断（"限制的是模型处理不是人工判断"），`generateCandidateInsights` 才是 AI 归纳、
 *   必须经 Context API 取材。两者不是同一道门。
 * ⚠ 对 `ai_analysis = false` 的受访者同样返回原文——本文件不做任何按同意位过滤片段的动作，
 *   `SegmentReader.readSegments` 本身也不做（见该端口文件头）。
 */
import type { OrgId } from "../../domain/org-id";
import { decideInterviewVisibility } from "../../domain/interview/visibility-decision";
import type { OrgRole } from "../../domain/identity/roles";
import type { DecisionIdFactory } from "../identity/ports";
import type { IdFactory } from "../artifact/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { NoInterviewAccessError } from "./errors";
import type { InterviewScopeRepository } from "./ports";
import type { QuoteRepository, SegmentReader, StoredQuote } from "./insight-ports";

export interface ExtractQuotesDeps {
  readonly scope: InterviewScopeRepository;
  readonly decisions: DecisionIdFactory;
  readonly segments: SegmentReader;
  readonly quotes: QuoteRepository;
  readonly ids: IdFactory;
}

export interface ExtractQuotesInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly interviewId: string;
  readonly segmentIds: readonly string[];
  readonly rqBinding: string | null;
}

export interface ExtractQuotesResult {
  readonly quotes: readonly { quoteId: string; segmentId: string; text: string; subjectId: string; rqId: string | null }[];
}

async function assertVisible(deps: ExtractQuotesDeps, orgId: OrgId, actorId: string, interviewId: string): Promise<void> {
  const found = await deps.scope.findVisibleById(orgId, actorId, interviewId);
  if (found === null) throw new NoInterviewAccessError(interviewId);
  const [projectIds, membership] = await Promise.all([
    deps.scope.projectIdsOf(orgId, actorId),
    deps.scope.orgMembershipOf(orgId, actorId),
  ]);
  const decision = decideInterviewVisibility({
    decisionId: deps.decisions.next(),
    interview: found.facts,
    viewer: { userId: actorId, projectIds },
    orgRole: membership.orgRole as OrgRole | null,
    viewerTeamId: membership.teamId,
  });
  const disclosed = discloseDecided(found.item, decision);
  if (!isDisclosed(disclosed)) throw new NoInterviewAccessError(interviewId);
}

export async function extractQuotes(
  deps: ExtractQuotesDeps,
  input: ExtractQuotesInput,
): Promise<ExtractQuotesResult> {
  await assertVisible(deps, input.orgId, input.actorId, input.interviewId);

  const found = await deps.segments.readSegments(input.orgId, input.segmentIds);

  // 找不到的 segmentId 直接缺席（见端口文件头）——一个坏 id 不拒绝整批人工判断。
  const rows: StoredQuote[] = found.map((segment) => ({
    quoteId: deps.ids.next("itv-quote"),
    interviewId: input.interviewId,
    segmentId: segment.segmentId,
    subjectId: segment.subjectId,
    sourceKind: segment.sourceKind,
    text: segment.text,
    rqId: input.rqBinding,
  }));

  if (rows.length > 0) {
    await deps.quotes.insertMany(input.orgId, input.actorId, rows);
  }

  return {
    quotes: rows.map((r) => ({
      quoteId: r.quoteId,
      segmentId: r.segmentId,
      text: r.text,
      // 契约 `Quote.subjectId` 是必填字符串；未能解析出说话人的片段没有意义作为一条引述
      // 挂到某人名下，因此本函数已经在上面用 `readSegments` 的真实事实构造——
      // 当 `subjectId` 为 null 时用空字符串占位，如实反映"这条片段没有已解析说话人"，
      // 不伪造一个假 id。
      subjectId: r.subjectId ?? "",
      rqId: r.rqId,
    })),
  };
}
