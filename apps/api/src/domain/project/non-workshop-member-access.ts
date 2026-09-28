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
 *
 * ## #4584：容器内其余读写怎么判——`nonWorkshopProjectLayer`
 *
 * 名单的读 / 增删仍由上面的 `decideNonWorkshopMemberAccess` 判。容器里的其余东西（概览、来源、
 * 资源挂载、AI 权限、项目大脑）走的是 `authorize()`，它的项目层此前只认 `project_memberships`，
 * 于是两类容器对所有人都是 NO_PROJECT_ROLE（#4584）。现在 `application/identity/project-layer.ts`
 * 在工作坊行缺席时读两档身份，交给本文件的 `nonWorkshopProjectLayer` 映射成项目层输入：
 *
 *   owner                         → facilitator 那一行（能读全部、能管配置）
 *   collaborator                  → member 那一行（读 + 参与，不能管）
 *   不在名单上、组织 lead / admin  → observer 那一行（只有 read.published——与上表 read 行
 *                                   「组织 lead / admin 可读」同一条判据，且只读）
 *   其余                          → 无项目角色（NO_PROJECT_ROLE / ADMIN_NOT_SUPERUSER，同工作坊）
 *
 * 映射只借「读写到什么深度」；工作坊专属机制由 `containerKind` + `project-role-matrix.ts` 的
 * `NON_WORKSHOP_CONTAINER_ACTIONS` 白名单统一挡住，不靠这里。
 */
import { identity, project } from "@repo/contracts";
import type { z } from "zod";
import type { OrgRole, ProjectRole } from "../identity/roles";
import type { PermissionDecision, ProjectLayerInput } from "../identity/permission-decision";

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

export type NonWorkshopContainerKind = Exclude<z.infer<typeof project.ProjectKind>, "workshop">;

/** 两档 → 四角色矩阵里借用的那一行。闭合映射，是「两档读写到什么深度」的唯一形式。 */
export const NON_WORKSHOP_TIER_PROJECT_ROLE: Readonly<Record<NonWorkshopMemberRole, ProjectRole>> = {
  owner: "facilitator",
  collaborator: "member",
};

/** 不在名单上的组织 lead / admin 借用的那一行：只读已发布内容（见文件头 #4584 一节）。 */
export const NON_WORKSHOP_ORG_READER_PROJECT_ROLE: ProjectRole = "observer";

export interface NonWorkshopProjectLayerInput {
  readonly containerKind: NonWorkshopContainerKind;
  /** 调用者在这个容器名单上的档位；`null` = 不在名单上。 */
  readonly memberRole: NonWorkshopMemberRole | null;
  /** 调用者在本组织的角色；`null` = 不是组织成员。 */
  readonly orgRole: OrgRole | null;
}

/** 两类容器的身份 → `decide()` 的项目层输入。纯函数，映射规则见文件头。 */
export function nonWorkshopProjectLayer(input: NonWorkshopProjectLayerInput): ProjectLayerInput {
  let role: ProjectRole | null = null;
  if (input.memberRole !== null) role = NON_WORKSHOP_TIER_PROJECT_ROLE[input.memberRole];
  else if (input.orgRole !== null && ORG_MANAGERS.includes(input.orgRole)) role = NON_WORKSHOP_ORG_READER_PROJECT_ROLE;
  // 两类容器没有分组、没有 host（F128：两档、无 host、无分组）。
  return { role, groupId: null, isHost: false, containerKind: input.containerKind };
}
