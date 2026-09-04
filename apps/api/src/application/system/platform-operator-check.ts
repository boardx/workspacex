/**
 * "这个 principal 是不是平台运营准入" 的**布尔版**——`PlatformOperatorGuard` 判的是
 * 同一件事，但它的形状是"不是就 403"，不能用在收件箱这种"不是就悄悄不含那一半"
 * 的场景（见 `packages/contracts/src/inbox.ts` 文件头「系统异常源对非超管：不报错，
 * 只是不含」）。这里**逐行复用** guard 里的判法（同一个 `isPlatformOperator` 域函数 +
 * 同两个仓储），不重新发明第二套判定——只是把"抛异常"换成"返回 false"。
 */
import type { CredentialRepository } from "../auth/ports";
import type { PlatformAdminRepository } from "./platform-admin-ports";
import { isPlatformOperator } from "../../domain/system/platform-admin";
import { isPlatformSuperuserEmail, platformSuperuserWhitelistFromEnv } from "../../domain/system/platform-superuser";

export async function isRequestorPlatformOperator(
  deps: { readonly credentials: CredentialRepository; readonly platformAdmins: PlatformAdminRepository },
  userId: string,
): Promise<boolean> {
  const credential = await deps.credentials.findByUserId(userId);
  const whitelist = platformSuperuserWhitelistFromEnv(process.env.PLATFORM_SUPERUSER_EMAILS);
  const isSuperuser = isPlatformSuperuserEmail(credential?.email ?? "", whitelist);
  const isAdmin = isSuperuser ? false : await deps.platformAdmins.isPlatformAdmin(userId);
  return isPlatformOperator(isSuperuser, isAdmin);
}
