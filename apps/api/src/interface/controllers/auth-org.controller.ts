/**
 * F22 的三条路由：切组织、加入第二个组织、导出。协议适配，判断全在 `application`。
 *
 * ## ⚠ 三条都**不是** `@Public()`
 *
 * 与 `auth.controller.ts` 的三条正相反：那三条是「你还没有会话，来拿一个」，
 * 这三条是「你已经有会话，用它做点什么」。Guard 全局注册、默认保护，
 * 所以这里什么都不用写——正因为如此，这段注释是必要的：
 * 下一个往这个文件里加路由的人会看到上面那个文件满屏的 `@Public()`。
 *
 * ## sessionToken 从哪来
 *
 * `switchOrgAtLogin` 的 application 签名要 `sessionToken`（usecases.md 原样），
 * 而契约的 HTTP `in` 里没有它——它走 Authorization 头。
 * 把 bearer token 放进请求体，它就会出现在每一条访问日志与每一次抓包回放里。
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { auth as C } from "@repo/contracts";
import { switchOrgAtLogin } from "../../application/auth/switch-org-at-login";
import { joinOrgWithInvite } from "../../application/auth/join-org-with-invite";
import { exportOrganization } from "../../application/auth/export-organization";
import { AuthError, InviteCodeInvalidError } from "../../application/auth/errors";
import {
  CLOCK, CREDENTIAL_REPOSITORY, ORG_LIFECYCLE_REPOSITORY, REGISTRATION_REPOSITORY,
  SESSION_TOKEN_STORE,
  type Clock, type CredentialRepository, type OrgLifecycleRepository,
  type RegistrationRepository, type SessionTokenStore,
} from "../../application/auth/ports";
import {
  AUTHORIZATION_CACHE, DECISION_ID_FACTORY, IDENTITY_REPOSITORY, SESSION_STORE,
  type AuthorizationCache, type DecisionIdFactory, type IdentityRepository, type SessionStore,
} from "../../application/identity/ports";
import { CAPABILITY_REPOSITORY, type CapabilityRepository } from "../../application/identity/capability-ports";
import { NoOrgMembershipError } from "../../application/identity/errors";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const SWITCH_ORG_AT_LOGIN_SCHEMA = C.operations.switchOrgAtLogin.in;
export const JOIN_ORG_SCHEMA = C.operations.joinOrgWithInvite.in;

/**
 * Guard 保证 principal 非空（F18 的结构性断言）；这里只是把它变成一个类型上的事实。
 * 用 `assertPrincipal` 而不是自己写判空：它是那条不变量的唯一落点，
 * 第二份判空写法迟早会漏掉 `orgId`。
 */
function requireUser(principal: Principal): string {
  assertPrincipal(principal);
  return principal.userId;
}

/**
 * 从 Authorization 头取 bearer token。
 *
 * ⚠ 与 `SessionTokenPrincipalResolver` 用的是同一处头，但**没有**复用它的解析函数：
 * 那个 resolver 的职责是把头变成 principal，这里要的是**原始 token**（用来改会话记录）。
 * 让 resolver 顺带把 token 挂到 request 上，会让「principal 里带着凭据本身」成为常态，
 * 而 principal 会被打进日志。
 */
function bearer(req: { headers: Record<string, unknown> }): string {
  const raw = req.headers["authorization"];
  const value = typeof raw === "string" ? raw : "";
  const m = /^Bearer\s+(.+)$/i.exec(value);
  if (m === null) throw new UnauthorizedException({ reasonCode: "SESSION_EXPIRED" });
  return m[1]!.trim();
}

@Controller()
export class AuthOrgController {
  constructor(
    @Inject(SESSION_TOKEN_STORE) private readonly sessions: SessionTokenStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(SESSION_STORE) private readonly ctx: SessionStore,
    @Inject(AUTHORIZATION_CACHE) private readonly cache: AuthorizationCache,
    @Inject(CAPABILITY_REPOSITORY) private readonly capabilities: CapabilityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(REGISTRATION_REPOSITORY) private readonly registration: RegistrationRepository,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(ORG_LIFECYCLE_REPOSITORY) private readonly orgs: OrgLifecycleRepository,
  ) {}

  /**
   * 200，不是 201：没有任何东西被创建，当前会话换了个指向。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/auth/switch-org")
  async switchOrg(
    @Req() req: { headers: Record<string, unknown> },
    @Body(new ZodBodyPipe(SWITCH_ORG_AT_LOGIN_SCHEMA)) body: { toOrgId: string },
  ) {
    try {
      return await switchOrgAtLogin(
        {
          sessions: this.sessions,
          clock: this.clock,
          // 原样转交。本 controller 不解释这些依赖中的任何一个——
          // 解释它们就是在这里重新实现一遍切换。
          identity: {
            repo: this.repo,
            sessions: this.ctx,
            cache: this.cache,
            capabilities: this.capabilities,
            ids: this.ids,
          },
        },
        { sessionToken: bearer(req), toOrgId: toOrgId(body.toOrgId) },
      );
    } catch (e) {
      // 404 而非 403：拒绝不得泄露那个组织是否存在（identity.controller 同一条规则）。
      if (e instanceof NoOrgMembershipError) throw new NotFoundException();
      if (e instanceof AuthError) throw new UnauthorizedException({ reasonCode: e.reason });
      throw e;
    }
  }

  /** 201：确实创建了一个组织。 */
  @Post("/auth/join-org")
  async joinOrg(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(JOIN_ORG_SCHEMA)) body: { code: string; orgName: string },
  ) {
    try {
      return await joinOrgWithInvite(
        { repo: this.registration, credentials: this.credentials },
        // ⚠ userId 来自 principal，**永远不从 body 取**。可伪造的 userId 在这条路径上
        // 意味着「花一枚码把自己挂进别人的账号」。
        { userId: requireUser(principal), code: body.code, orgName: body.orgName },
      );
    } catch (e) {
      // 不存在 / 已核销 / 已过期 / 已吊销 —— 同一个响应，同一个码。
      if (e instanceof InviteCodeInvalidError) {
        throw new BadRequestException({ reasonCode: e.reasonCode });
      }
      if (e instanceof AuthError) throw new UnauthorizedException({ reasonCode: e.reason });
      throw e;
    }
  }

  /**
   * GET：导出是读，没有副作用。
   *
   * ⚠ 组织停用时这条路仍然通——冻结只挡写（迁移 0012 只加 INSERT/UPDATE/DELETE 三条
   * RESTRICTIVE 策略，SELECT 一条都没加）。这正是 O-29 ③ 与 UC-1.5 V12 ② 要的：
   * 「停用期间仅管理员可导出」，而不是「停用即封存」。
   */
  @Get("/auth/org-export")
  async exportOrg(@CurrentPrincipal() principal: Principal, @Query("orgId") orgId: string) {
    try {
      return await exportOrganization(
        { identity: this.repo, orgs: this.orgs, ids: this.ids },
        { userId: requireUser(principal), orgId: toOrgId(orgId) },
      );
    } catch (e) {
      if (e instanceof NoOrgMembershipError) throw new NotFoundException();
      throw e;
    }
  }
}
