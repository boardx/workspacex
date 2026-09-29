/**
 * 组织首页配置（ad-hoc feature，Refs #4634）。
 *
 *   GET /organizations/:orgId/home-config   任意组织成员可读
 *   PUT /organizations/:orgId/home-config   仅组织 admin
 *
 * 授权两个私有方法逐字照抄 `org-admin-management.controller.ts` 的
 * `requireAdminRole`/`requireOrgAdmin`——本仓约定是每个 controller 自己判一次
 * 成员资格，不共用一个跨 controller 的 helper（同该文件头注「无 `@Public()`」的先例）。
 */
import { Body, Controller, ForbiddenException, Get, Inject, Param, Put } from "@nestjs/common";
import type { z } from "zod";
import { homeConfig as C } from "@repo/contracts";
import { getHomeConfig } from "../../application/home/get-home-config";
import { updateHomeConfig } from "../../application/home/update-home-config";
import { HOME_CONFIG_REPOSITORY, type HomeConfigRepository } from "../../application/home/home-config-ports";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const UPDATE_HOME_CONFIG_SCHEMA = C.operations.updateHomeConfig.in;
type UpdateHomeConfigBody = z.infer<typeof UPDATE_HOME_CONFIG_SCHEMA>;

@Controller()
export class HomeConfigController {
  constructor(
    @Inject(HOME_CONFIG_REPOSITORY) private readonly repo: HomeConfigRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
  ) {}

  private async requireAdminRole(principal: Principal, orgIdParam: string) {
    assertPrincipal(principal);
    const orgId = toOrgId(orgIdParam);
    const membership = await this.identity.findOrgMembership(principal.userId, orgId);
    if (membership === null) throw new ForbiddenException({ reasonCode: "NO_ORG_MEMBERSHIP" });
    return { orgId, orgRole: membership.orgRole };
  }

  private async requireOrgAdmin(principal: Principal, orgIdParam: string) {
    const { orgId, orgRole } = await this.requireAdminRole(principal, orgIdParam);
    if (orgRole !== "admin") throw new ForbiddenException({ reasonCode: "FORBIDDEN" });
    return { orgId };
  }

  @Get("/organizations/:orgId/home-config")
  async get(@Param("orgId") orgIdParam: string, @CurrentPrincipal() principal: Principal) {
    const { orgId } = await this.requireAdminRole(principal, orgIdParam);
    return getHomeConfig({ repo: this.repo }, orgId);
  }

  @Put("/organizations/:orgId/home-config")
  async update(
    @Param("orgId") orgIdParam: string,
    @Body(new ZodBodyPipe(UPDATE_HOME_CONFIG_SCHEMA)) body: UpdateHomeConfigBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const { orgId } = await this.requireOrgAdmin(principal, orgIdParam);
    return updateHomeConfig(
      { repo: this.repo },
      {
        orgId,
        title: body.title,
        tagline: body.tagline,
        bannerHeadline: body.bannerHeadline,
        bannerTagline: body.bannerTagline,
        bannerPreset: body.bannerPreset,
        quickActions: body.quickActions,
        recommendedCapabilities: body.recommendedCapabilities,
        updatedBy: principal.userId,
      },
    );
  }
}
