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

/** redeemInviteAndCreateOrg 的成功响应样例（由契约生成） */
export const redeemInviteAndCreateOrgMock: z.infer<typeof auth.operations.redeemInviteAndCreateOrg.out> = {
  "userId": "userId-1",
  "orgId": "orgId-1",
  "verificationDelivery": "queued"
};

/** redeemInviteAndCreateOrg 的失败模式全集——界面的异常态必须逐个覆盖 */
export const redeemInviteAndCreateOrgErrors = ["INVITE_CODE_INVALID","EMAIL_TAKEN"] as const;

/** bootstrapFirstUser 的成功响应样例（由契约生成） */
export const bootstrapFirstUserMock: z.infer<typeof auth.operations.bootstrapFirstUser.out> = {
  "userId": "userId-1",
  "orgId": "orgId-1",
  "emailVerified": true
};

/** bootstrapFirstUser 的失败模式全集——界面的异常态必须逐个覆盖 */
export const bootstrapFirstUserErrors = ["BOOTSTRAP_UNAVAILABLE","EMAIL_TAKEN"] as const;

/** confirmEmailVerification 的成功响应样例（由契约生成） */
export const confirmEmailVerificationMock: z.infer<typeof auth.operations.confirmEmailVerification.out> = {
  "status": "completed"
};

/** confirmEmailVerification 的失败模式全集——界面的异常态必须逐个覆盖 */
export const confirmEmailVerificationErrors = ["VERIFICATION_LINK_INVALID"] as const;

/** resendEmailVerification 的成功响应样例（由契约生成） */
export const resendEmailVerificationMock: z.infer<typeof auth.operations.resendEmailVerification.out> = {
  "verificationDelivery": "queued"
};

/** switchOrgAtLogin 的成功响应样例（由契约生成） */
export const switchOrgAtLoginMock: z.infer<typeof auth.operations.switchOrgAtLogin.out> = {
  "org": {
    "id": "id-1",
    "name": "name-1",
    "kind": "organization",
    "team": null,
    "modelPolicy": "any",
    "avatarUrl": null
  }
};

/** switchOrgAtLogin 的失败模式全集——界面的异常态必须逐个覆盖 */
export const switchOrgAtLoginErrors = ["NO_ORG_MEMBERSHIP","SESSION_EXPIRED","SESSION_REVOKED","AUTH_SERVICE_UNAVAILABLE"] as const;

/** joinOrgWithInvite 的成功响应样例（由契约生成） */
export const joinOrgWithInviteMock: z.infer<typeof auth.operations.joinOrgWithInvite.out> = {
  "orgId": "orgId-1"
};

/** joinOrgWithInvite 的失败模式全集——界面的异常态必须逐个覆盖 */
export const joinOrgWithInviteErrors = ["INVITE_CODE_INVALID","EMAIL_NOT_VERIFIED","SESSION_EXPIRED","SESSION_REVOKED"] as const;

/** exportOrganization 的成功响应样例（由契约生成） */
export const exportOrganizationMock: z.infer<typeof auth.operations.exportOrganization.out> = {
  "org": {
    "id": "id-1",
    "name": "name-1",
    "kind": "organization",
    "team": null,
    "modelPolicy": "any",
    "avatarUrl": null
  },
  "lifecycle": {
    "status": "active",
    "disabledAt": null,
    "retentionUntil": null
  },
  "tables": [
    {
      "table": "table-1",
      "rowCount": 1
    }
  ]
};

/** exportOrganization 的失败模式全集——界面的异常态必须逐个覆盖 */
export const exportOrganizationErrors = ["NO_ORG_MEMBERSHIP","SESSION_EXPIRED","SESSION_REVOKED"] as const;
