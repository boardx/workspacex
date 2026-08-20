/**
 * `markStrongInsight` —— 虚拟来源隔离的接口层门（F03，uc-6-5 R3 step5，
 * `packages/contracts/src/interview.ts` `markStrongInsight`）。
 *
 * ⚠ 这是**接口层拒绝，不是前端按钮置灰**（AC3/R7）：真人来源放行，虚拟来源一律
 *   `VIRTUAL_SOURCE_FORBIDDEN`——门本身是 `domain/interview/insight-source-gate.ts`
 *   的 `checkSourceAllowsStrongUse`，`referenceForDecision`（同目录）调的是同一个函数，
 *   不是两处各自判一次（AGENTS.md「同一事实不得声明在两处」）。
 * ⚠ 混合来源候选的 `sourceKind` 传播规则由 F01 的 `candidate-insight.ts`
 *   `buildCandidateInsight` 在确认入库那一刻落定并固化；本文件只消费已经存进
 *   `interview_insights.source_kind` 的既成结果，不重算。
 */
import type { OrgId } from "../../domain/org-id";
import { checkSourceAllowsStrongUse } from "../../domain/interview/insight-source-gate";
import { NoInterviewAccessError, VirtualSourceForbiddenError } from "./errors";
import type { InsightRepository } from "./insight-ports";

export interface MarkStrongInsightDeps {
  readonly insights: InsightRepository;
}

export interface MarkStrongInsightInput {
  readonly orgId: OrgId;
  readonly insightId: string;
}

export async function markStrongInsight(
  deps: MarkStrongInsightDeps,
  input: MarkStrongInsightInput,
): Promise<{ readonly ok: true }> {
  const insight = await deps.insights.getById(input.orgId, input.insightId);
  // 不存在 / 不属于该 org 与「无权」共用同一个不可区分码（既有先例，见
  // `errors.ts` `NoInterviewAccessError` 文件头）。
  if (insight === null) throw new NoInterviewAccessError(input.insightId);

  const gate = checkSourceAllowsStrongUse(insight);
  if (!gate.ok) throw new VirtualSourceForbiddenError(input.insightId);

  const updated = await deps.insights.markStrong(input.orgId, input.insightId);
  // 门通过之后到写库之间理论上仍可能发生并发删除（未在本域建模），保守起见同样
  // 视为不可见，而不是把 UPDATE 的 0-row 结果静默当成成功。
  if (updated === null) throw new NoInterviewAccessError(input.insightId);

  return { ok: true };
}
