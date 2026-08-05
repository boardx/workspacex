/**
 * F11 的三条路由（UC-1.6 R10 / O-28 ⑥ / O-29 ②④⑤）+ #363 补接的两条孤儿契约操作。
 * 协议适配，判断全在 `application`。
 *
 *   POST /organizations/:orgId/invites/:inviteId/review     另一名管理员批准/拒绝管理员邀请
 *   POST /organizations/:orgId/invites/:inviteId/resend     重发邀请（#363，I-6）
 *   POST /organizations/:orgId/invites/:inviteId/revoke     撤销邀请（#363）
 *   POST /organizations/:orgId/teams                        团队增/删/改
 *   POST /organizations/:orgId/members/:userId/remove       移除组织成员
 *
 * 五条路由都受 Guard 保护（无 `@Public()`），且都要求调用者在**本组织**的角色——
 * 与 `org-invite.controller.ts` 同一处置：从库里读 `actorOrgRole`，不从请求体读。
 *
 * ## #363：resend / revoke 的防枚举靠的是**判定顺序**，不是错误码长得像
 *
 * `requireAdminRole` 在**任何一次按 inviteId 的查库之前**跑完，且用例第一行再判一次
 * 组织角色（`resend-org-invite.ts` / `revoke-org-invite.ts`）。所以：
 * · 非本组织成员 → 403 `NO_ORG_MEMBERSHIP`，与 inviteId 存不存在无关；
 * · 本组织的非管理员 → 403 `PROJECT_ROLE_INSUFFICIENT`，同样与 inviteId 无关；
 * · 管理员拿别人组织的 inviteId → 仓储在 RLS 租户上下文里查，零行 ⇒ 与「这个 id
 *   根本不存在」**由构造**产生同一个 `INVITE_NOT_FOUND`（V10）。
 *
 * ⚠ 两条路由的响应体里**没有令牌**，而且不是靠这里记得删：契约的 `out` 是 `.strict()`
 *   且不含它，用例返回的对象里根本没有那个字段，仓储也不把它交出来。三层都没有，
 *   所以「回显令牌」这个变异必须先在三处之一造出一个字段才写得出来。
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
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import { orgAdmin as C } from "@repo/contracts";
import { mutateTeam, TeamInUseError } from "../../application/auth/mutate-team";
import { removeOrgMember } from "../../application/auth/remove-org-member";
import { resendOrgInvite } from "../../application/auth/resend-org-invite";
import { revokeOrgInvite } from "../../application/auth/revoke-org-invite";
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
/** #363。导出，供 `contract-single-source.test.ts` 断言与契约是**同一个对象**而非长得像。 */
export const RESEND_ORG_INVITE_SCHEMA = C.operations.resendOrgInvite.in;
export const REVOKE_ORG_INVITE_SCHEMA = C.operations.revokeOrgInvite.in;
export const MUTATE_TEAM_SCHEMA = C.operations.mutateTeam.in;
export const REMOVE_ORG_MEMBER_SCHEMA = C.operations.removeOrgMember.in;

type ReviewBody = { orgId: string; inviteId: string; decision: "approve" | "reject"; reason: string | null };
type InviteRefBody = { orgId: string; inviteId: string };
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

  /**
   * #363 / I-6：重发 = 签发新令牌 + 作废旧令牌。**不幂等**，故受 `RATE_LIMITED` 保护。
   *
   * ⚠ `inviteId` 取**路径参数**，不取 body 里那个同名字段——与 `invite` 那条
   *   「路径参数赢」同一处置。body 里的 orgId/inviteId 是契约里的回声，
   *   拿它当权威就等于让请求体决定动哪一行。
   */
  @Post("/organizations/:orgId/invites/:inviteId/resend")
  async resend(
    @Param("orgId") orgIdParam: string,
    @Param("inviteId") inviteIdParam: string,
    @Body(new ZodBodyPipe(RESEND_ORG_INVITE_SCHEMA)) _body: InviteRefBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      const out = await resendOrgInvite(
        { repo: this.invites },
        { orgId, actorId: principal.userId, actorOrgRole: orgRole, inviteId: inviteIdParam },
      );
      // 契约 `out` 逐字两个字段。令牌不在这里，也不在 `out` 里——见文件头。
      return { newTokenIssued: out.newTokenIssued, cooldownSec: out.cooldownSec };
    } catch (e) {
      throw toHttpException(e);
    }
  }

  /** #363：撤销一条尚未激活的邀请。**幂等**——重复撤销返回同一 `revoked`。 */
  @Post("/organizations/:orgId/invites/:inviteId/revoke")
  async revoke(
    @Param("orgId") orgIdParam: string,
    @Param("inviteId") inviteIdParam: string,
    @Body(new ZodBodyPipe(REVOKE_ORG_INVITE_SCHEMA)) _body: InviteRefBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    try {
      const out = await revokeOrgInvite(
        { repo: this.invites },
        { orgId, actorId: principal.userId, actorOrgRole: orgRole, inviteId: inviteIdParam },
      );
      return { status: out.status };
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
    // #363：`RATE_LIMITED` 是这一族里第二个不该被折进 409 的码。
    // 409 CONFLICT 对一次「冷却还没过」是误导性的——客户端读到冲突会去重试或提示用户
    // 「状态已变」，而正确的反应是**等一会儿再来**，那正是 429 的语义。
    // ⚠ 它只出现在 `resendOrgInvite.err` 里，所以这一行影响不到本文件其余四条路由。
    if (e.reasonCode === "RATE_LIMITED") {
      return new HttpException({ reasonCode: e.reasonCode }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return new ConflictException({ reasonCode: e.reasonCode });
  }
  return e;
}
