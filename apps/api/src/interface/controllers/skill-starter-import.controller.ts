import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Res,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Response } from "express";
import { wave2Runtime as C } from "@repo/contracts";
import {
  importSkillStarterPack,
  SkillStarterImportAdminRequiredError,
  SkillStarterImportIdempotencyConflictError,
  SkillStarterPackConflictError,
  SkillStarterPackInvalidError,
  SkillStarterPackNotFoundError,
} from "../../application/skill-import/import-skill-starter-pack";
import {
  SKILL_STARTER_IMPORT_REPOSITORY,
  SKILL_STARTER_PACK_SOURCE,
  type SkillStarterImportRepository,
  type SkillStarterPackSource,
} from "../../application/skill-import/ports";
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from "../../application/identity/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

type ImportBody = {
  readonly packId: string;
  readonly packVersion: string;
  readonly idempotencyKey: string;
};

@Controller()
export class SkillStarterImportController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(SKILL_STARTER_PACK_SOURCE) private readonly packs: SkillStarterPackSource,
    @Inject(SKILL_STARTER_IMPORT_REPOSITORY) private readonly imports: SkillStarterImportRepository,
  ) {}

  @Post("/admin/skills/starter-pack-imports")
  async import(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(C.operations.importSkillStarterPack.in)) body: ImportBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPrincipal(principal);
    try {
      const imported = await importSkillStarterPack(
        { identities: this.identities, packs: this.packs, imports: this.imports },
        { actorId: principal.userId, orgId: principal.orgId, ...body },
      );
      response.status(imported.created ? HttpStatus.CREATED : HttpStatus.OK);
      return C.operations.importSkillStarterPack.out.parse(imported.result);
    } catch (error) {
      if (error instanceof SkillStarterImportAdminRequiredError) {
        throw new ForbiddenException({ reasonCode: "SKILL_STARTER_IMPORT_ADMIN_REQUIRED" });
      }
      if (error instanceof SkillStarterPackNotFoundError) {
        throw new NotFoundException({ reasonCode: "SKILL_STARTER_PACK_NOT_FOUND" });
      }
      if (error instanceof SkillStarterPackInvalidError) {
        throw new UnprocessableEntityException({ reasonCode: "SKILL_STARTER_PACK_INVALID" });
      }
      if (error instanceof SkillStarterPackConflictError) {
        throw new ConflictException({ reasonCode: "SKILL_STARTER_PACK_CONFLICT" });
      }
      if (error instanceof SkillStarterImportIdempotencyConflictError) {
        throw new ConflictException({ reasonCode: "SKILL_STARTER_IMPORT_IDEMPOTENCY_CONFLICT" });
      }
      throw error;
    }
  }
}
