/**
 * `triageFeedback` —— 分诊（改状态）。**组织管理员，且只有组织管理员**。
 *
 * 状态机在 `domain/feedback/product-feedback.ts`；这里只负责把它的裁决接到仓储上，
 * 并保证**改状态与写流水是同一次动作**：只落库不写事件，等于把「谁在什么时候
 * 把它改成不做、理由是什么」丢掉，而那正是这条闭环唯一能回答提交人的东西。
 *
 * ⚠ 幂等重放（目标状态 = 当前状态）**既不落库也不写事件**。
 *   管理员点两次「进迭代」不该在流水里留下两条转移——那个数字读起来像是有人在反复改判。
 *
 * ⚠ `FeedbackNotFoundError` 同时覆盖「不存在」与「不可见」（同 `SKILL_NOT_FOUND`
 *   的纪律：404 非 403，不泄露存在性）。这里不需要额外做可见性判断的原因是
 *   仓储绑定了租户 + RLS：跨组织的 id 查出来就是 null。
 */
import {
  canTriage,
  triage,
  type FeedbackStatus,
} from "../../domain/feedback/product-feedback";
import type { OrgRole } from "../../domain/identity/roles";
import type { ProductFeedbackRepository } from "./ports";

export class FeedbackNotFoundError extends Error {}
export class FeedbackTriageForbiddenError extends Error {}
export class FeedbackTriageReasonRequiredError extends Error {}
export class FeedbackIllegalTransitionError extends Error {
  constructor(readonly from: FeedbackStatus, readonly to: FeedbackStatus) {
    super(`illegal feedback transition: ${from} -> ${to}`);
  }
}

export interface TriageFeedbackDeps {
  readonly repo: ProductFeedbackRepository;
  readonly newEventId: () => string;
}

export interface TriageFeedbackInput {
  readonly feedbackId: string;
  readonly status: FeedbackStatus;
  readonly reason: string | null;
  readonly actorId: string;
  readonly actorOrgRole: OrgRole | null;
}

export async function triageFeedback(
  deps: TriageFeedbackDeps,
  input: TriageFeedbackInput,
): Promise<{ readonly feedbackId: string; readonly status: FeedbackStatus }> {
  // ⚠ 权限先判，仓储后动——与本仓 F119/F124/F125/#467/F176 同一条顺序纪律。
  //   反过来写的话，一次越权的分诊请求仍然会先把那条反馈读出来。
  if (!canTriage(input.actorOrgRole ?? "")) throw new FeedbackTriageForbiddenError();

  const current = await deps.repo.findById(input.feedbackId, input.actorId);
  if (current === null) throw new FeedbackNotFoundError();

  const outcome = triage({ current: current.status, next: input.status, reason: input.reason });
  if (outcome.kind === "rejected") {
    if (outcome.code === "TRIAGE_REASON_REQUIRED") throw new FeedbackTriageReasonRequiredError();
    throw new FeedbackIllegalTransitionError(outcome.from, outcome.to);
  }
  if (outcome.kind === "unchanged") {
    return { feedbackId: input.feedbackId, status: outcome.at };
  }

  await deps.repo.updateStatus(input.feedbackId, outcome.to, outcome.reason);
  await deps.repo.appendStatusEvent({
    id: deps.newEventId(),
    feedbackId: input.feedbackId,
    fromStatus: outcome.from,
    toStatus: outcome.to,
    reason: outcome.reason,
    actorId: input.actorId,
  });
  return { feedbackId: input.feedbackId, status: outcome.to };
}
