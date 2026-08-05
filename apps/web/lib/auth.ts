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
