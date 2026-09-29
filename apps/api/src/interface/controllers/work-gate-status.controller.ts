/**
 * Phase 20 EV04 —— 门状态回写 / 读取 HTTP 面（契约 `work-eval` operations
 * writeBackWorkGateStatus / getWorkGateStatus）。错误体单源 = 契约 `WorkEvalErrorBody`
 * （经 AllExceptionsFilter 的 workEvalError 透出）。
 *
 * ⚠ id 形状偏差同 work-skill-catalog.controller：请求 schema 由契约派生，只把 skillId 换成非空文本。
 * 平台运营判定复用 `isPlatformOperator`（超管白名单 || platform_admins），不另拼一份。
 */
import { createHash } from "node:crypto";
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import { z } from "zod";
import { WorkEvalErrorBody, WriteBackWorkGateStatus } from "@repo/contracts/work-eval";
import { CREDENTIAL_REPOSITORY, type CredentialRepository } from "../../application/auth/ports";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { PLATFORM_ADMIN_REPOSITORY, type PlatformAdminRepository } from "../../application/system/platform-admin-ports";
import {
  getWorkGateStatus,
  WORK_GATE_STATUS_REPOSITORY,
  WorkGateDigestMismatchError,
  WorkGateIdempotencyConflictError,
  WorkGatePlatformAdminRequiredError,
  WorkGateSkillNotFoundError,
  WorkGateStableIdMismatchError,
  writeBackWorkGateStatus,
  type WorkGateStatusRepository,
} from "../../application/work-eval/work-gate-status";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { isPlatformOperator } from "../../domain/system/platform-admin";
import { isPlatformSuperuserEmail, platformSuperuserWhitelistFromEnv } from "../../domain/system/platform-superuser";
import { CurrentPrincipal } from "../current-principal.decorator";

const TextId = z.string().min(1).max(255);
const WriteBody = WriteBackWorkGateStatus.omit({ skillId: true }).strict();

function workEvalError(
  Exception: new (body: unknown) => HttpException,
  body: z.input<typeof WorkEvalErrorBody>,
): HttpException {
  return new Exception({ workEvalError: WorkEvalErrorBody.parse(body) });
}

const validationFailed = (message: string) =>
  workEvalError(UnprocessableEntityException, { code: "VALIDATION_FAILED", message });

function mapError(error: unknown): never {
  if (error instanceof WorkGateSkillNotFoundError) {
    throw workEvalError(NotFoundException, { code: "WORK_SKILL_NOT_FOUND", message: "work skill not found" });
  }
  if (error instanceof WorkGatePlatformAdminRequiredError) {
    throw workEvalError(ForbiddenException, { code: "WORK_EVAL_PLATFORM_ADMIN_REQUIRED", message: "platform operator required" });
  }
  if (error instanceof WorkGateDigestMismatchError) {
    throw workEvalError(ConflictException, { code: "WORK_EVAL_DIGEST_MISMATCH", message: "subjectVersionDigest matches no version of this skill" });
  }
  if (error instanceof WorkGateStableIdMismatchError) {
    throw workEvalError(UnprocessableEntityException, { code: "WORK_EVAL_STABLE_ID_MISMATCH", message: "stableId does not match the catalog entry" });
  }
  if (error instanceof WorkGateIdempotencyConflictError) {
    throw workEvalError(ConflictException, { code: "WORK_EVAL_IDEMPOTENCY_CONFLICT", message: "idempotency key was used for a different request" });
  }
  throw error;
}

@Controller()
export class WorkGateStatusController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(WORK_GATE_STATUS_REPOSITORY) private readonly gateStatus: WorkGateStatusRepository,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(PLATFORM_ADMIN_REPOSITORY) private readonly platformAdmins: PlatformAdminRepository,
  ) {}

  private async operator(userId: string): Promise<boolean> {
    const credential = await this.credentials.findByUserId(userId);
    const superuser = isPlatformSuperuserEmail(credential?.email ?? "", platformSuperuserWhitelistFromEnv(process.env.PLATFORM_SUPERUSER_EMAILS));
    const admin = superuser ? false : await this.platformAdmins.isPlatformAdmin(userId);
    return isPlatformOperator(superuser, admin);
  }

  @Post("/admin/skills/catalog/:skillId/gate-status")
  @HttpCode(200)
  async writeBack(@CurrentPrincipal() principal: Principal, @Param("skillId") skillId: string, @Body() raw: unknown) {
    assertPrincipal(principal);
    // 鉴权先于校验与任何仓储调用（E9）。
    const isOperator = await this.operator(principal.userId);
    if (!isOperator) return mapError(new WorkGatePlatformAdminRequiredError());
    const parsed = WriteBody.safeParse(raw);
    if (!TextId.safeParse(skillId).success || !parsed.success) throw validationFailed("invalid gate status");
    const requestDigest = createHash("sha256").update(JSON.stringify([skillId, parsed.data.status])).digest("hex");
    try {
      return await writeBackWorkGateStatus({ identities: this.identities, gateStatus: this.gateStatus }, {
        actorId: principal.userId,
        orgId: principal.orgId,
        isPlatformOperator: isOperator,
        skillId,
        status: parsed.data.status,
        idempotencyKey: parsed.data.idempotencyKey,
        requestDigest,
      });
    } catch (error) {
      return mapError(error);
    }
  }

  @Get("/skills/catalog/:skillId/gate-status")
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
      return await getWorkGateStatus({ identities: this.identities, gateStatus: this.gateStatus }, {
        actorId: principal.userId,
        orgId: principal.orgId,
        isPlatformOperator: await this.operator(principal.userId),
        skillId,
        ...(versionId !== undefined ? { versionId } : {}),
      });
    } catch (error) {
      return mapError(error);
    }
  }
}
