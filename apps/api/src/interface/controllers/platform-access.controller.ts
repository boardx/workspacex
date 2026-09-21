/**
 * `GET /platform/access` —— 「我有没有平台运营准入」的自查路由（`platform-members` 束的
 * `getPlatformAccess`，permissions-review delta）。
 *
 * ## 为什么不挂 `PlatformOperatorGuard`，也不与 `PlatformMemberController` 同住
 *
 * 那个 controller 是**类级** `@UseGuards(PlatformOperatorGuard)`：住进去这条路由就会对
 * 普通用户 403，而它存在的全部意义正是「不够格的人也能拿到一个 200 的 false」——
 * 界面靠它决定画不画平台后台菜单入口，若答案本身是 403，就等于回到「用错误当信号」
 * （契约文件里 `getPlatformAccess` 的注释写了为什么不这么做）。
 * 单开一个 controller 比在那个类上挖一个 guard 例外安全：例外会被下一个人照着抄。
 *
 * ## 判定不在这里
 *
 * 复用 `isRequestorPlatformOperator`（与 `PlatformOperatorGuard` 同一个域函数
 * `isPlatformOperator` + 同两个仓储），本文件不重新拼一遍「超管 || 管理员」——
 * 那会是同一条判定的第二份声明。`platformSuperuser` / `platformAdmin` 两个分项
 * 仍要各自回显（名册屏与菜单文案都要区分这两种身份），所以这里各求一次值，
 * 组合结论则交给域函数。
 */
import { Controller, Get, Inject } from "@nestjs/common";
import { platformMembers as C } from "@repo/contracts";
import { CREDENTIAL_REPOSITORY, type CredentialRepository } from "../../application/auth/ports";
import { PLATFORM_ADMIN_REPOSITORY, type PlatformAdminRepository } from "../../application/system/platform-admin-ports";
import { isPlatformOperator } from "../../domain/system/platform-admin";
import { isPlatformSuperuserEmail, platformSuperuserWhitelistFromEnv } from "../../domain/system/platform-superuser";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

@Controller()
export class PlatformAccessController {
  constructor(
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(PLATFORM_ADMIN_REPOSITORY) private readonly platformAdmins: PlatformAdminRepository,
  ) {}

  @Get(C.operations.getPlatformAccess.path)
  async access(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const credential = await this.credentials.findByUserId(principal.userId);
    const whitelist = platformSuperuserWhitelistFromEnv(process.env.PLATFORM_SUPERUSER_EMAILS);
    const platformSuperuser = isPlatformSuperuserEmail(credential?.email ?? "", whitelist);
    // 超管已经够格就不必再查一次表（同 `PlatformOperatorGuard` 的短路），但分项回显要诚实：
    // 超管本人的 `platformAdmin` 回 false——名册屏也正是这么显示的（不给超管叠一个更窄的徽章）。
    const platformAdmin = platformSuperuser ? false : await this.platformAdmins.isPlatformAdmin(principal.userId);
    return C.operations.getPlatformAccess.out.parse({
      platformSuperuser,
      platformAdmin,
      platformOperator: isPlatformOperator(platformSuperuser, platformAdmin),
    });
  }
}
