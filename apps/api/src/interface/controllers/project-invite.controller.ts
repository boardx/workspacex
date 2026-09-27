/**
 * 项目邀请链接的三条路由（项目中枢 R2，用户直接交办 2026-09-27）。协议适配，判断全在 application。
 *
 *   POST /projects/:projectId/invite-links         签发（本项目引导师；F15 `issueInviteLink`，幂等）
 *   POST /projects/:projectId/invite-links/revoke  撤销一条 / `[重置全部]`（F15 `revokeInviteLinks`）
 *   POST /project-invites/accept                   已登录组织成员用令牌把自己加进项目（`acceptProjectInvite`）
 *
 * ## 为什么此前这些用例没有路由
 *
 * F15 的四个写用例 + 仓储早已实现并有真实 PG 测试，但 `apps/api/src/interface` 里没有任何
 * controller 调它们，`INVITE_LINK_REPOSITORY` 也没注册进 kernel——契约 `issueInviteLink` /
 * `revokeInviteLink` 一直躺在 `contract-route-coverage-allowlist.json` 的「声明了 path 却不接线」
 * 名单里。本文件把这两条接上（名单相应缩短），并补 `acceptProjectInvite` 这条被邀请者自己走的路径。
 *
 * ## 调用者的项目角色从库里读，不从请求读
 *
 * 同 `checkin-board.controller.ts` 的纪律：`actorProjectRole` 由 `identity.findProjectMembership`
 * 解析后传入，`assertCanManageInviteLinks` 在 application 判定。读不到就是 `null`
 * （⇒ `NO_PROJECT_ROLE`），不是这里代判。
 *
 * ## 链接 URL
 *
 * F15 用例拼的是原型路径（`/w/<projectId>?t=`），前端落地页实际是 `/projects/join?t=`
 * （`apps/web/lib/live-project-invite.ts` `buildProjectInviteLink`）。响应里 `url` 仍按契约返回，
 * 但前端以 `token` 自行拼可用链接——与 `activation-link.ts` 对组织邀请令牌的既有做法相同。
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Param,
  Post,
  ServiceUnavailableException,
  BadRequestException,
} from "@nestjs/common";
import { orgAdmin as C } from "@repo/contracts";
import type { z } from "zod";
import { issueInviteLink } from "../../application/auth/issue-invite-link";
import { revokeInviteLinks } from "../../application/auth/revoke-invite-links";
import { OrgAdminError } from "../../application/auth/org-invite-errors";
import { INVITE_LINK_REPOSITORY, type InviteLinkRepository } from "../../application/auth/invite-link-ports";
import { acceptProjectInvite } from "../../application/project/accept-project-invite";
import {
  PROJECT_MEMBERSHIP_REPOSITORY,
  type ProjectMembershipRepository,
} from "../../application/project/member-ports";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

/** 导出，供 `contract-single-source.test.ts` 断言与契约是**同一个对象**而非长得像。 */
export const ISSUE_INVITE_LINK_SCHEMA = C.operations.issueInviteLink.in;
export const REVOKE_INVITE_LINK_SCHEMA = C.operations.revokeInviteLink.in;
export const ACCEPT_PROJECT_INVITE_SCHEMA = C.operations.acceptProjectInvite.in;

type IssueBody = z.infer<typeof ISSUE_INVITE_LINK_SCHEMA>;
type RevokeBody = z.infer<typeof REVOKE_INVITE_LINK_SCHEMA>;
type AcceptBody = z.infer<typeof ACCEPT_PROJECT_INVITE_SCHEMA>;

/**
 * `OrgAdminError` → HTTP。四种链接失效对参与者都是 403 同形（契约 E1：不泄露项目 / 组是否存在），
 * `INVITE_NOT_FOUND` 也落 403 而不是 404——404 会让「不存在」与「存在但已撤销」在状态码上分开。
 */
function mapAdminError(e: OrgAdminError): never {
  switch (e.reasonCode) {
    case "AUTH_SERVICE_UNAVAILABLE":
      throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
    case "LINK_TOKEN_REQUIRED":
      throw new BadRequestException({ reasonCode: e.reasonCode });
    default:
      throw new ForbiddenException({ reasonCode: e.reasonCode });
  }
}

@Controller()
export class ProjectInviteController {
  constructor(
    @Inject(INVITE_LINK_REPOSITORY) private readonly links: InviteLinkRepository,
    @Inject(PROJECT_MEMBERSHIP_REPOSITORY) private readonly members: ProjectMembershipRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
  ) {}

  @Post(C.operations.issueInviteLink.path)
  async issue(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(ISSUE_INVITE_LINK_SCHEMA)) body: IssueBody,
  ): Promise<z.infer<typeof C.operations.issueInviteLink.out>> {
    assertPrincipal(principal);
    if (body.projectId !== projectId) throw new BadRequestException("project_id_mismatch");
    const orgId = toOrgId(principal.orgId);
    const membership = await this.identity.findProjectMembership(principal.userId, projectId, orgId);
    try {
      const out = await issueInviteLink(
        { repo: this.links },
        {
          actorId: principal.userId,
          actorProjectRole: membership?.projectRole ?? null,
          orgId,
          projectId,
          kind: body.kind,
          groupId: body.groupId,
          identity: body.identity,
          validity: body.validity,
        },
      );
      return { linkId: out.linkId, url: out.url, token: out.token, inviteCode: out.inviteCode, qrPayload: out.qrPayload };
    } catch (e) {
      if (e instanceof OrgAdminError) mapAdminError(e);
      throw e;
    }
  }

  @Post(C.operations.revokeInviteLink.path)
  async revoke(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(REVOKE_INVITE_LINK_SCHEMA)) body: RevokeBody,
  ): Promise<z.infer<typeof C.operations.revokeInviteLink.out>> {
    assertPrincipal(principal);
    if (body.projectId !== projectId) throw new BadRequestException("project_id_mismatch");
    const orgId = toOrgId(principal.orgId);
    const membership = await this.identity.findProjectMembership(principal.userId, projectId, orgId);
    try {
      const out = await revokeInviteLinks(
        { repo: this.links },
        {
          actorId: principal.userId,
          actorProjectRole: membership?.projectRole ?? null,
          orgId,
          projectId,
          linkId: body.linkId,
        },
      );
      return {
        revokedLinkIds: [...out.revokedLinkIds],
        onsiteSessions: out.onsiteSessions,
        survivesUntilStageId: out.survivesUntilStageId,
      };
    } catch (e) {
      if (e instanceof OrgAdminError) mapAdminError(e);
      throw e;
    }
  }

  @Post(C.operations.acceptProjectInvite.path)
  async accept(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(ACCEPT_PROJECT_INVITE_SCHEMA)) body: AcceptBody,
  ): Promise<z.infer<typeof C.operations.acceptProjectInvite.out>> {
    assertPrincipal(principal);
    try {
      return await acceptProjectInvite(
        { links: this.links, members: this.members, identity: this.identity },
        { userId: principal.userId, orgId: toOrgId(principal.orgId), token: body.token },
      );
    } catch (e) {
      if (e instanceof OrgAdminError) mapAdminError(e);
      throw e;
    }
  }
}
