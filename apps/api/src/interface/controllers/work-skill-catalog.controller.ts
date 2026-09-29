/**
 * Phase 20 WS03 —— Work Skill 目录 HTTP 面（契约 `work-skill-meta` operations：
 * listWorkSkillCatalog / getWorkSkillCatalogEntry / updateWorkSkillCatalogEntry）。
 *
 * ⚠ id 形状偏差（已知、待契约收敛）：契约 `Id = z.string().uuid()`，而本仓 skill / version id 形如
 *   `skill-<uuid>` / `skill-version-<uuid>`（WS02 导入即如此）。这里的请求 schema 由契约 schema **派生**，
 *   只把 id 字段替换成非空文本；响应不以契约 Id 校验，其余字段形状与契约一致。
 * 错误体单源 = 契约 `WorkSkillErrorBody`（经 AllExceptionsFilter 的 workSkillError 透出）。
 */
import { createHash } from "node:crypto";
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import { z } from "zod";
import {
  ListWorkSkillCatalog,
  UpdateWorkSkillCatalogEntry,
  WorkSkillErrorBody,
} from "@repo/contracts/work-skill-meta";
import { WorkEvalErrorBody } from "@repo/contracts/work-eval";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import {
  getWorkSkillCatalogEntry,
  listWorkSkillCatalog,
  updateWorkSkillCatalogEntry,
  WORK_SKILL_CATALOG_REPOSITORY,
  WorkSkillCatalogAdminRequiredError,
  WorkSkillCatalogIdempotencyConflictError,
  WorkSkillCatalogNotFoundError,
  WorkSkillChannelTransitionInvalidError,
  WorkSkillSuccessorInvalidError,
  WorkSkillG5NotPassedError,
  type WorkSkillCatalogRepository,
} from "../../application/skill/work-skill-catalog";
import {
  getWorkSkillReadiness,
  TOOL_GRANT_READER,
  type ToolGrantReader,
} from "../../application/skill/work-skill-readiness";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

const TextId = z.string().min(1).max(255);

const UpdateBody = UpdateWorkSkillCatalogEntry.innerType()
  .omit({ skillId: true })
  .extend({ successorSkillId: TextId.nullable().optional() })
  .strict()
  .refine((v) => v.channel !== undefined || v.successorSkillId !== undefined, { message: "nothing to update" });

