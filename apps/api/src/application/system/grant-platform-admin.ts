/**
 * `grantPlatformAdmin`（platform-admin-role delta）—— 把一个已存在的账号设为平台管理员。
 *
 * 授权已经在 interface 层做完两层（`PlatformOperatorGuard` 类级 + 方法级
 * `PlatformSuperuserGuard`，见 `platform-member.controller.ts`）——只有真正的平台超管
 * （环境变量白名单）能走到这里，本文件不重复判定，只做"目标账号存在吗"与落库两件事。
 * 幂等：已经是平台管理员的账号再授一次仍然成功、仍然只有一行。
 */
import type { CredentialRepository } from "../auth/ports";
import type { PlatformAdminRepository } from "./platform-admin-ports";
import { PlatformMembersError } from "./platform-members-errors";

export interface GrantPlatformAdminDeps {
  readonly credentials: CredentialRepository;
  readonly platformAdmins: PlatformAdminRepository;
}

export interface GrantPlatformAdminInput {
  readonly actorId: string;
  readonly userId: string;
}

export interface GrantPlatformAdminOutput {
  readonly userId: string;
  readonly platformAdmin: true;
}

export async function grantPlatformAdmin(
  deps: GrantPlatformAdminDeps,
  input: GrantPlatformAdminInput,
): Promise<GrantPlatformAdminOutput> {
  const target = await deps.credentials.findByUserId(input.userId);
  if (target === null) throw new PlatformMembersError("MEMBER_NOT_FOUND");
  await deps.platformAdmins.grant(input.userId, input.actorId);
  return { userId: input.userId, platformAdmin: true };
}
