/**
 * 全仓唯一的真实登录函数——F122 之前只内嵌在 `/project/live` 页面里，issue #355
 * 把它提成共享模块，`(entry)/login`（正式登录页）与 `/project/live`（F122 验证页）
 * 两处调用同一份实现，不允许出现第二条登录路径。
 *
 * 类型与 `live-projects.ts` 同一条纪律：从 `@repo/contracts` 推导，不重新声明。
 */
import { auth } from "@repo/contracts";
import type { z } from "zod";
import { ApiError, apiRequest } from "./api-client";

export type LoginOut = z.infer<typeof auth.operations.login.out>;
export type BootstrapFirstUserIn = z.infer<typeof auth.operations.bootstrapFirstUser.in>;
export type BootstrapFirstUserOut = z.infer<typeof auth.operations.bootstrapFirstUser.out>;
/** open-self-serve-registration delta (issue #1929) -- replaces the removed invite-code shape. */
export type RegisterNewAccountIn = z.infer<typeof auth.operations.registerNewAccount.in>;
export type RegisterNewAccountOut = z.infer<typeof auth.operations.registerNewAccount.out>;
export type RequestPasswordResetOut = z.infer<typeof auth.operations.requestPasswordReset.out>;
export type CompletePasswordResetOut = z.infer<typeof auth.operations.completePasswordReset.out>;
export type InspectPasswordResetThrottleOut = z.infer<typeof auth.operations.inspectPasswordResetThrottle.out>;

export async function login(email: string, password: string): Promise<LoginOut> {
  return apiRequest<LoginOut>(auth.operations.login.path, {
    method: "POST",
    body: { email, password },
    sessionToken: null, // 登录本身不带 token
  });
}

export async function bootstrapFirstUser(input: BootstrapFirstUserIn): Promise<BootstrapFirstUserOut> {
  return apiRequest<BootstrapFirstUserOut>(auth.operations.bootstrapFirstUser.path, {
    method: "POST",
    body: input,
    sessionToken: null,
  });
}

export async function registerNewAccount(input: RegisterNewAccountIn): Promise<RegisterNewAccountOut> {
  return apiRequest<RegisterNewAccountOut>(auth.operations.registerNewAccount.path, {
    method: "POST",
    body: input,
    sessionToken: null,
  });
}

/**
 * F21 找回密码第一步。
 *
 * ⚠ **返回类型里没有失败分支，这是故意的。** 契约把 `out` 写成
 * `{ sent: z.literal(true) }`，后端 handler 也无条件 200——邮箱存不存在，
 * 拿到的响应逐字节相同。调用方因此**无法**根据响应区分两者，
 * 也就不可能不小心把枚举信道从 UI 那一侧重新开出来。
 *
 * 任何 reject 都只可能来自传输层（网络断了 / 5xx），与"这个邮箱是谁"无关，
 * 所以调用方对失败只能给一条固定的、可重试的文案，不许按 `reasonCode` 分叉。
 */
export async function requestPasswordReset(email: string): Promise<RequestPasswordResetOut> {
  return apiRequest<RequestPasswordResetOut>(auth.operations.requestPasswordReset.path, {
    method: "POST",
    body: { email },
    sessionToken: null,
  });
}

/**
 * F21 找回密码第 4-5 步（issue #2602 补的落地页）——消费邮件里的一次性链接、
 * 设置新密码。与 `requestPasswordReset` 相反，这一步**确实**区分成功/失败：
 * 契约的 `err` 有 `RESET_TOKEN_INVALID`（伪造与过期同一个码，见后端头注）——
 * 令牌真伪不再是需要防枚举的信道，因为持有正确令牌本身就已经证明了身份。
 */
export async function completePasswordReset(token: string, newPassword: string): Promise<CompletePasswordResetOut> {
  return apiRequest<CompletePasswordResetOut>(auth.operations.completePasswordReset.path, {
    method: "POST",
    body: { token, newPassword },
    sessionToken: null,
  });
}

export function isResetTokenInvalid(error: unknown): boolean {
  return error instanceof ApiError && error.reasonCode === "RESET_TOKEN_INVALID";
}

/**
 * 平台超管专用诊断（issue #2632）——`requestPasswordReset` 对这个邮箱当前会不会因为
 * 冷却/每日上限而跳过发信。见后端用例头注：这不是把 I-1 的防枚举撕开一个口子，
 * 调用方本身已经是白名单超管，走的是完全独立的一道门（`PlatformSuperuserGuard`）。
 */
