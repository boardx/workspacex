/**
 * UC-P9 `removeProjectMember`.
 *
 * ⚠ 移除的是**成员关系**，不是任何内容——与 Q-9「不提供删除项目」不冲突。
 * ⚠ 「移除最后一名引导师 / 最后一名 `isHost`」**未裁**（uc-00-3 E6，`isHost` 在库里是
 *   无约束布尔）→ 本操作**不为它设失败码**，本函数不自行拦这个情形。
 */
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import { authorizeManageMembers } from "./member-authorization";
import { ProjectError } from "./errors";
import type { ProjectMembershipRepository } from "./member-ports";

export interface RemoveProjectMemberDeps {
  readonly identity: IdentityRepository;
  readonly members: ProjectMembershipRepository;
  readonly provenance: ProvenanceWriter;
}

export interface RemoveProjectMemberInput {
  readonly actorId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly userId: string;
}

export interface RemoveProjectMemberOutput {
  readonly projectId: string;
  readonly userId: string;
  readonly provenanceEventId: string;
}

export async function removeProjectMember(
  deps: RemoveProjectMemberDeps,
  input: RemoveProjectMemberInput,
): Promise<RemoveProjectMemberOutput> {
  await authorizeManageMembers(deps.identity, {
    actorId: input.actorId,
    orgId: input.orgId,
    projectId: input.projectId,
  });

  const outcome = await deps.members.removeMember({
    orgId: input.orgId,
    projectId: input.projectId,
    userId: input.userId,
  });

  switch (outcome.kind) {
    case "not-found":
      throw new ProjectError("ORG_ROLE_INSUFFICIENT");
    case "archived":
      throw new ProjectError("PROJECT_ARCHIVED");
    case "removed":
      break;
  }

  const provenanceEventId = await deps.provenance.append({
    orgId: input.orgId,
    type: "role-changed",
    actorId: input.actorId,
    target: { kind: "membership", id: `${input.projectId}:${input.userId}` },
    detail: { op: "member-removed" },
  });

  return {
    projectId: input.projectId,
    userId: input.userId,
    provenanceEventId,
  };
}
