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
import { WorkSkillErrorBody } from "@repo/contracts/work-skill-meta";
import {
  importSkillStarterPack,
  SkillStarterImportAdminRequiredError,
  SkillStarterImportIdempotencyConflictError,
  SkillStarterPackConflictError,
  SkillStarterPackInvalidError,
  SkillStarterPackNotFoundError,
  WorkSkillImportRejectedError,
  WorkSkillStableIdConflictError,
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

/** 固定文案（不回显异常 message）；逐字段定位在 `issues[]` 里。 */
const WORK_SKILL_IMPORT_MESSAGES: Readonly<Record<WorkSkillImportRejectedError["code"], string>> = {
  WORK_SKILL_MANIFEST_INVALID: "metadata.work is invalid",
  WORK_SKILL_CAPABILITY_UNREGISTERED: "metadata.work depends on an unregistered capability category",
  WORK_SKILL_PROVENANCE_LICENSE_MISSING: "metadata.work provenance is missing a license or notice",
};

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
      // WS02：错误体形状单源 = 契约 `WorkSkillErrorBody`（work-skill-meta.ts）。
      if (error instanceof WorkSkillImportRejectedError) {
        throw new UnprocessableEntityException({
          workSkillError: WorkSkillErrorBody.parse({ code: error.code, message: WORK_SKILL_IMPORT_MESSAGES[error.code], issues: error.issues }),
        });
      }
      if (error instanceof WorkSkillStableIdConflictError) {
        // conflictingSkillId 不回传：契约要求 uuid，而现存 skill id 形如 `skill-<uuid>`（WS03 统一 id 形状时再补）。
        throw new ConflictException({
          workSkillError: WorkSkillErrorBody.parse({ code: "WORK_SKILL_STABLE_ID_CONFLICT", message: "stableId already belongs to another skill in this organization" }),
        });
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