const ListQuery = ListWorkSkillCatalog.extend({
  includeDeprecated: z.enum(["true", "false"]).transform((v) => v === "true").default("false"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ⚠ 已知局限（WS03 review，本波接受）：游标是 base64 的 offset，不是 keyset。翻页之间有插入/弃用时
//   可能重复或漏项；且除编码外并不不透明。收敛方向：按 (stable_id, skill_id) 的 keyset 游标。
function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`).toString("base64url");
}

function decodeCursor(cursor: string | undefined): number | null {
  if (cursor === undefined) return 0;
  const match = /^o:(\d{1,6})$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  return match ? Number(match[1]) : null;
}

function workSkillError(
  Exception: new (body: unknown) => HttpException,
  body: z.input<typeof WorkSkillErrorBody>,
): HttpException {
  return new Exception({ workSkillError: WorkSkillErrorBody.parse(body) });
}

const validationFailed = (message: string) =>
  workSkillError(UnprocessableEntityException, { code: "VALIDATION_FAILED", message });

function mapError(error: unknown): never {
  if (error instanceof WorkSkillCatalogNotFoundError) {
    throw workSkillError(NotFoundException, { code: "WORK_SKILL_NOT_FOUND", message: "work skill not found" });
  }
  if (error instanceof WorkSkillCatalogAdminRequiredError) {
    throw workSkillError(ForbiddenException, { code: "WORK_SKILL_ADMIN_REQUIRED", message: "organization admin required" });
  }
  if (error instanceof WorkSkillChannelTransitionInvalidError) {
    throw workSkillError(ConflictException, {
      code: "WORK_SKILL_CHANNEL_TRANSITION_INVALID", message: error.reason, allowedTransitions: [...error.allowed],
    });
  }
  if (error instanceof WorkSkillG5NotPassedError) {
    // EV05 / UC-7：契约 work-eval `WorkEvalErrorBody`（code 登记于 updateWorkSkillCatalogEntryGateCheck.err）。
    throw new ConflictException({
      workEvalError: WorkEvalErrorBody.parse({ code: "WORK_EVAL_G5_NOT_PASSED", message: "G5 has not passed for the current version" }),
    });
  }
  if (error instanceof WorkSkillSuccessorInvalidError) {
    throw workSkillError(UnprocessableEntityException, { code: "WORK_SKILL_SUCCESSOR_INVALID", message: error.reason });
  }
  if (error instanceof WorkSkillCatalogIdempotencyConflictError) {
    throw workSkillError(ConflictException, {
      code: "WORK_SKILL_IDEMPOTENCY_CONFLICT", message: "idempotency key was used for a different request",
    });
  }
  throw error;
}

@Controller()
export class WorkSkillCatalogController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(WORK_SKILL_CATALOG_REPOSITORY) private readonly catalog: WorkSkillCatalogRepository,
    @Inject(TOOL_GRANT_READER) private readonly grants: ToolGrantReader,
  ) {}

  private get deps() {
    return { identities: this.identities, catalog: this.catalog };
  }

  @Get("/skills/catalog")
  async list(@CurrentPrincipal() principal: Principal, @Query() raw: Record<string, unknown>) {
    assertPrincipal(principal);
    const parsed = ListQuery.safeParse(raw);
    if (!parsed.success) throw validationFailed("invalid catalog query");
    const offset = decodeCursor(parsed.data.cursor);
    if (offset === null) throw validationFailed("invalid cursor");
    try {
      const { domain, channel, q, includeDeprecated, limit } = parsed.data;
      const page = await listWorkSkillCatalog(this.deps, {
        actorId: principal.userId,
        orgId: principal.orgId,
        query: {
          ...(domain !== undefined ? { domain } : {}),
          ...(channel !== undefined ? { channel } : {}),
          ...(q ? { q } : {}),
          includeDeprecated: includeDeprecated || channel === "deprecated",
          offset,
          limit,
        },
      });
      return { items: page.items, nextCursor: page.nextOffset === null ? null : encodeCursor(page.nextOffset) };
    } catch (error) {
      return mapError(error);
    }
  }

  // WS04（UC-6）：就绪性实时计算；授权查询失败 → 200 + overall=unknown（E5），不是 5xx。
  @Get("/skills/catalog/:skillId/readiness")
  async readiness(
    @CurrentPrincipal() principal: Principal,
    @Param("skillId") skillId: string,
    @Query("versionId") versionId: string | undefined,
  ) {
    assertPrincipal(principal);
    if (!TextId.safeParse(skillId).success || (versionId !== undefined && !TextId.safeParse(versionId).success)) {
      throw validationFailed("invalid id");
    }
    try {
      return await getWorkSkillReadiness({ ...this.deps, grants: this.grants }, {
        actorId: principal.userId, orgId: principal.orgId, skillId, ...(versionId !== undefined ? { versionId } : {}),
      });
    } catch (error) {
      return mapError(error);
    }
  }

  @Get("/skills/catalog/:skillId")
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param("skillId") skillId: string,
    @Query("versionId") versionId: string | undefined,
  ) {
    assertPrincipal(principal);
    if (!TextId.safeParse(skillId).success || (versionId !== undefined && !TextId.safeParse(versionId).success)) {
      throw validationFailed("invalid id");
    }
    try {
      return await getWorkSkillCatalogEntry(this.deps, {
        actorId: principal.userId, orgId: principal.orgId, skillId, ...(versionId !== undefined ? { versionId } : {}),
      });
    } catch (error) {
      return mapError(error);
    }
  }

  @Patch("/admin/skills/catalog/:skillId")
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param("skillId") skillId: string,
    @Body() raw: unknown,
  ) {
    assertPrincipal(principal);
    const parsed = UpdateBody.safeParse(raw);
    if (!TextId.safeParse(skillId).success || !parsed.success) throw validationFailed("invalid catalog update");
    const { idempotencyKey, ...change } = parsed.data;
    const requestDigest = createHash("sha256")
      .update(JSON.stringify([skillId, change.expectedChannel, change.channel ?? null,
        change.successorSkillId === undefined ? "<unchanged>" : change.successorSkillId, change.gateEvidenceRef ?? null]))
      .digest("hex");
    try {
      const { item } = await updateWorkSkillCatalogEntry(this.deps, {
        actorId: principal.userId,
        orgId: principal.orgId,
        skillId,
        idempotencyKey,
        requestDigest,
        change: {
          expectedChannel: change.expectedChannel,
          ...(change.channel !== undefined ? { channel: change.channel } : {}),
          ...(change.successorSkillId !== undefined ? { successorSkillId: change.successorSkillId } : {}),
          ...(change.gateEvidenceRef !== undefined ? { gateEvidenceRef: change.gateEvidenceRef } : {}),
        },
      });
      return item;
    } catch (error) {
      return mapError(error);
    }
  }
}

