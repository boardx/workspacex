/**
 * 组织共享邀请链接的五条路由（shared-invite-links delta）。协议适配，判断全在 application。
 *
 *   POST /organizations/:orgId/invite-links                建链（受 Guard 保护，admin）
 *   GET  /organizations/:orgId/invite-links                列表（admin）
 *   POST /organizations/:orgId/invite-links/:linkId/revoke 作废（admin，幂等）
 *   POST /organizations/:orgId/invite-links/:linkId/review 复核（admin，非建链人）
 *   POST /org-invites/activate-via-link                    持链接者加入（`@Public()`）
 *
 * ## 为什么激活那条是 `@Public()`
 *
 * 与 `org-invite.controller.ts` 的 activate 同一条理由：点链接的人还没有账号。
 * **令牌本身就是这条端点的授权**，失败面是防枚举的（五种失效同码同形）。
 *
 * ## 令牌明文的回传口径
 *
 * 与 invite-link-and-reads delta ① 同一纪律：只在**签发那一次**响应出现
 * （建链的 active 分支 / 复核批准分支），列表恒不含；且比单人 token 更严——
 * 库里只有 hash，服务端事后**想吐也吐不出来**。
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { orgAdmin as C } from "@repo/contracts";
import { createOrgInviteLink } from "../../application/auth/create-org-invite-link";
import { listOrgInviteLinks } from "../../application/auth/list-org-invite-links";
import { revokeOrgInviteLink } from "../../application/auth/revoke-org-invite-link";
import { reviewOrgInviteLink } from "../../application/auth/review-org-invite-link";
import { activateViaOrgInviteLink } from "../../application/auth/activate-via-org-invite-link";
import { OrgAdminError } from "../../application/auth/org-invite-errors";
import { PasswordPolicyError } from "../../application/auth/errors";
import {
  ORG_INVITE_LINK_REPOSITORY,
  type OrgInviteLinkRepository,
} from "../../application/auth/org-invite-link-ports";
import {
  PASSWORD_HASHER,
  SESSION_TOKEN_STORE,
  TOKEN_FACTORY,
  type PasswordHasher,
  type SessionTokenStore,
  type TokenFactory,
} from "../../application/auth/ports";
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { Public } from "../public.decorator";
import { ContractValidationError, ZodBodyPipe } from "../pipes/zod-body.pipe";

/** 导出，供 `contract-single-source.test.ts` 断言与契约是**同一个对象**而非长得像。 */
export const CREATE_ORG_INVITE_LINK_SCHEMA = C.operations.createOrgInviteLink.in;
export const REVOKE_ORG_INVITE_LINK_SCHEMA = C.operations.revokeOrgInviteLink.in;
export const REVIEW_ORG_INVITE_LINK_SCHEMA = C.operations.reviewOrgInviteLink.in;
export const ACTIVATE_VIA_ORG_INVITE_LINK_SCHEMA = C.operations.activateViaOrgInviteLink.in;

type CreateBody = {
  orgId: string;
  orgRole: string;
  expiry: "1d" | "7d" | "30d";
  maxUses: number | null;
};
type LinkRefBody = { orgId: string; linkId: string };
type ReviewBody = { orgId: string; linkId: string; decision: "approve" | "reject"; reason: string | null };
type ActivateBody = { token: string; email: string; profile: { name: string; password: string } };

@Controller()
export class OrgInviteLinkController {
  constructor(
    @Inject(ORG_INVITE_LINK_REPOSITORY) private readonly repo: OrgInviteLinkRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(SESSION_TOKEN_STORE) private readonly sessions: SessionTokenStore,
    @Inject(TOKEN_FACTORY) private readonly tokens: TokenFactory,
  ) {}

  /** 组织角色从库里读，不从请求体读（org-admin-management 的 requireAdminRole 同款）。 */
  private async resolveOrgRole(principal: Principal, orgIdParam: string) {
    assertPrincipal(principal);
    const orgId = toOrgId(orgIdParam);
    const membership = await this.identity.findOrgMembership(principal.userId, orgId);
    if (membership === null) throw new ForbiddenException({ reasonCode: "NO_ORG_MEMBERSHIP" });
    return { orgId, orgRole: membership.orgRole };
  }

  @Post("/organizations/:orgId/invite-links")
  async create(
    @Param("orgId") orgIdParam: string,
    @Body(new ZodBodyPipe(CREATE_ORG_INVITE_LINK_SCHEMA)) body: CreateBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.resolveOrgRole(principal, orgIdParam);
    try {
      const out = await createOrgInviteLink(
        { repo: this.repo },
        {
          orgId,
          actorId: principal.userId,
          actorOrgRole: orgRole,
          orgRole: body.orgRole,
          expiry: body.expiry,
          maxUses: body.maxUses,
        },
      );
      return {
        linkId: out.linkId,
        status: out.status,
        // 明文只在这一次响应里出现（pending-review 时 null：令牌不存在）。
        linkToken: out.linkToken,
        expiresAt: out.expiresAt === null ? null : out.expiresAt.toISOString(),
      };
    } catch (e) {
      throw this.mapAdminError(e);
    }
  }

