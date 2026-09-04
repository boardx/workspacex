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
 * ## 2026-09-03 独立评审（PR #2590）两处阻断项的修法——见迁移文件头注①②的对应小节
 *
 * ### ① 「不做必须有存档理由」是终态不变量，不是只在"这次是不是转移"时才查一次
 *
 * 旧版只在 `isTransition` 为真时校验，放过了两条口子：幂等重放（目标状态==当前状态，
 * 但调用方这次传了 `statusReason: null`）、以及"只改标签"这类局部更新顺带把
 * `statusReason` 设成别的值。修法：**禁止在不随 `status` 一起提交的情况下携带
 * `statusReason`**——`REASON_REQUIRES_STATUS`，直接把"局部更新绕过不变量"这整类
 * 输入堵在契约层面，不留一个"看起来安全实则能绕过"的分支。`status` 确实要变
 * （或被重申）时，终态是「不做」就必须有非空理由，终态不是「不做」就**强制清空**
 * 旧理由——这也回答了"退回待处理要不要带着旧的存档理由"：不带，理由只属于
 * 「不做」这一个状态,翻回来就不再是"存档"了。DB 侧另有 CHECK 兜底（见迁移）。
 *
 * ### ② 读-改-写的 TOCTOU / lost update
 *
 * `getLifecycle()`（预检）与 `updateLifecycle()`（写入）不在同一个原子操作里,两个
 * 并发请求可能读到同一份快照。修法不是加锁重试,是让**写入本身**既是字段级局部写入
 * （只碰调用方明确要改的列，见 port 头注），又对 `status` 的变更带乐观锁
 * （`expectedStatus`，见 port 与迁移头注）——`status` 没变的请求根本不设防（它压根
 * 不碰这一列，不存在"覆盖别人转移结果"的风险）；`status` 要变的请求如果 CAS 未命中，
 * `repo.updateLifecycle` 返回 `null`，这里抛 `SystemErrorConcurrentUpdateError`，
 * 由调用方（前端）刷新后重试——不是静默按一个已经过期的旧状态覆盖。
 */
import { randomUUID } from "node:crypto";
import type { ErrorLogPort, ErrorLogStatus } from "../ports/error-log.port";

export const ALLOWED_SYSTEM_ERROR_TRANSITIONS: Record<ErrorLogStatus, readonly ErrorLogStatus[]> = {
  待处理: ["已转入开发", "不做"],
  已转入开发: ["待处理", "不做"],
  不做: ["待处理"],
};

export class SystemErrorNotFoundError extends Error {}
export class SystemErrorReasonRequiredError extends Error {}
/** `statusReason` 被提交，但这次请求没有一起提交 `status`——见文件头①。 */
export class SystemErrorReasonRequiresStatusError extends Error {}
export class SystemErrorIllegalTransitionError extends Error {
  constructor(readonly from: ErrorLogStatus, readonly to: ErrorLogStatus) {
    super(`illegal system error transition: ${from} -> ${to}`);
  }
}
/** 乐观锁未命中（并发冲突）——见文件头②。 */
export class SystemErrorConcurrentUpdateError extends Error {}

export interface UpdateSystemErrorLifecycleInput {
  readonly id: string;
  /** 不传 = 不改状态,只改 devNote/tags。 */
  readonly status?: ErrorLogStatus;
  /** 只能与 `status` 一起提交——见文件头①，单独提交会被拒绝（`REASON_REQUIRES_STATUS`）。 */
  readonly statusReason?: string | null;
  readonly devNote?: string | null;
  readonly tags?: readonly string[];
  /**
   * B3.3：真实状态转移时把它记进 `system_error_status_events`。可不传——不传时
   * 单纯不记流水（状态本身照常写入,见下方 `repo.appendStatusEvent?.()` 调用点），
   * 不是把整次请求拒掉：流水是审计的加分项,不是这条状态转移生不生效的前提。
   */
  readonly actorId?: string;
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

  const changingStatus = input.status !== undefined;

  // 见文件头①：一次不带 status 的请求（纯标签/开发备注编辑）不许携带 statusReason——
  // 这是堵住"局部更新绕过终态不变量"的根，不是次要校验。
  if (!changingStatus && input.statusReason !== undefined) {
    throw new SystemErrorReasonRequiresStatusError();
  }

  let nextStatusReason: string | null | undefined; // undefined = 这次请求不碰这一列
  if (changingStatus) {
    const targetStatus = input.status as ErrorLogStatus;
    if (targetStatus !== current.status) {
      const allowed = ALLOWED_SYSTEM_ERROR_TRANSITIONS[current.status];
      if (!allowed.includes(targetStatus)) {
        throw new SystemErrorIllegalTransitionError(current.status, targetStatus);
      }
    }
    if (targetStatus === "不做") {
      const reason = input.statusReason ?? null;
      if ((reason ?? "").trim() === "") throw new SystemErrorReasonRequiredError();
      nextStatusReason = reason;
    } else {
      // 终态不是「不做」——强制清空旧理由，见文件头①。
      nextStatusReason = null;
    }
  }

  const written = await repo.updateLifecycle(input.id, {
    expectedStatus: changingStatus ? current.status : null,
    status: changingStatus ? (input.status as ErrorLogStatus) : undefined,
    statusReason: nextStatusReason,
    devNote: input.devNote,
    tags: input.tags,
  });
  if (written === null) throw new SystemErrorConcurrentUpdateError();

  // B3.3：只在这次请求**真的**改了 status 时记一行流水——不改状态的局部编辑
  // （纯标签/备注）不产生一条"从 X 到 X"的空转移事实。best-effort：不阻塞、
  // 不重试、失败不影响已经写入的状态本身（同 `markStatusEventNotified` 的纪律,
  // 见 `application/feedback/ports.ts` 头注同一条理由）。
  if (changingStatus && input.actorId !== undefined && (input.status as ErrorLogStatus) !== current.status) {
    void repo
      .appendStatusEvent?.({
        id: randomUUID(),
        errorLogId: input.id,
        fromStatus: current.status,
        toStatus: input.status as ErrorLogStatus,
        reason: nextStatusReason ?? null,
        actorId: input.actorId,
      })
      .catch(() => undefined);
  }

  return { id: input.id, ...written };
}
