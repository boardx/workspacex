/**
 * F10 的两条路由（UC-1.6）。协议适配，判断全在 `application`。
 *
 *   POST /organizations/:orgId/invites   管理员邀请一个人（受 Guard 保护）
 *   POST /org-invites/activate           受邀人激活（`@Public()`）
 *
 * ## 为什么激活那条是 `@Public()`
 *
 * 与注册同一条理由：受邀人此刻还没有账号，也还不属于任何组织。
 * **令牌本身就是这条端点的授权**，所以它的失败模式是防枚举的（V10：无效 / 过期 /
 * 已用 / 已撤销四种返回逐字节相同），而不是有帮助的。
 *
 * ## 🔴 篡改的三个字段是从**查询串**读的，不是从 body
 *
 * 契约 `activateOrgMember.in` 里根本没有 orgId / orgRole / teamId
 * （「字段不存在是契约事实」），而且它是 `.strict()` 的——把它们塞进 body 会被
 * `ZodBodyPipe` 直接 400。所以链接里那三个明文值只能从查询串过来，
 * 由激活落地页把 `?org=&role=&team=` 原样带上。
 *
 * ⚠ 它们**对授予没有任何影响**，唯一去处是 `org_invite_tamper_attempts`。
 *   不收就没得审计：那样「篡改无效」只能证明到「我们没读」，
 *   证明不到「有人试过」（usecases.md 要求「篡改尝试写安全审计」）。
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { orgAdmin as C } from "@repo/contracts";
import { inviteOrgMember } from "../../application/auth/invite-org-member";
import { activateOrgMember } from "../../application/auth/activate-org-member";
import { OrgAdminError } from "../../application/auth/org-invite-errors";
import { PasswordPolicyError } from "../../application/auth/errors";
import {
  ORG_INVITE_REPOSITORY,
  type OrgInviteRepository,
} from "../../application/auth/org-invite-ports";
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
export const INVITE_ORG_MEMBER_SCHEMA = C.operations.inviteOrgMember.in;
export const ACTIVATE_ORG_MEMBER_SCHEMA = C.operations.activateOrgMember.in;

type InviteBody = { orgId: string; email: string; orgRole: string; teamId: string };
type ActivateBody = {
  token: string;
  mode: "new-account" | "existing-account";
  profile: { name: string; password: string } | null;
  sessionId: string | null;
};

/** 查询串里可能带来的声明值。缺项一律 `null`——「没说」不是「说错了」。 */
function claimOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

@Controller()
export class OrgInviteController {
  constructor(
    @Inject(ORG_INVITE_REPOSITORY) private readonly repo: OrgInviteRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(SESSION_TOKEN_STORE) private readonly sessions: SessionTokenStore,
    @Inject(TOKEN_FACTORY) private readonly tokens: TokenFactory,
  ) {}

  @Post("/organizations/:orgId/invites")
  async invite(
    @Param("orgId") orgIdParam: string,
    @Body(new ZodBodyPipe(INVITE_ORG_MEMBER_SCHEMA)) body: InviteBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(orgIdParam);

    // 调用者在**本组织**的角色，从库里读，不从请求体读。
    // 请求体里的 `orgId` 是路径参数的回声（契约里两处都有），路径参数赢。
    const membership = await this.identity.findOrgMembership(principal.userId, orgId);
    if (membership === null) throw new ForbiddenException({ reasonCode: "NO_ORG_MEMBERSHIP" });

    try {
      const out = await inviteOrgMember(
        { repo: this.repo },
        {
          orgId,
          actorId: principal.userId,
          actorOrgRole: membership.orgRole,
          email: body.email,
          orgRole: body.orgRole,
          teamId: body.teamId.length > 0 ? body.teamId : null,
        },
      );
      // ⚠ `activationToken`：**只在签发的这一次响应里回传**（invite-link-and-reads
      //   delta ①，coord-main 2026-08-11 裁决 A）。旧注释「token 不进响应体」防的是
      //   「任何管理员随时可读他人链接」——那条线仍然封死：列表（`listOrgInvites`）
      //   恒不含 token，幂等重放时用例层已把 token 置 null（见 invite-org-member.ts
      //   末尾），`awaiting-review` 根本没签发。能发起邀请的本来就是 admin，把他自己
      //   刚签发的令牌回传给他**一次**、由他转交受邀人，不扩大任何可再读的面——
      //   在邮件通道接通之前，这是链接送达受邀人的唯一诚实通道。
      return {
        inviteId: out.inviteId,
        status: out.status,
        quotaReserved: out.quotaReserved,
        tokenIssued: out.tokenIssued,
        activationToken: out.token,
      };
    } catch (e) {
      if (e instanceof OrgAdminError) {
        if (e.reasonCode === "PROJECT_ROLE_INSUFFICIENT") {
          throw new ForbiddenException({ reasonCode: e.reasonCode });
        }
        throw new ConflictException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  @Public()
  @Post("/org-invites/activate")
  async activate(
    @Body(new ZodBodyPipe(ACTIVATE_ORG_MEMBER_SCHEMA)) body: ActivateBody,
    @Query() query: Record<string, unknown>,
    @CurrentPrincipal() principal: Principal | null,
  ) {
    try {
      const out = await activateOrgMember(
        { repo: this.repo, hasher: this.hasher, sessions: this.sessions, tokens: this.tokens },
        {
          token: body.token,
          mode: body.mode,
          profile: body.profile,
          // ⚠ 已有账号分支的 userId 来自 Guard 解析出的 principal，**不是 body.sessionId**。
          //   契约里那个字段是「我带着会话来的」这一事实的形状，不是身份本身；
          //   拿它当身份用，等于让请求体里的一个字符串决定给谁授权。
          existingUserId: principal?.userId ?? null,
          untrustedClaims: {
            orgId: claimOf(query.org),
            orgRole: claimOf(query.role),
            teamId: claimOf(query.team),
          },
        },
      );
      return {
        userId: out.userId,
        orgId: out.orgId,
        orgRole: out.orgRole,
        teamId: out.teamId ?? "",
        sessionId: out.sessionId,
      };
    } catch (e) {
      if (e instanceof PasswordPolicyError) {
        // 与重置密码那条同一形状：这是**字段级校验失败**，不是邀请失效。
        // 把它折进 `INVITE_NOT_FOUND` 会让一个只是口令太弱的人以为链接过期了，
        // 然后去找管理员重发——而重发不会解决任何问题。
        throw new ContractValidationError([{ path: "profile.password", code: e.rejection }]);
      }
      if (e instanceof OrgAdminError) {
        // ⚠ 两个码都是 400，**同一个状态**。把 `INVITE_ALREADY_MEMBER` 做成 409
        // 会让「这个组织里有没有这个邮箱」变成一个可探测的事实——
        // 而调用者手里那枚令牌本来只证明了「他被邀请过」。
        throw new BadRequestException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }
}
