/**
 * AG01 —— `PATCH /admin/agents/:agentId/role`（契约 `agentRole.operations.updateAgentRoleDraft`，
 * 契约束 agent-role UC-1）。独立文件：agent-role 契约束的路由与 agent-runtime 的
 * `agent.controller.ts` 分属两份契约，错误码表也不同（多了 409 / 官方锁）。
 */
import {
  Body, ConflictException, Controller, ForbiddenException, Inject, NotFoundException, Param, Patch,
  UnprocessableEntityException,
} from "@nestjs/common";
import { agentRole as R } from "@repo/contracts";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import {
  AGENT_ROLE_DRAFT_REPOSITORY,
  updateAgentRoleDraft,
  UpdateAgentRoleDraftError,
  type AgentRoleDraftRepository,
  type UpdateAgentRoleDraftErrorCode,
} from "../../application/agent/update-agent-role-draft";

type UpdateRoleBody = ReturnType<typeof R.operations.updateAgentRoleDraft.in.parse>;

function toHttp(code: UpdateAgentRoleDraftErrorCode) {
  switch (code) {
    case "ROLE_INSUFFICIENT":
    case "OFFICIAL_ROLE_FIELDS_LOCKED":
      return new ForbiddenException({ reasonCode: code });
    case "AGENT_NOT_FOUND":
      return new NotFoundException({ reasonCode: code });
    case "VERSION_CHANGED":
      return new ConflictException({ reasonCode: code });
    case "VALIDATION_FAILED":
      return new UnprocessableEntityException({ reasonCode: code });
  }
}

@Controller()
export class AgentRoleController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(AGENT_ROLE_DRAFT_REPOSITORY) private readonly repository: AgentRoleDraftRepository,
  ) {}

  @Patch(R.operations.updateAgentRoleDraft.path)
  async updateRoleDraft(
    @CurrentPrincipal() principal: Principal,
    @Param("agentId") agentId: string,
    @Body(new ZodBodyPipe(R.operations.updateAgentRoleDraft.in)) body: UpdateRoleBody,
  ) {
    assertPrincipal(principal);
    if (body.agentId !== agentId) throw new NotFoundException({ reasonCode: "AGENT_NOT_FOUND" });
    try {
      const view = await updateAgentRoleDraft(
        {
          orgId: principal.orgId, actorId: principal.userId, agentId,
          expectedVersion: body.expectedVersion, patch: body.patch,
        },
        { identities: this.identities, repository: this.repository },
      );
      return R.operations.updateAgentRoleDraft.out.parse(view);
    } catch (error) {
      if (error instanceof UpdateAgentRoleDraftError) throw toHttp(error.code);
      throw error;
    }
  }
}
