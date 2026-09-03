/**
 * `platform-members` 契约束的四条路由（member-role-management delta + platform-admin-role
 * delta，平台级成员管理）。
 *
 *   GET    /platform/members                                       全平台账号名册
 *   PATCH  /platform/members/:userId/organizations/:orgId/role    改一名成员在某组织里的角色
 *   POST   /platform/members/:userId/platform-admin                 授予"平台管理员"
 *   DELETE /platform/members/:userId/platform-admin                 撤销"平台管理员"
 *
 * ## 鉴权在 Guard 层，不在这里
 *
 * 前两条挂类级 `PlatformOperatorGuard`——平台超管（环境变量白名单）或平台管理员（落库，
 * `platform_admins`）皆可通过，与 `system-error-log.controller.ts` 同一道门、同一个理由
 * （契约文件头）：全平台名册没有一个 `org_id` 可以拿来判组织角色，鉴权判定按
 * `mod-org-identity` 的规定只能住在 `interface/guards`，业务 controller 不重判。
 *
 * 后两条（授予/撤销平台管理员）额外叠一层**方法级** `PlatformSuperuserGuard`——NestJS 的
 * 多个 `@UseGuards` 是"全部通过才放行"，叠出来的效果是"平台运营 AND 真超管"：一个平台
 * 管理员能看名册、能改角色，但不能把别人（或自己）也设成平台管理员或平台超管，那条线仍然
 * 钉死在环境变量白名单上，见 `domain/system/platform-superuser.ts` 头注。
 *
 * ## `PLATFORM_SUPERUSER_EMAILS` 的读取留在这一层
 *
 * `domain/system/platform-superuser.ts` 明写「纯函数，不读 `process.env`——env 的读取
 * 留在调用方（interface 层的 controller）」。名册上的 `platformSuperuser` 标记因此由
 * 这里读 env、交给用例判定，与 guard 读的是同一个变量、同一个解析函数。
 *
 * ## 为什么与组织级路由不在同一个 controller
 *
 * `org-admin-management.controller.ts` 的每一条路由都以 `requireAdminRole`（本组织成员资格）
 * 开头；平台级路由的调用者**不需要**是目标组织的成员。把它塞进去会让那个文件第一次出现
 * 一条「不查本组织成员资格」的路由，下一个人会照着抄。
 */
import {
  Body, ConflictException, Controller, Delete, Get, HttpException, HttpStatus, Inject, NotFoundException, Param, Patch,
  Post, UseGuards,
} from "@nestjs/common";
import type { z } from "zod";
import { platformMembers as C } from "@repo/contracts";
import { CREDENTIAL_REPOSITORY, type CredentialRepository } from "../../application/auth/ports";
import { ORG_MEMBER_REPOSITORY, type OrgMemberRepository } from "../../application/auth/org-member-ports";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../application/provenance/ports";
import { grantPlatformAdmin } from "../../application/system/grant-platform-admin";
import { listPlatformMembers } from "../../application/system/list-platform-members";
import { PLATFORM_ADMIN_REPOSITORY, type PlatformAdminRepository } from "../../application/system/platform-admin-ports";
import { PLATFORM_MEMBER_REPOSITORY, type PlatformMemberRepository } from "../../application/system/platform-member-ports";
import { PlatformMembersError } from "../../application/system/platform-members-errors";
import { revokePlatformAdmin } from "../../application/system/revoke-platform-admin";
import { setPlatformMemberOrgRole } from "../../application/system/set-platform-member-org-role";
import { platformSuperuserWhitelistFromEnv } from "../../domain/system/platform-superuser";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { PlatformOperatorGuard } from "../guards/platform-operator.guard";
import { PlatformSuperuserGuard } from "../guards/platform-superuser.guard";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

/** 导出，供 `contract-single-source.test.ts` 断言与契约是**同一个对象**而非长得像。 */
export const SET_PLATFORM_MEMBER_ORG_ROLE_SCHEMA = C.operations.setPlatformMemberOrgRole.in;

