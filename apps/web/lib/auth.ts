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
export type RegisterWithInviteIn = z.infer<typeof auth.operations.redeemInviteAndCreateOrg.in>;
export type RegisterWithInviteOut = z.infer<typeof auth.operations.redeemInviteAndCreateOrg.out>;
export type RequestPasswordResetOut = z.infer<typeof auth.operations.requestPasswordReset.out>;

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

export async function registerWithInvite(input: RegisterWithInviteIn): Promise<RegisterWithInviteOut> {
  return apiRequest<RegisterWithInviteOut>(auth.operations.redeemInviteAndCreateOrg.path, {
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
