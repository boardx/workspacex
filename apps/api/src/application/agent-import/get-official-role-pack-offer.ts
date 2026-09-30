/**
 * 官方数字人「待启用」要约（2026-09-30 人类反馈：聊天选人处「看不到新增的数字人」）。
 *
 * 根因：官方角色包（D002/D003/D005/D011）只能由管理员调 `POST /admin/agents/starter-pack-imports`
 * 导入（UC-3，签核契约：「每组织 4 个 official」由管理员决策产生），而 Web 端从未提供这个入口，
 * 也没有任何种子/建组织流程代导入——于是真实组织里一个官方数字人都没有。
 *
 * 取舍：不做「为每个组织自动安装」——那会绕过 UC-3 的管理员决策（导入台账 `administrator_id`
 * 必须是真实管理员），属于需要人类改签的产品规则变更。这里只把「本组织尚未启用的官方角色」
 * 读出来，交给选人浮层展示为「待启用」，管理员一键启用走原导入用例（同一条校验/落库路径）。
 */
import type { IdentityRepository } from "../identity/ports";
import type { OrgId } from "../../domain/org-id";
import { buildOfficialAgentRolePack } from "../../domain/agent/official-role-packs";
import type { OfficialAgentRolePackImportRepository } from "./ports";

export interface OfficialRolePackOfferView {
  readonly packId: string;
  readonly packVersion: string;
  readonly canEnable: boolean;
  readonly pending: readonly {
    readonly roleRef: string;
    readonly name: string;
    readonly roleLabel: string;
    readonly avatar: { readonly kind: "illustration"; readonly key: string; readonly alt: string } | null;
    readonly roleCategory: "research" | "product" | "sales" | "design" | "general";
    readonly tags: readonly string[];
    readonly workflowAllowlist: readonly string[];
  }[];
}

export async function getOfficialRolePackOffer(
  deps: { readonly identities: IdentityRepository; readonly imports: Pick<OfficialAgentRolePackImportRepository, "importedOfficialStableNames"> },
  input: { readonly actorId: string; readonly orgId: OrgId },
): Promise<OfficialRolePackOfferView> {
  const pack = buildOfficialAgentRolePack();
  const [membership, imported] = await Promise.all([
    deps.identities.findOrgMembership(input.actorId, input.orgId),
    deps.imports.importedOfficialStableNames(input.orgId),
  ]);
  const have = new Set(imported);
  return {
    packId: pack.packId,
    packVersion: pack.packVersion,
    canEnable: membership?.orgRole === "admin",
    pending: pack.agents.filter((a) => !have.has(a.stableName)).map((a) => ({
      roleRef: a.roleRef,
      name: a.name,
      roleLabel: a.roleLabel,
      avatar: a.role.avatar,
      roleCategory: a.role.roleCategory ?? "general",
      tags: [...a.role.tags],
      workflowAllowlist: [...a.role.workflowAllowlist],
    })),
  };
}
