/**
 * `listPlatformMembers`（member-role-management delta，平台级）—— 名册读取。
 *
 * 授权（平台超管）在 interface 层的 `PlatformSuperuserGuard` 做完才到这里；本文件不重复判。
 * 唯一的加工是给每一行打 `platformSuperuser` 标记：白名单由调用方（controller，读 env 的
 * 唯一落点）传进来，这里只调 domain 的纯判定 `isPlatformSuperuserEmail`——与 guard
 * 用的是同一个函数，「谁是超管」只有一处答案。
 */
import { isPlatformSuperuserEmail } from "../../domain/system/platform-superuser";
import type { PlatformMemberListRow, PlatformMemberRepository } from "./platform-member-ports";

export interface ListPlatformMembersDeps {
  readonly repo: PlatformMemberRepository;
}

export interface ListPlatformMembersInput {
  readonly superuserWhitelist: readonly string[];
}

export type PlatformMemberView = PlatformMemberListRow & { readonly platformSuperuser: boolean };

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
    })),
  };
}
