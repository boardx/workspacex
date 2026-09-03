/**
 * `platform-members` 契约束的两条路由（member-role-management delta，平台级成员管理）。
 *
 *   GET   /platform/members                                       全平台账号名册
 *   PATCH /platform/members/:userId/organizations/:orgId/role    改一名成员在某组织里的角色
 *
 * ## 鉴权在 Guard 层，不在这里
 *
 * 两条都挂 `PlatformSuperuserGuard`——与 `system-error-log.controller.ts` 同一道门、
 * 同一个理由（契约文件头）：全平台名册没有一个 `org_id` 可以拿来判组织角色，
 * 「这个 principal 是不是平台超管」按 `mod-org-identity` 的规定只能住在
 * `interface/guards`，业务 controller 不重判。
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
  Body, ConflictException, Controller, Get, HttpException, HttpStatus, Inject, NotFoundException, Param, Patch, UseGuards,
} from "@nestjs/common";
import type { z } from "zod";
import { platformMembers as C } from "@repo/contracts";
import { ORG_MEMBER_REPOSITORY, type OrgMemberRepository } from "../../application/auth/org-member-ports";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../application/provenance/ports";
import { listPlatformMembers } from "../../application/system/list-platform-members";
import { PLATFORM_MEMBER_REPOSITORY, type PlatformMemberRepository } from "../../application/system/platform-member-ports";
import { PlatformMembersError } from "../../application/system/platform-members-errors";
import { setPlatformMemberOrgRole } from "../../application/system/set-platform-member-org-role";
import { platformSuperuserWhitelistFromEnv } from "../../domain/system/platform-superuser";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
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
@UseGuards(PlatformSuperuserGuard)
export class PlatformMemberController {
  constructor(
    @Inject(PLATFORM_MEMBER_REPOSITORY) private readonly platform: PlatformMemberRepository,
    @Inject(ORG_MEMBER_REPOSITORY) private readonly members: OrgMemberRepository,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
  ) {}

  @Get(C.operations.listPlatformMembers.path)
  async list(@CurrentPrincipal() principal: Principal) {
    // Guard 已经跑完；这里只是每个 controller 都做的那条结构性非空断言，不是第二次授权判定。
    assertPrincipal(principal);
    const out = await listPlatformMembers(
      { repo: this.platform },
      { superuserWhitelist: platformSuperuserWhitelistFromEnv(process.env.PLATFORM_SUPERUSER_EMAILS) },
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
}
