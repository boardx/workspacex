/**
 * UC-P9 `addProjectMember` —— **两个入口共用同一个 application 用例**（Q-4① 裁 B）。
 *
 * 组织内成员直接指派（`subject.kind: "orgUser"`）与组织外/免注册走邀请链接
 * （`subject.kind: "inviteToken"`）在这里只在**一处**分岔：怎么把 `subject` 换成
 * 一个 `userId` + 一份授予值（角色/是否 host/组号）。分岔之后，剩下的判定与落库——
 * 授予者判定（`authorizeManageMembers`）、写 `project_memberships`、写审计——**完全是
 * 同一段代码**，不是两条平行的实现。
 *
 * ⚠ 理由同「`readContent` 为什么不给个人层另开接口」（契约文件头逐字）：
 *   另开一个接口意味着这段不变量要写两遍，漏掉的那一遍不会有任何东西报警。
 *   `tests/project/member-two-entries-one-usecase.test.ts` 把这句话变成机械断言：
 *   两种 `subject.kind` 落库前必须经过同一个 `authorizeManageMembers` + 同一次
 *   `members.addMember()` 调用，而不是各自维护一份权限判断或一条 INSERT。
 *
 * ## `inviteToken` 路径：角色来自服务端记录值，不信任请求体
 *
 * `subject.kind === "inviteToken"` 时，`input.projectRole` / `input.isHost` **被忽略**，
 * 实际写入的角色取自 `resolver.resolveInviteToken()` 返回的 `ResolvedInviteGrant`——
 * 那是链接签发时锁定的值（契约 `InviteLinkGrant.projectRole` 注释「**服务端记录值**」的
 * 同一条纪律）。反过来信任请求体，等于允许持有一枚「组员」邀请码的人在核销请求里把自己
 * 声明成 `facilitator`，这正是「两个入口共用同一用例」这句话要防的那类越权。
 *
 * `isHost` 对 `inviteToken` 路径恒为 `false`：`invite_links`（0025 迁移）没有 `is_host`
 * 列，现有免注册进场写入路径（`pg-invite-link-repository.ts` 的访客进场分支）同样对
 * `is_host` 写死 `false`——本函数延续同一处理，不发明一个链接表达不出来的值。
 *
 * ## `projectId` 不匹配时的处理
 *
 * 邀请链接自带 `projectId`（签发时锁定，见 `invite_links.project_id`）。若与请求路径里的
 * `projectId` 不一致，视为「这枚令牌对这个项目无效」，与「令牌不存在/未核销」同码——两者
 * 对调用方而言都是「这条进场路径走不通」，没有必要（也没有契约码支持）把两者分开报告。
 */
import type { OrgId } from "../../domain/org-id";
import type { ProjectRole } from "../../domain/identity/roles";
import type { IdentityRepository } from "../identity/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import { authorizeManageMembers } from "./member-authorization";
import { ProjectError, ProjectMemberAlreadyExistsError } from "./errors";
import type { MemberSubjectResolver, ProjectMembershipRepository } from "./member-ports";

export interface AddProjectMemberDeps {
  readonly identity: IdentityRepository;
  readonly members: ProjectMembershipRepository;
  readonly resolver: MemberSubjectResolver;
  readonly provenance: ProvenanceWriter;
}

export interface AddProjectMemberSubject {
  readonly kind: "orgUser" | "inviteToken";
  /** `orgUser` 时是 userId；`inviteToken` 时是令牌（契约 `addProjectMember.in.subject.ref`）。 */
  readonly ref: string;
}

export interface AddProjectMemberInput {
  readonly actorId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly subject: AddProjectMemberSubject;
  readonly projectRole: ProjectRole;
  readonly isHost: boolean;
}

export interface AddProjectMemberOutput {
  readonly projectId: string;
  readonly userId: string;
  readonly projectRole: ProjectRole;
  readonly isHost: boolean;
  readonly provenanceEventId: string;
}

export async function addProjectMember(
  deps: AddProjectMemberDeps,
  input: AddProjectMemberInput,
): Promise<AddProjectMemberOutput> {
  await authorizeManageMembers(deps.identity, {
    actorId: input.actorId,
    orgId: input.orgId,
    projectId: input.projectId,
  });

  let userId: string;
  let projectRole: ProjectRole;
  let isHost: boolean;
  let groupId: string | null;

  if (input.subject.kind === "orgUser") {
    userId = input.subject.ref;
    projectRole = input.projectRole;
    isHost = input.isHost;
    groupId = null;
  } else {
    const grant = await deps.resolver.resolveInviteToken(input.orgId, input.subject.ref);
    // 未核销 / 不存在 / 项目对不上——三种情形对调用方合并成同一个结果（见文件头）。
    // ⚠ 契约没有为「令牌无效」单开码；`NO_PROJECT_ROLE` 是最接近的既有语义
    //   （「这次请求没有可用的项目层身份来源」），且它已经是「正常状态」这条既有定性
    //   的延伸，不是杜撰。
    if (grant === null || grant.projectId !== input.projectId) {
      throw new ProjectError("NO_PROJECT_ROLE");
    }
    userId = grant.userId;
    projectRole = grant.projectRole;
    isHost = false;
    groupId = grant.groupId;
  }

  const outcome = await deps.members.addMember({
    orgId: input.orgId,
    projectId: input.projectId,
    userId,
    projectRole,
    isHost,
    groupId,
  });

  switch (outcome.kind) {
    case "not-found":
      // 同 `archiveProject` 先例：不存在的容器与「你管不了这个容器」落在同一个码上。
      throw new ProjectError("ORG_ROLE_INSUFFICIENT");
    case "archived":
      throw new ProjectError("PROJECT_ARCHIVED");
    case "already-member":
      throw new ProjectMemberAlreadyExistsError();
    case "added":
      break;
  }

  const provenanceEventId = await deps.provenance.append({
    orgId: input.orgId,
    type: "role-changed",
    actorId: input.actorId,
    // ⚠ `membership` 是 `ProvenanceTargetKind` 里为本域预留、此前从未被用过的成员
    //   （`packages/contracts/src/provenance.ts`）。没有单列的成员 id 列，`(user_id,
    //   project_id)` 是主键，这里拼一个可读的复合 id 而不是编一个假的单值。
    target: { kind: "membership", id: `${input.projectId}:${userId}` },
    detail: { op: "member-added", subjectKind: input.subject.kind, projectRole, isHost },
  });

  return {
    projectId: input.projectId,
    userId,
    projectRole,
    isHost,
    provenanceEventId,
  };
}
