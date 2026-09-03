/**
 * 组织角色变更的**判定规则**（member-role-management delta）—— 纯函数，无 IO。
 *
 * 组织级（`setOrgMemberRole`，组织 admin 发起）与平台级（`setPlatformMemberOrgRole`，
 * 平台超管发起）两条路径改的是同一列 `org_memberships.org_role`，落库前的判定必须是
 * **同一份**：平台级不是「更高权限所以可以绕过」，一个没有管理员的组织对平台运维一样
 * 是麻烦。规则放在 domain 而不是各自的 use case 里，正是为了让两条路径没有第二份可漂移的副本。
 *
 * 唯一的硬阻断：**不许把最后一名 admin 降成别的角色**（`last-admin`）。
 * · 自降不阻断（放权不是越权），只要组织里还有别的 admin。
 * · 改成同一个角色是幂等重放（`no-op`），不是错误——调用方照常回传 `previousOrgRole === orgRole`。
 *
 * ⚠ `adminCount` 是**含目标本人**的当前 admin 数：目标是 admin 且 `adminCount <= 1`，
 *   就意味着他是唯一的那个。调用方（仓储）负责在同一事务里锁住 admin 行再数，
 *   否则两名 admin 同时互相降级会各自看到「还有另一个」而把组织降成零 admin。
 */
import type { OrgRole } from "@repo/contracts/identity";
import type { z } from "zod";

export type OrgRoleValue = z.infer<typeof OrgRole>;

export type OrgRoleChangeDecision =
  | { readonly kind: "apply" }
  | { readonly kind: "no-op" }
  | { readonly kind: "last-admin" };

export function decideOrgRoleChange(input: {
  readonly currentRole: OrgRoleValue;
  readonly nextRole: OrgRoleValue;
  readonly adminCount: number;
}): OrgRoleChangeDecision {
  if (input.currentRole === input.nextRole) return { kind: "no-op" };
  if (input.currentRole === "admin" && input.adminCount <= 1) return { kind: "last-admin" };
  return { kind: "apply" };
}
