/**
 * #4584 —— `decide()` 项目层输入的**唯一**组装点：「这个人在这个项目里站在哪一层」。
 *
 * ## 为什么需要它
 *
 * 此前 `authorize()` 直接读 `findProjectMembership`（`project_memberships`）。那张表只装工作坊
 * 行（F128 复合外键），非工作坊容器（#4615 起只有 `general`）的身份在
 * `general_project_members`（B3-T5 两档）——于是对这类容器，`authorize()` 永远答
 * NO_PROJECT_ROLE，连名单上的负责人都打不开自己的项目工作台（#4584）。
 *
 * ## 为什么在身份层解决、而不是在各用例里按 kind 分叉
 *
 * 概览、资源挂载、来源、AI 权限、项目大脑……十几个用例都经 `authorize()` 问同一个问题。
 * 在身份层把两档身份解析进项目层（并显式带上 `containerKind`），这些用例一行都不用改；
 * 工作坊专属机制由 `decide()` 按 `containerKind` 收窄到 `NON_WORKSHOP_CONTAINER_ACTIONS`
 * 白名单统一挡住。映射规则（两档 → 矩阵行、组织 lead/admin 只读）住在
 * `domain/project/non-workshop-member-access.ts` 的 `nonWorkshopProjectLayer`，与 T5 名单判据同一文件。
 *
 * ## 查询顺序
 *
 * 先读工作坊行（热路径，一次查询，与此前完全相同）；只有它缺席时才读两档身份。
 * `findNonWorkshopStanding` 对工作坊 / 不存在的项目答 `null` ⇒ 回落到「无项目角色」，
 * 与此前的外部行为逐字相同（NO_PROJECT_ROLE 与「没有这个项目」仍不可分辨）。
 *
 * ⚠ 直接读 `findProjectMembership` 的调用方（议程、看板、邀请、录音、画布……）**不经过**这里，
 *   所以它们对两类容器保持关闭——那是工作坊机制，关着是对的。
 */
import type { OrgRole } from "../../domain/identity/roles";
import type { ProjectLayerInput } from "../../domain/identity/permission-decision";
import type { OrgId } from "../../domain/org-id";
import { nonWorkshopProjectLayer } from "../../domain/project/non-workshop-member-access";
import type { IdentityRepository } from "./ports";

export interface ResolveProjectLayerInput {
  readonly userId: string;
  readonly projectId: string;
  readonly orgId: OrgId;
  /** 调用者的组织角色（调用方已读过 `findOrgMembership`，不重复读）。 */
  readonly orgRole: OrgRole | null;
}

const NO_PROJECT_ROLE: ProjectLayerInput = { role: null, groupId: null, isHost: false };

export async function resolveProjectLayer(
  repo: Pick<IdentityRepository, "findProjectMembership" | "findNonWorkshopStanding">,
  input: ResolveProjectLayerInput,
): Promise<ProjectLayerInput> {
  const workshop = await repo.findProjectMembership(input.userId, input.projectId, input.orgId);
  if (workshop !== null) {
    return {
      role: workshop.projectRole,
      groupId: workshop.groupId,
      isHost: workshop.isHost,
      containerKind: "workshop",
    };
  }
  const standing = await repo.findNonWorkshopStanding(input.userId, input.projectId, input.orgId);
  if (standing === null) return NO_PROJECT_ROLE;
  return nonWorkshopProjectLayer({
    containerKind: standing.containerKind,
    memberRole: standing.memberRole,
    orgRole: input.orgRole,
  });
}
