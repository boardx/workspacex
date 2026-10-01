/**
 * #4615（PROP-PROJECT-WORKSPACE-001 §3.2，人类裁决 ④）—— 白板访问的**项目来源**。
 *
 * 挂在项目 P 上的白板（`project_resource_links.kind = 'whiteboard'`），P 的成员按项目层身份借到一个白板角色：
 *   · 工作坊 facilitator / groupLead / member、通用项目 owner / collaborator ⇒ `editor`；
 *   · 工作坊 observer、通用项目名单外的组织 lead / admin（observer 行）⇒ `viewer`；
 *   · 其余 ⇒ 没有这条来源。
 * 项目已归档 ⇒ 最多 `viewer`（归档 = 只读，I-P38）。
 *
 * ## 为什么在这里、而不是在白板的 SQL 里 JOIN 成员表
 *
 * 「这个人在这个项目里站在哪一层」只有一个答案：`resolveProjectLayer`（#4584 建的单一判据，工作坊行 /
 * 通用项目两档 / 组织 lead·admin 旁观都在那里映射）。在白板的 SQL 里再 JOIN 一次 `project_memberships` /
 * `general_project_members`，就是第二份项目成员判定——正是本项目已五次漂移的那种副本。
 * 这里只把它的产物交给纯函数 `projectWhiteboardRole`，再由调用方与白板自己的 ACL 取并集。
 *
 * ## 在调用方的事务里跑
 *
 * 白板存储在一个租户事务里锁住白板行再判权（「撤销之后的下一次写必须看得见撤销」）。项目来源也要在**同一个**
 * 事务里读——`deps` 由基础设施按当前会话装配（`infrastructure/whiteboard/pg-whiteboard-project-access.ts`），
 * 不另开连接：既看得见同一时刻已提交的「移出项目 / 解挂」，也不会在连接池里一次占两条连接。
 */
import type { OrgId } from "../../domain/org-id";
import { projectWhiteboardRole } from "../../domain/whiteboard/access-decision";
import type { IdentityRepository } from "../identity/ports";
import type { TenantSession } from "../ports/database.port";
import { resolveProjectLayer } from "../identity/project-layer";

/** 白板挂在哪个项目上（没挂 ⇒ `null`）以及那个项目是否已归档。 */
export interface BoardProjectLink {
  readonly projectId: string;
  readonly archived: boolean;
}

export interface WhiteboardProjectAccessDeps {
  readonly identity: Pick<IdentityRepository, "findOrgMembership" | "findProjectMembership" | "findNonWorkshopStanding">;
  readonly boardProject: (orgId: OrgId, boardId: string) => Promise<BoardProjectLink | null>;
}

export interface WhiteboardProjectAccessInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly boardId: string;
}

export async function resolveWhiteboardProjectRole(
  deps: WhiteboardProjectAccessDeps,
  input: WhiteboardProjectAccessInput,
): Promise<"editor" | "viewer" | null> {
  // agent 主体不是项目成员；它对白板的权限只来自白板自己的 ACL。
  if (input.userId.startsWith("agent:")) return null;
  const link = await deps.boardProject(input.orgId, input.boardId);
  if (link === null) return null;
  const org = await deps.identity.findOrgMembership(input.userId, input.orgId);
  // 组织层先判（同 `decide()`）：不是这个组织的成员，项目来源不存在。
  if (org === null) return null;
  const layer = await resolveProjectLayer(deps.identity, {
    userId: input.userId,
    projectId: link.projectId,
    orgId: input.orgId,
    orgRole: org.orgRole,
  });
  const role = projectWhiteboardRole(layer);
  if (role === "editor" && link.archived) return "viewer";
  return role;
}

/** 白板存储拿到的形状：在**它自己的**租户会话里问「这个人在这块白板上借到了什么」。 */
export interface WhiteboardProjectAccess {
  roleIn(session: TenantSession, input: WhiteboardProjectAccessInput): Promise<"editor" | "viewer" | null>;
}

/** 不接项目来源的装配（DB-free 测试、以及没有项目概念的旧装配）：恒 `null`，行为与 #4615 之前逐字相同。 */
export const NO_PROJECT_WHITEBOARD_ACCESS: WhiteboardProjectAccess = {
  async roleIn() {
    return null;
  },
};
