/**
 * `listPlatformMembers`（member-role-management delta，平台级）—— 名册读取。
 *
 * 授权（平台运营准入：平台超管或平台管理员）在 interface 层的 `PlatformOperatorGuard` 做完
 * 才到这里；本文件不重复判。唯一的加工是给每一行打两个标记：
 *   · `platformSuperuser`——白名单由调用方（controller，读 env 的唯一落点）传进来，
 *     这里只调 domain 的纯判定 `isPlatformSuperuserEmail`，与 guard 用的是同一个函数。
 *   · `platformAdmin`——落库的角色，由调用方传入的 `adminUserIds` 集合判定（一次性批量
 *     读，见 `PlatformAdminRepository.listAdminUserIds`，不为每一行单独查一次）。
 */
import { isPlatformSuperuserEmail } from "../../domain/system/platform-superuser";
import type { PlatformMemberListRow, PlatformMemberRepository } from "./platform-member-ports";

export interface ListPlatformMembersDeps {
  readonly repo: PlatformMemberRepository;
}

export interface ListPlatformMembersInput {
  readonly superuserWhitelist: readonly string[];
  readonly adminUserIds: ReadonlySet<string>;
}

export type PlatformMemberView = PlatformMemberListRow & {
  readonly platformSuperuser: boolean;
  readonly platformAdmin: boolean;
};

export interface ListPlatformMembersOutput {
  readonly members: readonly PlatformMemberView[];
}

export async function listPlatformMembers(
  deps: ListPlatformMembersDeps,
  input: ListPlatformMembersInput,
): Promise<ListPlatformMembersOutput> {
  const rows = await deps.repo.listAll();
  return {
    members: rows.map((r) => ({
      ...r,
      platformSuperuser: isPlatformSuperuserEmail(r.email, input.superuserWhitelist),
      platformAdmin: input.adminUserIds.has(r.userId),
    })),
  };
}
