/**
 * 非工作坊容器（研究项目 / 用户洞察）的协作者（项目中枢 B3-T5，#4499）——契约
 * `project.operations.{listNonWorkshopMembers, addNonWorkshopMember, removeNonWorkshopMember}` 的
 * 真实 API 薄封装（形状同 `live-project-members.ts`）。
 *
 * ⚠ 两档 owner / collaborator 不是工作坊四角色；`/collaborators` 三条对工作坊容器返回
 *   **400 不带码**（`project_kind_mismatch`），界面按 `project.kind` 决定走哪组路由，不靠试错。
 */
import { project } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type NonWorkshopMemberEntry = z.infer<typeof project.NonWorkshopMemberEntry>;
export type NonWorkshopMemberRole = z.infer<typeof project.NonWorkshopMemberRole>;
export type ListNonWorkshopMembersOut = z.infer<typeof project.operations.listNonWorkshopMembers.out>;
export type AddNonWorkshopMemberOut = z.infer<typeof project.operations.addNonWorkshopMember.out>;
export type RemoveNonWorkshopMemberOut = z.infer<typeof project.operations.removeNonWorkshopMember.out>;

/** 两档的中文标签，只此一份（契约 `NonWorkshopMemberRole` 头注：U-1 候选 B 的最小命名）。 */
export const NON_WORKSHOP_MEMBER_ROLE_LABEL: Record<NonWorkshopMemberRole, string> = {
  owner: "负责人",
  collaborator: "协作者",
};
export const NON_WORKSHOP_MEMBER_ROLES = project.NonWorkshopMemberRole.options;

function collaboratorPath(template: string, projectId: string, userId?: string): string {
  const p = template.replace(":projectId", encodeURIComponent(projectId));
  return userId === undefined ? p : p.replace(":userId", encodeURIComponent(userId));
}

export async function listNonWorkshopMembers(projectId: string): Promise<ListNonWorkshopMembersOut> {
  return apiRequest<ListNonWorkshopMembersOut>(
    collaboratorPath(project.operations.listNonWorkshopMembers.path, projectId),
    { method: "GET" },
  );
}

export async function addNonWorkshopMember(input: {
  projectId: string; userId: string; role: NonWorkshopMemberRole;
}): Promise<AddNonWorkshopMemberOut> {
  return apiRequest<AddNonWorkshopMemberOut>(
    collaboratorPath(project.operations.addNonWorkshopMember.path, input.projectId),
    { method: "POST", body: input },
  );
}

export async function removeNonWorkshopMember(projectId: string, userId: string): Promise<RemoveNonWorkshopMemberOut> {
  return apiRequest<RemoveNonWorkshopMemberOut>(
    collaboratorPath(project.operations.removeNonWorkshopMember.path, projectId, userId),
    { method: "DELETE" },
  );
}
