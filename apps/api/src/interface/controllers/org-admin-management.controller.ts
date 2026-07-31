/**
 * F11 的三条路由（UC-1.6 R10 / O-28 ⑥ / O-29 ②④⑤）。协议适配，判断全在 `application`。
 *
 *   POST /organizations/:orgId/invites/:inviteId/review     另一名管理员批准/拒绝管理员邀请
 *   POST /organizations/:orgId/teams                        团队增/删/改
 *   POST /organizations/:orgId/members/:userId/remove       移除组织成员
 *
 * 三条路由都受 Guard 保护（无 `@Public()`），且都要求调用者在**本组织**的角色——
 * 与 `org-invite.controller.ts` 同一处置：从库里读 `actorOrgRole`，不从请求体读。
 *
 * ⚠ 路由是 `POST …/remove` 不是 `DELETE /organizations/:orgId/members/:userId`：
 *   契约 `ORG_ADMIN_FORBIDDEN_ROUTES` 的长注解释了为什么——`no-forbidden-routes.test.ts`
 *   的 `^DELETE\s+\/organizations` 前缀禁令会误伤它。
 */
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import { orgAdmin as C } from "@repo/contracts";
import { mutateTeam, TeamInUseError } from "../../application/auth/mutate-team";
import { removeOrgMember } from "../../application/auth/remove-org-member";
import { reviewAdminInvite } from "../../application/auth/review-admin-invite";
import { OrgAdminError } from "../../application/auth/org-invite-errors";
import {
  ORG_INVITE_REPOSITORY,
  type OrgInviteRepository,
} from "../../application/auth/org-invite-ports";
import { ORG_MEMBER_REPOSITORY, type OrgMemberRepository } from "../../application/auth/org-member-ports";
import { TEAM_REPOSITORY, type TeamRepository } from "../../application/auth/team-ports";
import { SESSION_TOKEN_STORE, type SessionTokenStore } from "../../application/auth/ports";
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const REVIEW_ADMIN_INVITE_SCHEMA = C.operations.reviewAdminInvite.in;
export const MUTATE_TEAM_SCHEMA = C.operations.mutateTeam.in;
export const REMOVE_ORG_MEMBER_SCHEMA = C.operations.removeOrgMember.in;

type ReviewBody = { orgId: string; inviteId: string; decision: "approve" | "reject"; reason: string | null };
type MutateTeamBody = {
  orgId: string;
  op: "create" | "rename" | "delete";
  teamId: string | null;
  name: string | null;
};
type RemoveMemberBody = { orgId: string; userId: string };

@Controller()
export class OrgAdminManagementController {
  constructor(
    @Inject(ORG_INVITE_REPOSITORY) private readonly invites: OrgInviteRepository,
    @Inject(TEAM_REPOSITORY) private readonly teams: TeamRepository,
    @Inject(ORG_MEMBER_REPOSITORY) private readonly members: OrgMemberRepository,
    @Inject(SESSION_TOKEN_STORE) private readonly sessions: SessionTokenStore,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
  ) {}

  private async requireAdminRole(principal: Principal, orgIdParam: string) {
    assertPrincipal(principal);
    const orgId = toOrgId(orgIdParam);
    const membership = await this.identity.findOrgMembership(principal.userId, orgId);
    if (membership === null) throw new ForbiddenException({ reasonCode: "NO_ORG_MEMBERSHIP" });
    return { orgId, orgRole: membership.orgRole };
  }

  @Post("/organizations/:orgId/invites/:inviteId/review")
  async review(
    @Param("orgId") orgIdParam: string,
    @Param("inviteId") inviteIdParam: string,
    @Body(new ZodBodyPipe(REVIEW_ADMIN_INVITE_SCHEMA)) body: ReviewBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      const out = await reviewAdminInvite(
        { repo: this.invites },
        {
          orgId,
          reviewerId: principal.userId,
          reviewerOrgRole: orgRole,
          inviteId: inviteIdParam,
          decision: body.decision,
        },
      );
      return { status: out.status, tokenIssued: out.tokenIssued };
    } catch (e) {
      throw toHttpException(e);
    }
  }

  @Post("/organizations/:orgId/teams")
  async mutate(
    @Param("orgId") orgIdParam: string,
    @Body(new ZodBodyPipe(MUTATE_TEAM_SCHEMA)) body: MutateTeamBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      const out = await mutateTeam(
        { repo: this.teams },
        { orgId, actorOrgRole: orgRole, op: body.op, teamId: body.teamId, name: body.name },
      );
      return { team: out.team, blocked: out.blocked };
    } catch (e) {
      if (e instanceof TeamInUseError) {
        throw new ConflictException({ reasonCode: e.reasonCode, blocked: e.occupancy });
      }
      throw toHttpException(e);
    }
  }

  @Post("/organizations/:orgId/members/:userId/remove")
  async remove(
    @Param("orgId") orgIdParam: string,
    @Param("userId") userIdParam: string,
    @Body(new ZodBodyPipe(REMOVE_ORG_MEMBER_SCHEMA)) _body: RemoveMemberBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      const out = await removeOrgMember(
        { repo: this.members, sessions: this.sessions },
        { orgId, actorId: principal.userId, actorOrgRole: orgRole, userId: userIdParam },
      );
      return out;
    } catch (e) {
      throw toHttpException(e);
    }
  }
}

/**
 * `OrgAdminError` -> HTTP。⚠ 只有一个越权码需要 403，其余全部 409——同
 * `org-invite.controller.ts` 的处置：状态码是粗粒度的，细粒度的原因在
 * `reasonCode`（`AllExceptionsFilter` 会把它铺进响应体）。
 */
function toHttpException(e: unknown) {
  if (e instanceof OrgAdminError) {
    if (e.reasonCode === "PROJECT_ROLE_INSUFFICIENT") {
      return new ForbiddenException({ reasonCode: e.reasonCode });
    }
    return new ConflictException({ reasonCode: e.reasonCode });
  }
  return e;
}
