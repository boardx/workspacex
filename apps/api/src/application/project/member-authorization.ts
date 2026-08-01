/**
 * F125 UC-P9 —— 谁能加人 / 改角色 / 移除人（「授予者」判定），三个用例共用。
 *
 * ## 两层 OR，不是一层判定——这是判断，写在这里而不是藏在某个 if 里
 *
 * UC-00.3 R1 把本用例的 actor 列成三种：「引导师（`facilitator`，控场者）、项目负责人
 * （组织角色 `lead`）、组织管理员（`admin`，边界见 R5）」。R5 逐条核对下来，
 * `admin` 的唯一豁口是 `purpose:"audit"` 的**读**（D-18「管理员不是超级用户」），
 * 本用例是**写**，豁口不适用——所以本判定里 `admin` 与其他任何没有 `lead`/`facilitator`
 * 身份的人一样被拒，只是拒绝码可能不同（见下）。
 *
 * 能通过的因此只有两条路径，且**互相独立、不是同一判据的两种取值**：
 *   ① 项目角色 `facilitator`——「控场」延伸出「控场者管成员」，走
 *      `project-role-matrix.ts` 新增的 `member.manage`（同 F119 引用矩阵的方式）。
 *   ② 组织角色 `lead`——Q-4② 裁「`lead` 对自建未加入的项目持管理权、不持内容读取权」；
 *      这条路径**不查项目角色**，因为 Q-4② 描述的正是「这个人在这个项目里可能根本
 *      没有一行成员记录」的情形，若还要求项目层通过，Q-4② 就无法被满足。
 *
 * ## 为什么契约同时列了 `NO_PROJECT_ROLE` / `PROJECT_ROLE_INSUFFICIENT` /
 *    `ORG_ROLE_INSUFFICIENT` 三个码——这是本判定形状的直接证据
 *
 * 对比 `archiveProject.err`（只有 `ORG_ROLE_INSUFFICIENT`，因为归档只走 `canCreateProject`
 * 一条路径）：`addProjectMember.err`/`changeProjectRole.err`/`removeProjectMember.err`
 * 三个都额外列了 `NO_PROJECT_ROLE` 与 `PROJECT_ROLE_INSUFFICIENT`——如果本判定像归档一样
 * 只走组织层，这两个码在这三个操作里将永远不可达，而契约不会平白无故为一个操作声明一个
 * 该操作永远抛不出来的码（`project.ts` 文件头「本文件的 `ProjectReason` 每一个成员都在
 * 下方某个操作的 `err` 里出现」说的是「至少一个操作」，但三个码一起单独出现在**这三个**
 * 操作而不是别处，是本判定确实需要走两层、且两层各自都可能是拒绝原因的最直接信号）。
 *
 * ⇒ 四种情形，各自对应一个不重叠的失败码：
 *   项目角色是 `facilitator`                    → 放行
 *   项目角色不是 `facilitator`（但持有某个角色）   → `PROJECT_ROLE_INSUFFICIENT`
 *     ⚠ 这条**不**因为组织角色是 `lead` 而被 lead 覆盖——Q-4② 说的是「自建未加入」
 *       （没有项目角色），不是「已经有一个项目角色，但不是 facilitator」。一个人已经
 *       以 `member`/`groupLead`/`observer` 身份进了场，不应该因为他恰好也是组织 `lead`
 *       就多出管理这场项目成员的权——那会让「四种项目角色」的分工失去意义。
 *   无项目角色 且 组织角色是 `lead`               → 放行（Q-4②）
 *   无项目角色 且 组织角色存在但不是 `lead`         → `ORG_ROLE_INSUFFICIENT`
 *   无项目角色 且 无组织角色                       → `NO_PROJECT_ROLE`（I-P9：正常状态）
 */
import type { OrgId } from "../../domain/org-id";
import { roleAllows } from "../../domain/identity/project-role-matrix";
import type { IdentityRepository, OrgMembershipRow, ProjectMembershipRow } from "../identity/ports";
import { ProjectError } from "./errors";

export const MANAGE_MEMBERS_ACTION = "member.manage" as const;

export interface AuthorizeManageMembersInput {
  readonly actorId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
}

export async function authorizeManageMembers(
  identity: IdentityRepository,
  input: AuthorizeManageMembersInput,
): Promise<void> {
  let orgMembership: OrgMembershipRow | null;
  let projectMembership: ProjectMembershipRow | null;
  try {
    [orgMembership, projectMembership] = await Promise.all([
      identity.findOrgMembership(input.actorId, input.orgId),
      identity.findProjectMembership(input.actorId, input.projectId, input.orgId),
    ]);
  } catch {
    // 判定服务不可用一律拒绝，不得降级放行——同 `archive-project.ts` / `create-project.ts`。
    throw new ProjectError("AUTH_SERVICE_UNAVAILABLE");
  }

  if (projectMembership !== null && roleAllows(projectMembership.projectRole, MANAGE_MEMBERS_ACTION)) {
    return; // ① facilitator
  }
  if (orgMembership?.orgRole === "lead") {
    return; // ② Q-4② 管理权override
  }

  if (projectMembership !== null) throw new ProjectError("PROJECT_ROLE_INSUFFICIENT");
  if (orgMembership !== null) throw new ProjectError("ORG_ROLE_INSUFFICIENT");
  throw new ProjectError("NO_PROJECT_ROLE");
}
