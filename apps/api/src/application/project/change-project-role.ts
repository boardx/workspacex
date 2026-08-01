/**
 * UC-P9 `changeProjectRole`.
 *
 * ⚠ **生效时机是契约的一部分**（Q-4③ 裁）：不缓存跨请求的判定结论，只缓存单请求内的
 * （`authorizeBatch` 存在的意义正是让这条可承受）。本函数因此**不写任何跨请求缓存**——
 * `authorizeManageMembers` 与后续任何一次 `authorize()` 调用都直接查
 * `project_memberships` 当前行，下一次请求读到的就是这次 `UPDATE` 写下的新角色。
 * `tests/project/role-change-effective-next-request.test.ts` 的断言方式：变更前后各发一次
 * 独立的判定调用（不复用同一个 `PermissionDecision` 对象），后一次必须反映新角色——
 * 只断言「变更成功」而不重新判定一次，是测不出「有没有偷偷缓存」的。
 *
 * ⚠ 一人一项目恰好一个角色（主键 `(userId, projectId)`），所以这里是「改」不是「加」——
 * 没有「不存在则新建」的分支，目标行必须已经存在。
 */
import type { OrgId } from "../../domain/org-id";
import type { ProjectRole } from "../../domain/identity/roles";
import type { IdentityRepository } from "../identity/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import { authorizeManageMembers } from "./member-authorization";
import { ProjectError } from "./errors";
import type { ProjectMembershipRepository } from "./member-ports";

export interface ChangeProjectRoleDeps {
  readonly identity: IdentityRepository;
  readonly members: ProjectMembershipRepository;
  readonly provenance: ProvenanceWriter;
}

export interface ChangeProjectRoleInput {
  readonly actorId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly userId: string;
  readonly projectRole: ProjectRole;
  readonly isHost: boolean;
}

export interface ChangeProjectRoleOutput {
  readonly projectId: string;
  readonly userId: string;
  readonly projectRole: ProjectRole;
  readonly isHost: boolean;
  readonly provenanceEventId: string;
}

export async function changeProjectRole(
  deps: ChangeProjectRoleDeps,
  input: ChangeProjectRoleInput,
): Promise<ChangeProjectRoleOutput> {
  await authorizeManageMembers(deps.identity, {
    actorId: input.actorId,
    orgId: input.orgId,
    projectId: input.projectId,
  });

  const outcome = await deps.members.changeRole({
    orgId: input.orgId,
    projectId: input.projectId,
    userId: input.userId,
    projectRole: input.projectRole,
    isHost: input.isHost,
  });

  switch (outcome.kind) {
    case "not-found":
      // 同 `addProjectMember`/`archiveProject` 先例：容器不存在与「这个人本来就不是
      // 这个项目的成员」不可区分，落在同一个码上，不额外暴露存在性。
      throw new ProjectError("ORG_ROLE_INSUFFICIENT");
    case "archived":
      throw new ProjectError("PROJECT_ARCHIVED");
    case "changed":
      break;
  }

  const provenanceEventId = await deps.provenance.append({
    orgId: input.orgId,
    type: "role-changed",
    actorId: input.actorId,
    target: { kind: "membership", id: `${input.projectId}:${input.userId}` },
    detail: { op: "role-changed", projectRole: input.projectRole, isHost: input.isHost },
  });

  return {
    projectId: input.projectId,
    userId: input.userId,
    projectRole: input.projectRole,
    isHost: input.isHost,
    provenanceEventId,
  };
}
