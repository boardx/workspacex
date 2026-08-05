import { Body, ConflictException, Controller, ForbiddenException, HttpStatus, Inject, NotFoundException, Post, Res, UnprocessableEntityException } from "@nestjs/common";
import type { Response } from "express";
import { wave2Runtime as C } from "@repo/contracts";
import { importAgentStarterPack, AgentStarterImportAdminRequiredError, AgentStarterImportIdempotencyConflictError, AgentStarterPackConflictError, AgentStarterPackInvalidError, AgentStarterPackNotFoundError, AgentStarterSkillVersionMismatchError, AgentStarterSkillVersionMissingError } from "../../application/agent-import/import-agent-starter-pack";
import { AGENT_STARTER_IMPORT_REPOSITORY, AGENT_STARTER_PACK_SOURCE, type AgentStarterImportRepository, type AgentStarterPackSource } from "../../application/agent-import/ports";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

@Controller()
export class AgentStarterImportController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(AGENT_STARTER_PACK_SOURCE) private readonly packs: AgentStarterPackSource,
    @Inject(AGENT_STARTER_IMPORT_REPOSITORY) private readonly imports: AgentStarterImportRepository,
  ) {}
  @Post("/admin/agents/starter-pack-imports")
  async import(@CurrentPrincipal() principal: Principal, @Body(new ZodBodyPipe(C.operations.importAgentStarterPack.in)) body: { packId: string; packVersion: string; idempotencyKey: string }, @Res({ passthrough: true }) response: Response) {
    assertPrincipal(principal);
    try {
      const imported = await importAgentStarterPack({ identities: this.identities, packs: this.packs, imports: this.imports }, { actorId: principal.userId, orgId: principal.orgId, ...body });
      response.status(imported.created ? HttpStatus.CREATED : HttpStatus.OK);
      return C.operations.importAgentStarterPack.out.parse(imported.result);
    } catch (error) {
      if (error instanceof AgentStarterImportAdminRequiredError) throw new ForbiddenException({ reasonCode: "AGENT_STARTER_IMPORT_ADMIN_REQUIRED" });
      if (error instanceof AgentStarterPackNotFoundError) throw new NotFoundException({ reasonCode: "AGENT_STARTER_PACK_NOT_FOUND" });
      if (error instanceof AgentStarterPackInvalidError) throw new UnprocessableEntityException({ reasonCode: "AGENT_STARTER_PACK_INVALID" });
      if (error instanceof AgentStarterSkillVersionMissingError) throw new UnprocessableEntityException({ reasonCode: "AGENT_STARTER_SKILL_VERSION_MISSING" });
      if (error instanceof AgentStarterSkillVersionMismatchError) throw new UnprocessableEntityException({ reasonCode: "AGENT_STARTER_SKILL_VERSION_MISMATCH" });
      if (error instanceof AgentStarterPackConflictError) throw new ConflictException({ reasonCode: "AGENT_STARTER_PACK_CONFLICT" });
      if (error instanceof AgentStarterImportIdempotencyConflictError) throw new ConflictException({ reasonCode: "AGENT_STARTER_IMPORT_IDEMPOTENCY_CONFLICT" });
      throw error;
    }
  }
}
