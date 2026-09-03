/**
 * `PlatformOperatorGuard` -- "平台运营准入"：平台超管（`PLATFORM_SUPERUSER_EMAILS` 环境变量
 * 白名单）或平台管理员（落库，`platform_admins`，platform-admin-role delta）皆可通过。
 *
 * 用在系统异常只读页（`GET /system/error-logs`）与平台成员名册的一般访问
 * （`GET /platform/members`、`PATCH .../role`）上。**不**用在"授予/撤销平台管理员"这类
 * 只有真超管才能做的动作上——那两条路由额外叠一层方法级 `PlatformSuperuserGuard`
 * （NestJS 的多个 `@UseGuards` 是"全部通过才放行"，叠两层等价于"平台运营 AND 真超管"，
 * 见 `platform-member.controller.ts`）。
 *
 * 与 `PlatformSuperuserGuard` 同一条纪律：`PrincipalGuard` 先跑完，`req.principal` 到这里
 * 已经非空；本 guard 只回答"这个 principal 是不是平台运营准入"这一个问题。
 */
import { CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { CREDENTIAL_REPOSITORY, type CredentialRepository } from "../../application/auth/ports";
import { PLATFORM_ADMIN_REPOSITORY, type PlatformAdminRepository } from "../../application/system/platform-admin-ports";
import { isPlatformOperator } from "../../domain/system/platform-admin";
import { isPlatformSuperuserEmail, platformSuperuserWhitelistFromEnv } from "../../domain/system/platform-superuser";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";

@Injectable()
export class PlatformOperatorGuard implements CanActivate {
  constructor(
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(PLATFORM_ADMIN_REPOSITORY) private readonly platformAdmins: PlatformAdminRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ principal?: Principal }>();
    const principal = req.principal;
    assertPrincipal(principal);

    const credential = await this.credentials.findByUserId(principal.userId);
    const whitelist = platformSuperuserWhitelistFromEnv(process.env.PLATFORM_SUPERUSER_EMAILS);
    const isSuperuser = isPlatformSuperuserEmail(credential?.email ?? "", whitelist);
    // 已经是真超管就不必再查一次表——纯粹省一次查询，语义不变（`||` 的短路本来就等价）。
    const isAdmin = isSuperuser ? false : await this.platformAdmins.isPlatformAdmin(principal.userId);
    if (!isPlatformOperator(isSuperuser, isAdmin)) {
      throw new ForbiddenException({ reasonCode: "NOT_PLATFORM_SUPERUSER" });
    }
    return true;
  }
}
