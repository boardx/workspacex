/**
 * `updateSystemErrorLifecycle` —— 系统异常的生命周期(状态/理由/开发备注)与标签更新。
 *
 * 2026-09-03 人类要求：系统异常要跟缺陷反馈一样能"转下一步"（转开发/转不做存档）、
 * 能打标签筛选。范围明确**不**比照 `product_feedback`：没有提交人要通知、不建 GitHub
 * issue、不写独立的状态流水表——见迁移 `20260903120000_error_logs_lifecycle_tags.sql`
 * 头注同一条纪律。
 *
 * ## 状态机
 *
 * 待处理 → [已转入开发, 不做]
 * 已转入开发 → [待处理, 不做]
 * 不做 → [待处理]（存档后仍可重新打开）
 *
 * 转「不做」必须带非空 `statusReason`（存档理由，供以后回看"当时为什么不做"）；
 * 其余转移理由可选。`devNote`（开发备注，"转开发"弹层里可以填的说明字段）与
 * `tags`（自由标签）都可以独立于状态转移单独编辑——调用方不传就保留现值，
 * 传空字符串/空数组才是"清空"。
 *
 * ⚠ 幂等：目标状态与当前状态相同时不算"转移"，`statusReason` 校验不适用——
 *   与 `triageFeedback` 的既有纪律同理:重复点同一个状态不该被拦下来，也不该
 *   要求这次重复调用带上"不做"才需要的理由。
 */
import type { ErrorLogPort, ErrorLogStatus } from "../ports/error-log.port";

export const ALLOWED_SYSTEM_ERROR_TRANSITIONS: Record<ErrorLogStatus, readonly ErrorLogStatus[]> = {
  待处理: ["已转入开发", "不做"],
  已转入开发: ["待处理", "不做"],
  不做: ["待处理"],
};

export class SystemErrorNotFoundError extends Error {}
export class SystemErrorReasonRequiredError extends Error {}
export class SystemErrorIllegalTransitionError extends Error {
  constructor(readonly from: ErrorLogStatus, readonly to: ErrorLogStatus) {
    super(`illegal system error transition: ${from} -> ${to}`);
  }
}

export interface UpdateSystemErrorLifecycleInput {
  readonly id: string;
  /** 不传 = 不改状态,只改 devNote/tags。 */
  readonly status?: ErrorLogStatus;
  readonly statusReason?: string | null;
  readonly devNote?: string | null;
  readonly tags?: readonly string[];
}

export interface UpdateSystemErrorLifecycleResult {
  readonly id: string;
  readonly status: ErrorLogStatus;
  readonly statusReason: string | null;
  readonly devNote: string | null;
  readonly tags: readonly string[];
}

export async function updateSystemErrorLifecycle(
  repo: ErrorLogPort,
  input: UpdateSystemErrorLifecycleInput,
): Promise<UpdateSystemErrorLifecycleResult> {
  const current = await repo.getLifecycle(input.id);
  if (current === null) throw new SystemErrorNotFoundError();

  const targetStatus = input.status ?? current.status;
  const isTransition = input.status !== undefined && input.status !== current.status;

  if (isTransition) {
    const allowed = ALLOWED_SYSTEM_ERROR_TRANSITIONS[current.status];
    if (!allowed.includes(targetStatus)) {
      throw new SystemErrorIllegalTransitionError(current.status, targetStatus);
    }
    if (targetStatus === "不做" && (input.statusReason ?? "").trim() === "") {
      throw new SystemErrorReasonRequiredError();
    }
  }

  const next = {
    status: targetStatus,
    statusReason: input.statusReason !== undefined ? input.statusReason : current.statusReason,
    devNote: input.devNote !== undefined ? input.devNote : current.devNote,
    tags: input.tags !== undefined ? input.tags : current.tags,
  };

  await repo.updateLifecycle(input.id, next);
  return { id: input.id, ...next };
}
