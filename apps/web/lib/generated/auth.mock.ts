/**
 * @generated 由 packages/contracts 生成，**请勿手改**。
 *
 * 改这里的值不会改变契约，只会让 mock 与契约漂移——
 * 而「同一事实声明在两处必然漂移」是本项目已经踩过五次的坑（ADR-020）。
 * 要改请改 packages/contracts/src/*.ts，然后跑 pnpm --filter @repo/contracts gen:mock。
 *
 * 门控：node .harness/scripts/lint-contract-source.mjs
 */

import type { z } from "zod";
import * as auth from "@repo/contracts/auth";

/** login 的成功响应样例（由契约生成） */
export const loginMock: z.infer<typeof auth.operations.login.out> = {
  "sessionToken": "sessionToken-1",
  "userId": "userId-1",
  "orgs": [
    "orgs-1"
  ],
  "expiresAt": "expiresAt-1"
};

/** login 的失败模式全集——界面的异常态必须逐个覆盖 */
export const loginErrors = ["INVALID_CREDENTIAL","ACCOUNT_LOCKED","EMAIL_NOT_VERIFIED","AUTH_SERVICE_UNAVAILABLE"] as const;

/** requestPasswordReset 的成功响应样例（由契约生成） */
export const requestPasswordResetMock: z.infer<typeof auth.operations.requestPasswordReset.out> = {
  "sent": true
};

/** completePasswordReset 的成功响应样例（由契约生成） */
export const completePasswordResetMock: z.infer<typeof auth.operations.completePasswordReset.out> = {
  "revokedSessionCount": 1
};

/** completePasswordReset 的失败模式全集——界面的异常态必须逐个覆盖 */
export const completePasswordResetErrors = ["RESET_TOKEN_INVALID","AUTH_SERVICE_UNAVAILABLE"] as const;

/** validateSession 的成功响应样例（由契约生成） */
export const validateSessionMock: z.infer<typeof auth.operations.validateSession.out> = null;

/** validateSession 的失败模式全集——界面的异常态必须逐个覆盖 */
export const validateSessionErrors = ["SESSION_EXPIRED","SESSION_REVOKED","AUTH_SERVICE_UNAVAILABLE"] as const;
