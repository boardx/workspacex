/**
 * canvas 模板注册表四个**写**操作共用的前置判定（publish / trial / archive / restore）。
 *
 * ## 为什么四个用例共用一个函数，而不是各写一遍三行
 *
 * 与 `addProjectMember` 那条「两个入口共用同一个用例」逐字相同的理由：不变量写四遍，
 * 漏掉的那一遍不会有任何东西报警。四条路径的判据必须是**同一段代码**，否则「哪一条
 * 忘了查成员身份」这件事只有被人读到才会发现。
 *
 * ## 为什么复用 `canMutateCapabilities`，而不是新写一个 `canMutateCanvasTemplates`
 *
 * 契约自己声明了 `TemplateVisibility` 与 `identity.VisibilityScope` 是**同一套语义**
 * （`canvas.ts` 第 32 行，且文件末尾有编译期断言），而 `capability_listings.kind` 的闭集里
 * 逐字包含 `'canvas-template'`：模板库就是「这个组织配置了什么」的一部分，不是一个新概念。
 * 另写一个谓词 = 同一事实声明在两处，而本仓已五次因此漂移。
 *
 * ⚠ 于是「谁能改」这件事只有一个答案：org admin，`lead` 与 `compliance` 都不行。
 *   理由见 `canMutateCapabilities` 自己的文件头（资历不是判据，持有配置授权才是）。
 */
import { canMutateCapabilities } from "../../domain/identity/capability-listing";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository, OrgMembershipRow } from "../identity/ports";
import { CanvasError } from "./errors";

export interface CanvasTemplateAdminDeps {
  readonly identity: IdentityRepository;
}

/**
 * 返回调用者的组织成员身份，顺便证明他有权改这个组织的模板库。
 *
 * ⚠ 非成员与成员但角色不够，抛的是**同一个** `ROLE_INSUFFICIENT`。
 *   契约 `publishTemplate.err` 里没有「你不在这个组织」这个码，而把非成员单独渲染成另一种
 *   拒绝，等于告诉一个陌生人「这个组织存在，只是你不在里面」。
 */
export async function requireTemplateAdmin(
  deps: CanvasTemplateAdminDeps,
  input: { readonly userId: string; readonly orgId: OrgId },
): Promise<OrgMembershipRow> {
  let membership: OrgMembershipRow | null;
  try {
    membership = await deps.identity.findOrgMembership(input.userId, input.orgId);
  } catch {
    // 503 而不是 403：判定服务不可用**不是**一个裁定。渲染成拒绝，用户会去找管理员要一个
    // 他本来就有的权限（同 `create-project.ts` 的 `AUTH_SERVICE_UNAVAILABLE`）。
    throw new CanvasError("DEPENDENCY_UNAVAILABLE");
  }
  if (membership === null || !canMutateCapabilities(membership.orgRole)) {
    throw new CanvasError("ROLE_INSUFFICIENT");
  }
  return membership;
}

/**
 * 读路径的前置判定：必须是本组织成员。
 *
 * ⚠ 码是 `NO_PROJECT_ROLE`（`listTemplates.err` 的两个成员之一），不是
 *   `ROLE_INSUFFICIENT`——后者不在这条操作的 `err` 联合里，而 `all-exceptions.filter.ts`
 *   只放行契约枚举里的码，塞一个不属于本操作的码等于宣称了一件契约没说过的事。
 */
export async function requireOrgMember(
  deps: CanvasTemplateAdminDeps,
  input: { readonly userId: string; readonly orgId: OrgId },
): Promise<OrgMembershipRow> {
  let membership: OrgMembershipRow | null;
  try {
    membership = await deps.identity.findOrgMembership(input.userId, input.orgId);
  } catch {
    throw new CanvasError("DEPENDENCY_UNAVAILABLE");
  }
  if (membership === null) throw new CanvasError("NO_PROJECT_ROLE");
  return membership;
}
