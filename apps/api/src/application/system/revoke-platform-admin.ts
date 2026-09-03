/**
 * `revokePlatformAdmin`（platform-admin-role delta）—— 撤销一个账号的平台管理员身份。
 * 授权同 `grant-platform-admin.ts`（两层 guard，只有真超管能到这里）。目标账号本身不存在
 * 时报 `MEMBER_NOT_FOUND`（与 grant 对称）；账号存在但本来就不是平台管理员时幂等成功。
 */
import type { CredentialRepository } from "../auth/ports";
import type { PlatformAdminRepository } from "./platform-admin-ports";
import { PlatformMembersError } from "./platform-members-errors";

export interface RevokePlatformAdminDeps {
  readonly credentials: CredentialRepository;
  readonly platformAdmins: PlatformAdminRepository;
}

export interface RevokePlatformAdminInput {
  readonly userId: string;
}

export interface RevokePlatformAdminOutput {
  readonly userId: string;
  readonly platformAdmin: false;
}

export async function revokePlatformAdmin(
  deps: RevokePlatformAdminDeps,
  input: RevokePlatformAdminInput,
): Promise<RevokePlatformAdminOutput> {
  const target = await deps.credentials.findByUserId(input.userId);
  if (target === null) throw new PlatformMembersError("MEMBER_NOT_FOUND");
  await deps.platformAdmins.revoke(input.userId);
  return { userId: input.userId, platformAdmin: false };
}
