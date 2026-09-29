import { identity } from "@repo/contracts";
import type { PermissionDecision, ProjectLayerInput } from "../identity/permission-decision";
import { projectLayerAllows } from "../identity/permission-decision";

export type WhiteboardBoardRole = "owner" | "editor" | "commenter" | "viewer";

/** Whiteboards have an explicit private owner/member ACL and never fall back to org-wide visibility. */
export function decideWhiteboardAccess(input:{decisionId:string;role:WhiteboardBoardRole|null;action:"read"|"write"|"comment"}):PermissionDecision {
  const allowed=input.role!==null&&(input.action==="read"||(input.action==="comment"?input.role!=="viewer":input.role==="owner"||input.role==="editor"));
  return identity.PermissionDecision.parse({allowed,orgLayer:{role:input.role?"consultant":null,teamId:null,passed:input.role!==null},projectLayer:null,scopeLayer:{scope:"org-wide",passed:allowed},reasonCode:allowed?null:input.role?"PROJECT_ROLE_INSUFFICIENT":"NO_ORG_MEMBERSHIP",decisionId:input.decisionId});
}

/* ─────────── #4615（PROP-PROJECT-WORKSPACE-001 §3.2）：挂在项目上的白板，项目这一条来源 ─────────── */

/**
 * 项目层给白板的**编辑**判据：矩阵动作 `content.editWhiteboard`（facilitator / groupLead / member；
 * 非工作坊容器白名单里也有，于是通用项目的负责人 / 协作者可编辑——人类裁决 ④）。
 */
export const WHITEBOARD_PROJECT_EDIT_ACTION = "content.editWhiteboard";
/**
 * 项目层给白板的**只读**判据：`read.published`——矩阵里每一行（含 observer）都有的那一条，
 * 于是不在名单上的组织 lead / admin（非工作坊容器映射成 observer 行）与工作坊观察者可读、不可写。
 */
export const WHITEBOARD_PROJECT_READ_ACTION = "read.published";

/**
 * 项目层身份（`resolveProjectLayer` 的产物，唯一来源）→ 这块白板上借到的角色。
 *
 * 纯函数、不查库：项目身份怎么来的（工作坊行 / 通用项目两档 / 组织 lead·admin 旁观）是
 * `application/identity/project-layer.ts` 的事；这里只回答「这一层能在白板上做到什么深度」，
 * 判据走 `projectLayerAllows`（角色矩阵 ∧ 容器白名单），不另写一份角色表。
 *
 * 只可能是 `editor` / `viewer` / `null`：项目来源**永远不给 owner**——删除、改名、管成员、恢复检查点
 * 仍只属白板所有者；也不给 `commenter`（编辑者本来就能评论，旁观者按只读处理）。
 */
export function projectWhiteboardRole(layer: ProjectLayerInput): "editor" | "viewer" | null {
  if (layer.role === null) return null;
  if (projectLayerAllows(layer, WHITEBOARD_PROJECT_EDIT_ACTION)) return "editor";
  if (projectLayerAllows(layer, WHITEBOARD_PROJECT_READ_ACTION)) return "viewer";
  return null;
}

const ROLE_RANK: Readonly<Record<WhiteboardBoardRole, number>> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };

/**
 * 白板自己的 ACL（owner / 成员表）与项目来源**取并集**：两者中更强的那一个。
 *
 * 并集而不是覆盖：移出项目（或解挂白板）只拿走项目那一条，白板成员表里本来就有的人不受影响；
 * 反过来，白板成员表里的 viewer 若是项目协作者，在这块挂载的白板上就是 editor。
 */
export function unionWhiteboardRole(
  boardRole: WhiteboardBoardRole | null,
  projectRole: "editor" | "viewer" | null,
): WhiteboardBoardRole | null {
  if (boardRole === null) return projectRole;
  if (projectRole === null) return boardRole;
  return ROLE_RANK[projectRole] > ROLE_RANK[boardRole] ? projectRole : boardRole;
}