type SetPlatformMemberOrgRoleBody = z.infer<typeof C.operations.setPlatformMemberOrgRole.in>;

/**
 * `PlatformMembersError` -> HTTP。`MEMBER_NOT_FOUND` 404；`LAST_ADMIN` 409（当前状态不允许，
 * 先提一个新 admin 再来）——与组织级 `org-admin-management.controller.ts` 的 `toHttpException`
 * 对同两个码的处置逐字相同，两级对同一件事回同一种状态码。
 */
function toHttpException(e: unknown): unknown {
  if (e instanceof PlatformMembersError) {
    if (e.reasonCode === "MEMBER_NOT_FOUND") return new NotFoundException({ reasonCode: e.reasonCode });
    if (e.reasonCode === "LAST_ADMIN") return new ConflictException({ reasonCode: e.reasonCode });
    return new HttpException({ reasonCode: e.reasonCode }, HttpStatus.SERVICE_UNAVAILABLE);
  }
  return e;
}

@Controller()
@UseGuards(PlatformOperatorGuard)
export class PlatformMemberController {
  constructor(
    @Inject(PLATFORM_MEMBER_REPOSITORY) private readonly platform: PlatformMemberRepository,
    @Inject(ORG_MEMBER_REPOSITORY) private readonly members: OrgMemberRepository,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
    @Inject(PLATFORM_ADMIN_REPOSITORY) private readonly platformAdmins: PlatformAdminRepository,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
  ) {}

  @Get(C.operations.listPlatformMembers.path)
  async list(@CurrentPrincipal() principal: Principal) {
    // Guard 已经跑完；这里只是每个 controller 都做的那条结构性非空断言，不是第二次授权判定。
    assertPrincipal(principal);
    const out = await listPlatformMembers(
      { repo: this.platform },
      {
        superuserWhitelist: platformSuperuserWhitelistFromEnv(process.env.PLATFORM_SUPERUSER_EMAILS),
        adminUserIds: await this.platformAdmins.listAdminUserIds(),
      },
    );
    return C.operations.listPlatformMembers.out.parse(out);
  }

  @Patch(C.operations.setPlatformMemberOrgRole.path)
  async setOrgRole(
    @Param("userId") userIdParam: string,
    @Param("orgId") orgIdParam: string,
    @Body(new ZodBodyPipe(SET_PLATFORM_MEMBER_ORG_ROLE_SCHEMA)) body: SetPlatformMemberOrgRoleBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    try {
      const out = await setPlatformMemberOrgRole(
        { platform: this.platform, members: this.members, provenance: this.provenance },
        { actorId: principal.userId, orgId: toOrgId(orgIdParam), userId: userIdParam, orgRole: body.orgRole },
      );
      return C.operations.setPlatformMemberOrgRole.out.parse(out);
    } catch (e) {
      throw toHttpException(e);
    }
  }

  @UseGuards(PlatformSuperuserGuard)
  @Post(C.operations.grantPlatformAdmin.path)
  async grantPlatformAdmin(
    @Param("userId") userIdParam: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    try {
      const out = await grantPlatformAdmin(
        { credentials: this.credentials, platformAdmins: this.platformAdmins },
        { actorId: principal.userId, userId: userIdParam },
      );
      return C.operations.grantPlatformAdmin.out.parse(out);
    } catch (e) {
      throw toHttpException(e);
    }
  }

  @UseGuards(PlatformSuperuserGuard)
  @Delete(C.operations.revokePlatformAdmin.path)
  async revokePlatformAdmin(
    @Param("userId") userIdParam: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    try {
      const out = await revokePlatformAdmin(
        { credentials: this.credentials, platformAdmins: this.platformAdmins },
        { userId: userIdParam },
      );
      return C.operations.revokePlatformAdmin.out.parse(out);
    } catch (e) {
      throw toHttpException(e);
    }
  }
}
