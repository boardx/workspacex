import { Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Res, UnprocessableEntityException } from "@nestjs/common";
import type { Response } from "express";
import { operations as C } from "@repo/contracts/portable-package";
import { EntityDisplaySource } from "@repo/contracts/entity-localization";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { SKILL_STARTER_IMPORT_REPOSITORY, type SkillStarterImportRepository } from "../../application/skill-import/ports";
import { AGENT_STARTER_IMPORT_REPOSITORY, type AgentStarterImportRepository } from "../../application/agent-import/ports";
import { importSkillStarterPack, SkillStarterImportAdminRequiredError, SkillStarterImportIdempotencyConflictError, SkillStarterPackConflictError, SkillStarterPackNotFoundError, SkillStarterPackVersionLabelReusedError, WorkSkillStableIdConflictError, SkillStarterPackInvalidError, WorkSkillImportRejectedError } from "../../application/skill-import/import-skill-starter-pack";
import { importAgentStarterPack, AgentStarterImportAdminRequiredError, AgentStarterImportIdempotencyConflictError, AgentStarterPackConflictError, AgentStarterPackNotFoundError, AgentStarterPackInvalidError, AgentStarterToolPolicyInvalidError, AgentStarterSkillVersionMissingError, AgentStarterSkillVersionMismatchError } from "../../application/agent-import/import-agent-starter-pack";
import { exportPortablePackage, PORTABLE_EXPORT_REPOSITORY, type PortableExportRepository } from "../../application/localization/portable-export";
import { EntityLocalizationError } from "../../application/localization/entity-localization";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

@Controller()
export class PortablePackageController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(SKILL_STARTER_IMPORT_REPOSITORY) private readonly skills: SkillStarterImportRepository,
    @Inject(AGENT_STARTER_IMPORT_REPOSITORY) private readonly agents: AgentStarterImportRepository,
    @Inject(PORTABLE_EXPORT_REPOSITORY) private readonly exports: PortableExportRepository,
  ) {}
  private async mapped<T>(fn: () => Promise<T>) {
    try { return await fn(); }
    catch (error) {
      if (error instanceof SkillStarterImportAdminRequiredError || error instanceof AgentStarterImportAdminRequiredError ||
        (error instanceof EntityLocalizationError && error.code === "ROLE_INSUFFICIENT")) throw new ForbiddenException({ reasonCode: "ROLE_INSUFFICIENT" });
      if (error instanceof SkillStarterImportIdempotencyConflictError || error instanceof AgentStarterImportIdempotencyConflictError ||
        error instanceof SkillStarterPackConflictError || error instanceof AgentStarterPackConflictError ||
        error instanceof SkillStarterPackVersionLabelReusedError || error instanceof WorkSkillStableIdConflictError) throw new ConflictException({ reasonCode: "IMPORT_NAME_CONFLICT" });
      if (error instanceof SkillStarterPackNotFoundError || error instanceof AgentStarterPackNotFoundError ||
        (error instanceof EntityLocalizationError && error.code === "ENTITY_NOT_FOUND")) throw new NotFoundException({ reasonCode: "ENTITY_NOT_FOUND" });
      if (error instanceof SkillStarterPackInvalidError || error instanceof WorkSkillImportRejectedError ||
        error instanceof AgentStarterPackInvalidError || error instanceof AgentStarterToolPolicyInvalidError ||
        error instanceof AgentStarterSkillVersionMissingError || error instanceof AgentStarterSkillVersionMismatchError) throw new UnprocessableEntityException({ reasonCode: "VALIDATION_FAILED" });
      // Unexpected infrastructure errors must reach the normal error boundary.
      throw error;
    }
  }
  @Post(C.importSkill.path)
  importSkill(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    assertPrincipal(p);
    const parsed = C.importSkill.in.safeParse(body);
    if (!parsed.success) throw new UnprocessableEntityException({ reasonCode: "VALIDATION_FAILED" });
    const { pack, idempotencyKey, expectedOrgId } = parsed.data;
    if (expectedOrgId !== undefined && expectedOrgId !== p.orgId) throw new ForbiddenException();
    return this.mapped(async () => {
      const imported = await importSkillStarterPack({ identities: this.identities, imports: this.skills,
      packs: { load: async () => pack } }, { orgId: p.orgId, actorId: p.userId, packId: pack.packId, packVersion: pack.packVersion,
      idempotencyKey, expectedPackDigest: pack.packDigest });
      response.status(imported.created ? 201 : 200);
      return C.importSkill.out.parse(imported.result);
    });
  }
  @Post(C.importAgent.path)
  importAgent(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    assertPrincipal(p);
    const parsed = C.importAgent.in.safeParse(body);
    if (!parsed.success) throw new UnprocessableEntityException({ reasonCode: "VALIDATION_FAILED" });
    const { pack, idempotencyKey, expectedOrgId } = parsed.data;
    if (expectedOrgId !== undefined && expectedOrgId !== p.orgId) throw new ForbiddenException();
    return this.mapped(async () => {
      const imported = await importAgentStarterPack({ identities: this.identities, imports: this.agents,
      packs: { load: async () => pack } }, { orgId: p.orgId, actorId: p.userId, packId: pack.packId, packVersion: pack.packVersion,
      idempotencyKey, expectedPackDigest: pack.packDigest });
      response.status(imported.created ? 201 : 200);
      return C.importAgent.out.parse(imported.result);
    });
  }
  private export(kind: "skill" | "agent", p: Principal, entityId: string) {
    assertPrincipal(p);
    if (!EntityDisplaySource.shape.entityId.safeParse(entityId).success) throw new UnprocessableEntityException({ reasonCode: "VALIDATION_FAILED" });
    return this.mapped(() => exportPortablePackage({ orgId: p.orgId, actorId: p.userId, kind, entityId }, { identities: this.identities, repository: this.exports }));
  }
  @Get(C.exportSkill.path)
  exportSkill(@CurrentPrincipal() p: Principal, @Param("entityId") id: string) { return this.export("skill", p, id); }
  @Get(C.exportAgent.path)
  exportAgent(@CurrentPrincipal() p: Principal, @Param("entityId") id: string) { return this.export("agent", p, id); }
}
