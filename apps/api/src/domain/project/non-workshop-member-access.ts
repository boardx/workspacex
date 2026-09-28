/**
 * 项目中枢 B3-T5（#4499）—— 研究项目 / 用户洞察两类容器「谁能读名单 / 谁能增删」的**唯一**判据。
 *
 * ## 为什么不走 `authorize()`
 *
 * `authorize()` 的项目层读的是 `project_memberships`（工作坊四角色，I-P6「只属工作坊」），
 * 对非工作坊容器它永远答「无项目角色」。两类容器的身份在 `research_project_members` /
 * `user_insight_members`（U-1 裁 B，两档 owner / collaborator），所以这里另起一个决策函数——
 * 但**产出仍是一份 `PermissionDecision`**，交给 `discloseDecided()` 解开仓储的 `Guarded<T>`。
 * 同 `domain/whiteboard/access-decision.ts` 的形状：一个门（permission-filter）、两个决策来源。
 *
 * ## 判定表（契约 `addNonWorkshopMember` 头注逐字，这里是它的实现）
 *
 *   read：名单上的人（两档皆可）或组织 `lead` / `admin` → 放行
 *         在组织里、不在名单上 → NO_PROJECT_ROLE；不在组织里 → NO_PROJECT_ROLE
 *   manage：容器里的 owner → 放行
 *           容器里的 collaborator → PROJECT_ROLE_INSUFFICIENT
 *           不在容器里、容器**没有任何 owner**、组织 lead/admin → 放行（加第一位）
 *           不在容器里、其余、在组织里 → ORG_ROLE_INSUFFICIENT
 *           不在组织里 → NO_PROJECT_ROLE
 *
 * `reason` 是 `project.ProjectReason` 的码（用例直接抛），`decision.reasonCode` 是
 * `identity.PermissionReason` 的码（`ORG_ROLE_INSUFFICIENT` 不在其中，那一格填
 * `NO_PROJECT_ROLE`——决策对象只用来 disclose，用例对外抛的是 `reason`）。
 *
 * `projectLayer` 置 `null`：该字段的 `role` 是工作坊四角色的闭集，两档塞不进去；
 * 「不在项目上下文」与 whiteboard 决策的处置相同。
 */
import { identity, project } from "@repo/contracts";
import type { z } from "zod";
import type { OrgRole } from "../identity/roles";
import type { PermissionDecision } from "../identity/permission-decision";

export type NonWorkshopMemberRole = z.infer<typeof project.NonWorkshopMemberRole>;
export type NonWorkshopMemberAction = "read" | "manage";

export interface NonWorkshopMemberAccessInput {
  readonly decisionId: string;
  readonly action: NonWorkshopMemberAction;
  /** 调用者在本组织的角色；`null` = 不是组织成员。 */
  readonly orgRole: OrgRole | null;
  /** 调用者在这个容器名单上的档位；`null` = 不在名单上。 */
  readonly memberRole: NonWorkshopMemberRole | null;
  /** 容器名单里是否已有至少一名 owner（决定组织层旁路是否开着）。 */
  readonly containerHasOwner: boolean;
}

export interface NonWorkshopMemberAccessVerdict {
  readonly decision: PermissionDecision;
  /** `null` = 放行；否则是用例该抛的 `ProjectReason` 码。 */
  readonly reason: z.infer<typeof project.ProjectReason> | null;
}

const ORG_MANAGERS: readonly OrgRole[] = ["lead", "admin"];

export function decideNonWorkshopMemberAccess(input: NonWorkshopMemberAccessInput): NonWorkshopMemberAccessVerdict {
  const isOrgManager = input.orgRole !== null && ORG_MANAGERS.includes(input.orgRole);
  let reason: NonWorkshopMemberAccessVerdict["reason"] = null;

  if (input.action === "read") {
    if (input.memberRole === null && !isOrgManager) reason = "NO_PROJECT_ROLE";
  } else if (input.memberRole === "collaborator") {
    reason = "PROJECT_ROLE_INSUFFICIENT";
  } else if (input.memberRole === null) {
    if (input.orgRole === null) reason = "NO_PROJECT_ROLE";
    else if (!(isOrgManager && !input.containerHasOwner)) reason = "ORG_ROLE_INSUFFICIENT";
  }

  const allowed = reason === null;
  const decision = identity.PermissionDecision.parse({
    allowed,
    orgLayer: { role: input.orgRole, teamId: null, passed: input.orgRole !== null },
    projectLayer: null,
    scopeLayer: { scope: "org-wide", passed: allowed },
    reasonCode: allowed
      ? null
      : reason === "PROJECT_ROLE_INSUFFICIENT"
        ? "PROJECT_ROLE_INSUFFICIENT"
        : input.orgRole === null
          ? "NO_ORG_MEMBERSHIP"
          : "NO_PROJECT_ROLE",
    decisionId: input.decisionId,
  });
  return { decision, reason };
}
