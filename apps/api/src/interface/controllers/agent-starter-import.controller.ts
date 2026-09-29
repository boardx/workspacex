import { Body, ConflictException, Controller, ForbiddenException, HttpStatus, Inject, NotFoundException, Post, Res, UnprocessableEntityException } from "@nestjs/common";
import type { Response } from "express";
import { agentRole as R, wave2Runtime as C } from "@repo/contracts";
import { importAgentStarterPack, AgentStarterImportAdminRequiredError, AgentStarterImportIdempotencyConflictError, AgentStarterPackConflictError, AgentStarterPackInvalidError, AgentStarterPackNotFoundError, AgentStarterSkillVersionMismatchError, AgentStarterSkillVersionMissingError, AgentStarterToolPolicyInvalidError } from "../../application/agent-import/import-agent-starter-pack";
import { importOfficialAgentRolePack, OfficialAgentRolePackAdminRequiredError, OfficialAgentRolePackConflictError, OfficialAgentRoleWorkflowRefUnresolvedError, OfficialAgentRolePackIdempotencyConflictError, OfficialAgentRolePackInvalidError, OfficialAgentRolePackNotFoundError, OfficialAgentRoleSkillRefUnresolvedError, OfficialAgentRoleToolPolicyInvalidError } from "../../application/agent-import/import-official-agent-role-pack";
import { AGENT_STARTER_IMPORT_REPOSITORY, AGENT_STARTER_PACK_SOURCE, OFFICIAL_AGENT_ROLE_PACK_IMPORT_REPOSITORY, WORKFLOW_DEFINITION_STORE, type AgentStarterImportRepository, type AgentStarterPackSource, type OfficialAgentRolePackImportRepository, type WorkflowDefinitionStore } from "../../application/agent-import/ports";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { isOfficialAgentStarterPackShape } from "../../domain/agent/starter-pack";
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
    @Inject(WORKFLOW_DEFINITION_STORE) private readonly workflows: WorkflowDefinitionStore,
    @Inject(OFFICIAL_AGENT_ROLE_PACK_IMPORT_REPOSITORY) private readonly officialImports: OfficialAgentRolePackImportRepository,
  ) {}
  @Post("/admin/agents/starter-pack-imports")
  async import(@CurrentPrincipal() principal: Principal, @Body(new ZodBodyPipe(C.operations.importAgentStarterPack.in)) body: { packId: string; packVersion: string; idempotencyKey: string }, @Res({ passthrough: true }) response: Response) {
    assertPrincipal(principal);
    // UC-3：同一端点按 pack 内容形状分流——entries 带 roleRef 即官方角色包，走独立的
    // 校验/落库路径（角色字段 + workflowAllowlist 引用解析）；否则沿用既有 org 包路径（AG02）。
    // 不存在的 packId/packVersion 在两条路径各自的用例里都会正确落到 NOT_FOUND，peek 失败不提前分流。
    const peeked = await this.packs.load(body.packId, body.packVersion);
    if (peeked !== null && isOfficialAgentStarterPackShape(peeked)) {
      return this.importOfficial(principal, body, response);
    }
    try {
      const imported = await importAgentStarterPack({ identities: this.identities, packs: this.packs, imports: this.imports }, { actorId: principal.userId, orgId: principal.orgId, ...body });
      response.status(imported.created ? HttpStatus.CREATED : HttpStatus.OK);
      return C.operations.importAgentStarterPack.out.parse(imported.result);
    } catch (error) {
      if (error instanceof AgentStarterImportAdminRequiredError) throw new ForbiddenException({ reasonCode: "AGENT_STARTER_IMPORT_ADMIN_REQUIRED" });
      if (error instanceof AgentStarterPackNotFoundError) throw new NotFoundException({ reasonCode: "AGENT_STARTER_PACK_NOT_FOUND" });
      if (error instanceof AgentStarterToolPolicyInvalidError) {
        const code = R.AgentRoleImportError.enum.AGENT_STARTER_TOOL_POLICY_INVALID;
        throw new UnprocessableEntityException(error.violation
          ? { reasonCode: code, detail: R.AgentRoleImportFailureDetail.parse({ code, ...error.violation }) }
          : { reasonCode: code });
      }
      if (error instanceof AgentStarterPackInvalidError) throw new UnprocessableEntityException({ reasonCode: "AGENT_STARTER_PACK_INVALID" });
      if (error instanceof AgentStarterSkillVersionMissingError) throw new UnprocessableEntityException({ reasonCode: "AGENT_STARTER_SKILL_VERSION_MISSING" });
      if (error instanceof AgentStarterSkillVersionMismatchError) throw new UnprocessableEntityException({ reasonCode: "AGENT_STARTER_SKILL_VERSION_MISMATCH" });
      if (error instanceof AgentStarterPackConflictError) throw new ConflictException({ reasonCode: "AGENT_STARTER_PACK_CONFLICT" });
      if (error instanceof AgentStarterImportIdempotencyConflictError) throw new ConflictException({ reasonCode: "AGENT_STARTER_IMPORT_IDEMPOTENCY_CONFLICT" });
      throw error;
    }
  }

  private async importOfficial(principal: Principal, body: { packId: string; packVersion: string; idempotencyKey: string }, response: Response) {
    try {
      const imported = await importOfficialAgentRolePack({ identities: this.identities, packs: this.packs, workflows: this.workflows, imports: this.officialImports }, { actorId: principal.userId, orgId: principal.orgId, ...body });
      response.status(imported.created ? HttpStatus.CREATED : HttpStatus.OK);
      return C.operations.importAgentStarterPack.out.parse(imported.result);
    } catch (error) {
      if (error instanceof OfficialAgentRolePackAdminRequiredError) throw new ForbiddenException({ reasonCode: "AGENT_STARTER_IMPORT_ADMIN_REQUIRED" });
      if (error instanceof OfficialAgentRolePackNotFoundError) throw new NotFoundException({ reasonCode: "AGENT_STARTER_PACK_NOT_FOUND" });
      if (error instanceof OfficialAgentRoleToolPolicyInvalidError) {
        const code = R.AgentRoleImportError.enum.AGENT_STARTER_TOOL_POLICY_INVALID;
        throw new UnprocessableEntityException(error.violation
          ? { reasonCode: code, detail: R.AgentRoleImportFailureDetail.parse({ code, ...error.violation }) }
          : { reasonCode: code });
      }
      // UC-3 E2：`missingIds` 只能借既有 `AgentRoleImportFailureDetail`（`detail` 键）带出响应体——
      // `all-exceptions.filter.ts` 是允许列表，裸的顶层 `missingIds` 字段会被原样丢弃（AG02 先例）。
      if (error instanceof OfficialAgentRoleWorkflowRefUnresolvedError) {
        const code = R.AgentRoleImportError.enum.UNRESOLVED_WORKFLOW_REF;
        throw new UnprocessableEntityException({ reasonCode: code, detail: R.AgentRoleImportFailureDetail.parse({ code, stableName: "", path: "role.workflowAllowlist", missingIds: error.missingIds }) });
      }
      if (error instanceof OfficialAgentRoleSkillRefUnresolvedError) {
        const code = R.AgentRoleImportError.enum.UNRESOLVED_SKILL_REF;
        throw new UnprocessableEntityException({ reasonCode: code, detail: R.AgentRoleImportFailureDetail.parse({ code, stableName: "", path: "skillVersions", missingIds: error.missingIds }) });
      }
      if (error instanceof OfficialAgentRolePackInvalidError) throw new UnprocessableEntityException({ reasonCode: "AGENT_STARTER_PACK_INVALID" });
      if (error instanceof OfficialAgentRolePackConflictError) throw new ConflictException({ reasonCode: "AGENT_STARTER_PACK_CONFLICT" });
      if (error instanceof OfficialAgentRolePackIdempotencyConflictError) throw new ConflictException({ reasonCode: "AGENT_STARTER_IMPORT_IDEMPOTENCY_CONFLICT" });
      throw error;
    }
  }
}
