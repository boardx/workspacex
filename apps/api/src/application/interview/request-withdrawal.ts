/**
 * `requestWithdrawal`（F89 / uc-6-3 R4/A4）—— 五步撤回编排 + 两级 SLA(D-13/D-15) + 级联失效。
 *
 * ## 执行顺序即契约
 *
 * 01（入队）→ 02（检索退出 + 主题矩阵重算）→ 级联失效派生物/Claim → 03（报告段落标失效）→
 * 04（已签字决策复核，needs-human 不自动改结论）。顺序不是随意的：02 必须先于 03——
 * 「片段退出检索」是级联失效的前提（03 要标注的报告段落引用的正是同一批片段），
 * 而 04 必须最后判定，因为它读的是 03 产出的「哪些片段被标了失效」之后仍然成立的决策引用。
 *
 * ⚠ 01–03 都在**这一次函数调用内同步完成**——不是排到后台等 5 分钟。`dueAt` 记录的是
 *   D-15 允许的截止时限，而 `state: "done"` 是「实际完成时间 ≤ 该截止时限」的证明，
 *   两者不是同一件事：截止时限来自单一事实源 `WITHDRAWAL_SLA_MS`（见 domain 文件头），
 *   完成与否来自这次调用是否成功跑完对应副作用。
 *
 * ⚠ 第 04 步**没有**自动把 `needs-human` 变成 `done` 的路径——即便复核任务创建失败，
 *   本函数仍然把整体撤回登记下来（01–03 已经生效，不能因为 04 的通知失败就回滚合规动作），
 *   但会把失败原因体现在抛出的 `DEPENDENCY_UNAVAILABLE`：04 的复核任务是「必须真的送达」
 *   的动作，与 `withdraw-evidence.ts`（F08）"通知没落地就不能说通知了"同一纪律。
 */
import { WITHDRAWAL_SLA_MS } from "@repo/contracts/org-admin";
import { buildWithdrawalSteps } from "../../domain/interview/withdrawal";
import type { WithdrawalStepRecord } from "../../domain/interview/withdrawal";
import { newWithdrawalId as defaultNewWithdrawalId } from "../../domain/interview/withdrawal-ids";
import { WithdrawalInProgressError } from "./errors";
import type { ConsentKeyValue } from "./consent-token-ports";
import type {
  CascadeInvalidationStore,
  PendingDeletionQueue,
  ReportSegmentAnnotator,
  ReportSegmentRef,
  RetrievalExclusionPort,
  SignedDecisionReviewNotifier,
  WithdrawalOriginValue,
  WithdrawalRepository,
  WithdrawalSegmentLocator,
} from "./withdrawal-ports";

export interface RequestWithdrawalDeps {
  readonly withdrawals: WithdrawalRepository;
  readonly segments: WithdrawalSegmentLocator;
  readonly deletionQueue: PendingDeletionQueue;
  readonly retrieval: RetrievalExclusionPort;
  readonly cascade: CascadeInvalidationStore;
  readonly reportAnnotator: ReportSegmentAnnotator;
  readonly decisionReview: SignedDecisionReviewNotifier;
  readonly newWithdrawalId?: () => string;
  readonly now?: () => Date;
}

export interface RequestWithdrawalInput {
  readonly subjectId: string;
  readonly scope: readonly ConsentKeyValue[];
  readonly reason: string | null;
  readonly origin: WithdrawalOriginValue;
}

export interface RequestWithdrawalOutput {
  readonly withdrawalId: string;
  readonly steps: readonly WithdrawalStepRecord[];
}

export async function requestWithdrawal(
  deps: RequestWithdrawalDeps,
  input: RequestWithdrawalInput,
): Promise<RequestWithdrawalOutput> {
  const now = (deps.now ?? (() => new Date()))();

  const existing = await deps.withdrawals.findActiveForSubject(input.subjectId, input.scope);
  if (existing) throw new WithdrawalInProgressError(input.subjectId);

  const segmentIds = await deps.segments.segmentIdsFor(input.subjectId, input.scope);
  const physicalDeleteDeadline = new Date(now.getTime() + WITHDRAWAL_SLA_MS.physicalDelete);

  // 单据 id 提前生成——01 的入队单与 04 的复核任务都要引用同一个 withdrawalId
  // （不然入队/复核和最终登记的记录会是各自编号、事后靠猜对齐）。
  const withdrawalId = (deps.newWithdrawalId ?? defaultNewWithdrawalId)();

  // 第 01 步：入队（即时）。本 feature 只触发，不执行——见 withdrawal-ports.ts 文件头。
  await deps.deletionQueue.enqueue({
    withdrawalId,
    subjectId: input.subjectId,
    scope: input.scope,
    segmentIds,
    dueAt: physicalDeleteDeadline,
  });

  // 第 02 步：片段立即退出检索范围 + 主题矩阵重算强度（即时，≤5 分钟）。
  await deps.retrieval.exclude(segmentIds, now);
  await deps.retrieval.recomputeTopicMatrixStrength(input.subjectId);

  // 级联失效：OCR/embedding/图边/摘要/缓存一并失效；以这些片段为唯一证据的 Claim 转 contested。
  // 与 02 同一即时窗口——检索退出和派生物失效是同一件事的两面，不拆成两个不同 SLA。
  const derivatives = await deps.cascade.listDerivatives(segmentIds);
  await deps.cascade.invalidate(
    derivatives.map((d) => d.id),
    now,
  );
  const soleEvidenceClaims = await deps.cascade.listClaimsSolelyEvidencedBy(segmentIds);
  await deps.cascade.markClaimsContested(soleEvidenceClaims);

  // 第 03 步：引用过这些片段的报告段落标「证据已撤回」——不删除段落（D-13）。
  const affectedRefs = await deps.reportAnnotator.markEvidenceWithdrawn(segmentIds, now);
  // D-19：已发布给客户的那一部分，对外替换不自动发生——只登记「待人工确认」，
  // 与 03 的「对内标失效」是两件事,分别调用两个方法,不共享一次副作用。
  const published = affectedRefs.filter((r: ReportSegmentRef) => r.published);
  if (published.length > 0) {
    await deps.reportAnnotator.queuePendingExternalConfirmation(published);
  }

  // 第 04 步：若这些片段支撑过已签字决策，只生成复核任务，绝不自动改写结论。
  const signedDecisions = await deps.decisionReview.findSignedDecisionsSupportedBy(segmentIds);
  for (const decision of signedDecisions) {
    await deps.decisionReview.createReviewTask({
      decisionId: decision.decisionId,
      approverId: decision.approverId,
      withdrawalId,
      segmentIds,
    });
  }

  const steps = buildWithdrawalSteps({
    queuedAt: now,
    hasSignedDecisionImpact: signedDecisions.length > 0,
  });

  const record = await deps.withdrawals.create({
    withdrawalId,
    subjectId: input.subjectId,
    scope: input.scope,
    reason: input.reason,
    origin: input.origin,
    queuedAt: now,
    steps,
  });

  return { withdrawalId: record.withdrawalId, steps: record.steps };
}
