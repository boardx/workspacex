/**
 * #1415 —— agent 版的 `skill-url-import.controller.ts`。HTTP 边界只做三件事：
 * 解析请求、把用例层错误码翻成状态码、把取回层的 SSRF 拒绝原样透出——**不**重新声明
 * 任何字段名或判定逻辑，那些都在 `import-agent-from-url.ts` 里（见其头注）。
 *
 * `localOnlyOrg` 的推导与 `SkillUrlImportController` 逐字同一条纪律：**逐请求**由
 * 该组织的 `kind` 推出，不是恒定值——参见那个文件头注对「传错的后果不对称」的说明。
 */
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpStatus,
  Inject,
  Post,
  Res,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Response } from "express";
import { wave2Runtime as C } from "@repo/contracts";
import {
  importAgentFromUrl,
  ImportAgentFromUrlError,
  IMPORT_AGENT_FROM_URL_DEPS_FACTORY,
  type ImportAgentFromUrlDepsFactory,
} from "../../application/agent-import/import-agent-from-url";
import { ImportSourceRefusedError } from "../../domain/skill/import-source";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { isLocalOrg } from "../../domain/identity/local-org";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

type ImportBody = ReturnType<typeof C.operations.importAgentFromUrl.in.parse>;

/** 用例层拒绝码 → HTTP 状态。与 `SkillUrlImportController` 的 `USE_CASE_STATUS` 同一形状。 */
const USE_CASE_STATUS: Record<string, number> = {
  IMPORT_NOT_ORG_ADMIN: HttpStatus.FORBIDDEN,
  IMPORT_CONTENT_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  IMPORT_NAME_CONFLICT: HttpStatus.CONFLICT,
  IMPORT_IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
};

@Controller()
export class AgentUrlImportController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(IMPORT_AGENT_FROM_URL_DEPS_FACTORY)
    private readonly composeDeps: ImportAgentFromUrlDepsFactory,
  ) {}

  @Post("/admin/agents/url-imports")
  async import(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(C.operations.importAgentFromUrl.in)) body: ImportBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPrincipal(principal);

    const orgId = toOrgId(principal.orgId);
    const organization = await this.identities.findOrganization(orgId);
    // 组织查不到时拒绝，不是当成普通组织继续——同 `SkillUrlImportController` 逐字同一条理由。
    if (organization === null) {
      throw new ForbiddenException({ reasonCode: "IMPORT_NOT_ORG_ADMIN" });
    }

    const deps = this.composeDeps({ localOnlyOrg: isLocalOrg(organization.kind) });

    try {
      const result = await importAgentFromUrl(
        { orgId: principal.orgId, actorId: principal.userId, ...body },
        deps,
      );
      response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
      return C.operations.importAgentFromUrl.out.parse(result);
    } catch (error) {
      if (error instanceof ImportAgentFromUrlError) {
        const status = USE_CASE_STATUS[error.code];
        if (status === HttpStatus.FORBIDDEN) throw new ForbiddenException({ reasonCode: error.code });
        if (status === HttpStatus.CONFLICT) throw new ConflictException({ reasonCode: error.code });
        throw new UnprocessableEntityException({ reasonCode: error.code });
      }
      if (error instanceof ImportSourceRefusedError) {
        if (error.code === "IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG") {
          throw new ForbiddenException({ reasonCode: error.code });
        }
        throw new UnprocessableEntityException({ reasonCode: error.code });
      }
      throw error;
    }
  }
}
