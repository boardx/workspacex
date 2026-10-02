import { Body, ConflictException, Controller, ForbiddenException, Inject, Post } from "@nestjs/common";
import { agentRole } from "@repo/contracts";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { OFFICIAL_ROLE_UPGRADE_REPOSITORY, OfficialRoleUpgradeAdminRequiredError, OfficialRoleUpgradeConflictError, upgradeOfficialRoles, type OfficialRoleUpgradeInput, type OfficialRoleUpgradeRepository } from "../../application/agent-import/upgrade-official-roles";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

@Controller()
export class OfficialRoleUpgradeController {
  constructor(@Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(OFFICIAL_ROLE_UPGRADE_REPOSITORY) private readonly upgrades: OfficialRoleUpgradeRepository) {}
  @Post(agentRole.operations.upgradeOfficialRoles.path)
  async upgrade(@CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(agentRole.operations.upgradeOfficialRoles.in)) body: OfficialRoleUpgradeInput) {
    assertPrincipal(principal);
    try {
      return agentRole.OfficialRoleUpgradeResult.parse(await upgradeOfficialRoles({ identities: this.identities, upgrades: this.upgrades }, { ...body, orgId: principal.orgId, actorId: principal.userId }));
    } catch (error) {
      if (error instanceof OfficialRoleUpgradeAdminRequiredError) throw new ForbiddenException({ reasonCode: "AGENT_STARTER_IMPORT_ADMIN_REQUIRED" });
      if (error instanceof OfficialRoleUpgradeConflictError) throw new ConflictException({ reasonCode: "OFFICIAL_ROLE_UPGRADE_CONFLICT" });
      throw error;
    }
  }
}
