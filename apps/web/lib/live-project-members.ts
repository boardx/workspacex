/**
 * 项目成员（项目中枢 R3）——契约 `project.operations.{listProjectMembers, addProjectMember,
 * changeProjectRole, removeProjectMember}` 的真实 API 薄封装。四条路由后端早已挂上（#609 / F125），
 * 此前前端没有任何消费点。
 *
 * ⚠ `addProjectMember` 这里只走 `subject.kind: "orgUser"`（组织内成员直接指派）；
 *   `inviteToken` 那条入口由被邀请者自己经 `acceptProjectInvite`（R2）走，不在管理面出现。
 * ⚠ `listProjectMembers.out.members` 对非工作坊两类恒为 `null`（不是空数组），界面要分辨。
 */
import { project } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ProjectMemberEntry = z.infer<typeof project.ProjectMemberEntry>;
export type ListProjectMembersOut = z.infer<typeof project.operations.listProjectMembers.out>;
export type AddProjectMemberOut = z.infer<typeof project.operations.addProjectMember.out>;
export type ChangeProjectRoleOut = z.infer<typeof project.operations.changeProjectRole.out>;
export type RemoveProjectMemberOut = z.infer<typeof project.operations.removeProjectMember.out>;
export type ProjectMemberRole = ProjectMemberEntry["projectRole"];

function memberPath(template: string, projectId: string, userId?: string): string {
  const p = template.replace(":projectId", encodeURIComponent(projectId));
  return userId === undefined ? p : p.replace(":userId", encodeURIComponent(userId));
}

export async function listProjectMembers(projectId: string): Promise<ListProjectMembersOut> {
  return apiRequest<ListProjectMembersOut>(
    memberPath(project.operations.listProjectMembers.path, projectId),
    { method: "GET" },
  );
}

export async function addProjectMember(input: {
  projectId: string; userId: string; projectRole: ProjectMemberRole; isHost?: boolean;
}): Promise<AddProjectMemberOut> {
  return apiRequest<AddProjectMemberOut>(
    memberPath(project.operations.addProjectMember.path, input.projectId),
    {
      method: "POST",
      body: {
        projectId: input.projectId,
        subject: { kind: "orgUser", ref: input.userId },
        projectRole: input.projectRole,
        isHost: input.isHost ?? false,
      },
    },
  );
}

export async function changeProjectRole(input: {
  projectId: string; userId: string; projectRole: ProjectMemberRole; isHost: boolean;
}): Promise<ChangeProjectRoleOut> {
  return apiRequest<ChangeProjectRoleOut>(
    memberPath(project.operations.changeProjectRole.path, input.projectId, input.userId),
    { method: "PATCH", body: input },
  );
}

export async function removeProjectMember(projectId: string, userId: string): Promise<RemoveProjectMemberOut> {
  return apiRequest<RemoveProjectMemberOut>(
    memberPath(project.operations.removeProjectMember.path, projectId, userId),
    { method: "DELETE", body: { projectId, userId } },
  );
}