  @Get("/organizations/:orgId/invite-links")
  async list(@Param("orgId") orgIdParam: string, @CurrentPrincipal() principal: Principal) {
    const { orgId, orgRole } = await this.resolveOrgRole(principal, orgIdParam);
    try {
      const links = await listOrgInviteLinks({ repo: this.repo }, { orgId, actorOrgRole: orgRole });
      return {
        links: links.map((l) => ({
          linkId: l.linkId,
          orgRole: l.orgRole,
          status: l.status,
          expiry: l.expiry,
          expiresAt: l.expiresAt === null ? null : l.expiresAt.toISOString(),
          maxUses: l.maxUses,
          usedCount: l.usedCount,
          createdBy: l.createdBy,
          createdByUserId: l.createdByUserId,
          createdAt: l.createdAt.toISOString(),
        })),
      };
    } catch (e) {
      throw this.mapAdminError(e);
    }
  }

  @Post("/organizations/:orgId/invite-links/:linkId/revoke")
  async revoke(
    @Param("orgId") orgIdParam: string,
    @Param("linkId") linkIdParam: string,
    @Body(new ZodBodyPipe(REVOKE_ORG_INVITE_LINK_SCHEMA)) _body: LinkRefBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.resolveOrgRole(principal, orgIdParam);
    try {
      // linkId 取路径参数——「路径参数赢」的既有处置（resend/revoke 同款）。
      const out = await revokeOrgInviteLink(
        { repo: this.repo },
        { orgId, actorOrgRole: orgRole, linkId: linkIdParam },
      );
      return { status: out.status };
    } catch (e) {
      throw this.mapAdminError(e);
    }
  }

  @Post("/organizations/:orgId/invite-links/:linkId/review")
  async review(
    @Param("orgId") orgIdParam: string,
    @Param("linkId") linkIdParam: string,
    @Body(new ZodBodyPipe(REVIEW_ORG_INVITE_LINK_SCHEMA)) body: ReviewBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId, orgRole } = await this.resolveOrgRole(principal, orgIdParam);
    try {
      const out = await reviewOrgInviteLink(
        { repo: this.repo },
        {
          orgId,
          reviewerId: principal.userId,
          reviewerOrgRole: orgRole,
          linkId: linkIdParam,
          decision: body.decision,
        },
      );
      return {
        status: out.status,
        // 批准签发那一次回传给批准人（reviewAdminInvite D2 的同一语义）。
        linkToken: out.linkToken,
        expiresAt: out.expiresAt === null ? null : out.expiresAt.toISOString(),
      };
    } catch (e) {
      throw this.mapAdminError(e);
    }
  }

  @Public()
  @Post("/org-invites/activate-via-link")
  async activate(@Body(new ZodBodyPipe(ACTIVATE_VIA_ORG_INVITE_LINK_SCHEMA)) body: ActivateBody) {
    try {
      const out = await activateViaOrgInviteLink(
        { repo: this.repo, hasher: this.hasher, sessions: this.sessions, tokens: this.tokens },
        { token: body.token, email: body.email, profile: body.profile },
      );
      return {
        userId: out.userId,
        orgId: out.orgId,
        orgRole: out.orgRole,
        // 共享链接不预分团队（契约头注），恒空串——与 activateOrgMember 的空团队回传同形。
        teamId: "",
        sessionId: out.sessionId,
      };
    } catch (e) {
      if (e instanceof PasswordPolicyError) {
        // 字段级校验失败不是链接失效（org-invite.controller 的同一段理由）。
        throw new ContractValidationError([{ path: "profile.password", code: e.rejection }]);
      }
      if (e instanceof OrgAdminError) {
        // 三个码都是 400 同一状态：INVITE_ALREADY_MEMBER 做成 409 会让「这个邮箱
        // 注册过吗」多一个可区分的探测维度（V10 的同一取向——虽然明确拒绝文案本身
        // 是拍板①要求的，状态码不必再多送一位信息）。
        throw new BadRequestException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /** admin 侧四条路由共用的错误映射（describeInviteFailure 的服务端镜像）。 */
  private mapAdminError(e: unknown): unknown {
    if (e instanceof OrgAdminError) {
      if (e.reasonCode === "PROJECT_ROLE_INSUFFICIENT" || e.reasonCode === "NO_ORG_MEMBERSHIP") {
        return new ForbiddenException({ reasonCode: e.reasonCode });
      }
      if (e.reasonCode === "INVITE_NOT_FOUND") {
        return new NotFoundException({ reasonCode: e.reasonCode });
      }
      return new ConflictException({ reasonCode: e.reasonCode });
    }
    return e;
  }
}