export async function inspectPasswordResetThrottle(email: string): Promise<InspectPasswordResetThrottleOut> {
  return apiRequest<InspectPasswordResetThrottleOut>(auth.operations.inspectPasswordResetThrottle.path, {
    method: "POST",
    body: { email },
  });
}

export function isBootstrapUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.reasonCode === "BOOTSTRAP_UNAVAILABLE";
}

export function isRegistrationEmailTaken(error: unknown): boolean {
  return error instanceof ApiError && error.reasonCode === "EMAIL_TAKEN";
}

/** Keeps the authentication failure policy next to the signed auth contract, not in UI code. */
export function isLoginRejected(error: unknown): boolean {
  return error instanceof ApiError && error.reasonCode === "INVALID_CREDENTIAL";
}

/**
 * 密码正确但邮箱未验证（`login.ts` 第 4 步，只在密码校验通过之后才可能抛出）。
 *
 * ⚠ 与 `isLoginRejected` 不是同一件事，也不共用文案：这条只有拿到正确密码的人
 * 才会命中，泄露"邮箱未验证"给他不会打开 I-1 关的枚举通道——攻击者拿不到这里。
 */
export function isEmailNotVerified(error: unknown): boolean {
  return error instanceof ApiError && error.reasonCode === "EMAIL_NOT_VERIFIED";
}

/**
 * 近期失败次数触发锁定（`login.ts` 第 1 步，在查账号/验密码之前就会命中，
 * 对不存在的邮箱同样会计数并锁定——所以暴露这个 reasonCode 本身不额外确认
 * "这个邮箱注册过"，不是 I-1 要堵的枚举通道；`lockedUntil` 才是，
 * 那个字段服务端本就不下发（见 `auth.controller.ts` 的 `toHttp()` 注释）。
 */
export function isAccountLocked(error: unknown): boolean {
  return error instanceof ApiError && error.reasonCode === "ACCOUNT_LOCKED";
}

/**
 * 字段级校验失败（HTTP 400 `validation_failed`）与"服务不可用"是**两回事**，
 * 而它们此前在 UI 上长得一模一样——这条 helper 就是把它们分开。
 *
 * ## 为什么需要它
 *
 * `ZodBodyPipe` 校验失败时抛 `ContractValidationError`，`all-exceptions.filter.ts`
 * 把它写成 `{ error: "validation_failed", traceId, fields: [{path, code}] }`
 * ——**没有 `reasonCode`**。于是 `ApiError.reasonCode` 是 `null`，
 * `isBootstrapUnavailable` / `isRegistrationEmailTaken` 全部返回 false，
 * 界面掉进"创建服务暂时不可用，请稍后重试"的兜底文案。
 *
 * 真实后果（2026-08-05 实测）：人类在 devapp 上建首位管理员，密码不满足
 * `AUTH_POLICY.passwordMinLen`，界面告诉他**服务坏了**。他没有任何理由去改密码，
 * 只会重试到放弃——一个能改的输入错误被伪装成了不可抗力。
 *
 * ⚠ **这条不适用于 `INVITE_CODE_INVALID`**：那是 `reasonCode` 不是校验失败，
 * 且服务端有意把它的四种成因抹平成同一个响应（不存在/已核销/过期/已撤销）。
 * 前端仍然、也必须**不区分**——区分等于按命中率削减 14 位码的搜索空间。
 */
export interface ContractFieldIssue {
  readonly path: string;
  readonly code: string;
}

export function contractFieldIssues(error: unknown): readonly ContractFieldIssue[] | null {
  if (!(error instanceof ApiError) || error.status !== 400) return null;
  const raw = error.raw;
  if (typeof raw !== "object" || raw === null) return null;
  const envelope = raw as { error?: unknown; fields?: unknown };
  if (envelope.error !== "validation_failed" || !Array.isArray(envelope.fields)) return null;
  const issues = envelope.fields.filter(
    (f): f is ContractFieldIssue =>
      typeof f === "object" && f !== null
      && typeof (f as ContractFieldIssue).path === "string"
      && typeof (f as ContractFieldIssue).code === "string",
  );
  return issues.length > 0 ? issues : null;
}
