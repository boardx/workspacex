import { Body, Controller, Get, HttpException, Inject, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { platformOrganizations as C } from "@repo/contracts";
import type { z } from "zod";
import { PlatformOperatorGuard } from "../guards/platform-operator.guard";
import { CurrentPrincipal } from "../current-principal.decorator";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { PLATFORM_ORGANIZATION_REPOSITORY, PlatformOrganizationError, type PlatformOrganizationRepository } from "../../application/system/platform-organization-ports";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const SET_ORGANIZATION_PLAN_SCHEMA = C.operations.setPlan.in;
const status = { NOT_PLATFORM_SUPERUSER: 403, ORGANIZATION_NOT_FOUND: 404, PLAN_VERSION_CONFLICT: 409, PLATFORM_CATALOG_UNAVAILABLE: 503 } as const;
@Controller()
@UseGuards(PlatformOperatorGuard)
export class PlatformOrganizationController {
  constructor(@Inject(PLATFORM_ORGANIZATION_REPOSITORY) private readonly repo: PlatformOrganizationRepository) {}
  private async execute<T>(call: () => Promise<T>): Promise<T> {
    try { return await call(); }
    catch (error) {
      if (error instanceof PlatformOrganizationError) throw new HttpException({ reasonCode: error.reasonCode }, status[error.reasonCode]);
      throw error;
    }
  }
  @Get(C.operations.listOrganizations.path)
  async list(@Query(new ZodBodyPipe(C.operations.listOrganizations.in)) query: z.infer<typeof C.operations.listOrganizations.in>, @CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const input = C.operations.listOrganizations.in.parse(query);
    return this.execute(async () => C.operations.listOrganizations.out.parse(await this.repo.list(input, principal.userId)));
  }
  @Get(C.operations.getOrganization.path)
  async detail(@Param("orgId") orgId: string, @CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    return this.execute(async () => C.operations.getOrganization.out.parse(await this.repo.detail(toOrgId(orgId), principal.userId)));
  }
  @Patch(C.operations.setPlan.path)
  async setPlan(@Param("orgId") orgId: string, @Body(new ZodBodyPipe(SET_ORGANIZATION_PLAN_SCHEMA)) input: z.infer<typeof C.operations.setPlan.in>, @CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    return this.execute(async () => C.operations.setPlan.out.parse(await this.repo.setPlan(toOrgId(orgId), input, principal.userId)));
  }
}
