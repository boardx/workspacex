/**
 * `referenceForDecision` —— 引用洞察为决策依据（F03，uc-6-5 R3 step5，
 * `packages/contracts/src/interview.ts` `referenceForDecision`）。
 *
 * ⚠ 与 `mark-strong-insight.ts` 是**同一道门**：都调
 *   `domain/interview/insight-source-gate.ts` 的 `checkSourceAllowsStrongUse`，
 *   虚拟来源同样一律 `VIRTUAL_SOURCE_FORBIDDEN`（I-28）。
 * ⚠ 本操作不修改 `interview_insights` 本身（不存在"引用次数"这类字段——契约
 *   `Insight` 上没有声明，本域不新造一份状态）；`decisionId` 指向的"决策"实体不在
 *   本阶段范围内（R6：本阶段只交付这道门，决策依据消费方是另一个尚未建的域）。
 */
import type { OrgId } from "../../domain/org-id";
import { checkSourceAllowsStrongUse } from "../../domain/interview/insight-source-gate";
import { NoInterviewAccessError, VirtualSourceForbiddenError } from "./errors";
import type { InsightRepository } from "./insight-ports";

export interface ReferenceForDecisionDeps {
  readonly insights: InsightRepository;
}

export interface ReferenceForDecisionInput {
  readonly orgId: OrgId;
  readonly insightId: string;
  readonly decisionId: string;
}

export async function referenceForDecision(
  deps: ReferenceForDecisionDeps,
  input: ReferenceForDecisionInput,
): Promise<{ readonly ok: true }> {
  const insight = await deps.insights.getById(input.orgId, input.insightId);
  if (insight === null) throw new NoInterviewAccessError(input.insightId);

  const gate = checkSourceAllowsStrongUse(insight);
  if (!gate.ok) throw new VirtualSourceForbiddenError(input.insightId);

  return { ok: true };
}
