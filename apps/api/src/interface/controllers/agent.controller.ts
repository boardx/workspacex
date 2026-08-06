/**
 * `POST /agents` -- 契约 `agentRuntime.operations.createAgent`（#617）。
 *
 * 独立文件，只挂 `createAgent` 这一条操作——`updateAgentDefinition` 同样零挂载
 * 但不在本次范围内（#617 任务说明），不在这里顺手接上，避免把两条不同的写路径
 * 混进一次审查。
 *
 * `AgentController` 与 `AgentTrialRunController` 都是 `@Controller()`（空前缀）、
 * 都落在裸的 `/agents` 前缀下，但方法不同（`POST /agents` vs
 * `POST /agents/:agentId/trial-run`）——Nest 按路径+方法整体匹配，两个控制器
 * 共存不冲突，与 `agent-trial-run.controller.ts` 文件头的独立文件理由相同。
 */
import { Body, Controller, ForbiddenException, HttpStatus, Inject, NotFoundException, Post, Res, UnprocessableEntityException } from "@nestjs/common";
import type { Response } from "express";
import { agentRuntime as C } from "@repo/contracts";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import {
  createAgent,
  CreateAgentError,
  CREATE_AGENT_REPOSITORY,
  type CreateAgentRepository,
} from "../../application/agent/create-agent";

type CreateAgentBody = ReturnType<typeof C.operations.createAgent.in.parse>;

const ERROR_STATUS: Record<string, HttpStatus> = {
  ROLE_INSUFFICIENT: HttpStatus.FORBIDDEN,
  AGENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  AGENT_MARKET_NOT_AVAILABLE: HttpStatus.UNPROCESSABLE_ENTITY,
};

@Controller()
export class AgentController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(CREATE_AGENT_REPOSITORY) private readonly repository: CreateAgentRepository,
  ) {}

  @Post(C.operations.createAgent.path)
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(C.operations.createAgent.in)) body: CreateAgentBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPrincipal(principal);
    try {
      const definition = await createAgent(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          name: body.name,
          initials: body.initials,
          role: body.role,
          visibility: body.visibility,
          cloneFrom: body.cloneFrom,
          source: body.source,
        },
        { identities: this.identities, repository: this.repository },
      );
      response.status(HttpStatus.CREATED);
      return C.operations.createAgent.out.parse({
        agentId: definition.agentId,
        publishState: definition.publishState,
        // ⚠ I-30：不是「碰巧是空数组」——`definition.toolWhitelist` 本身就是
        // `domain/agent/clone.ts` / `definition.ts` 保证恒为 `[]` 的那一个字段，
        // 这里原样透传，不是重新赋一次 `[]`（那样会看起来像是这一层的决定）。
        toolWhitelist: definition.toolWhitelist,
        cloneFrom: definition.cloneFrom,
      });
    } catch (error) {
      if (error instanceof CreateAgentError) {
        const status = ERROR_STATUS[error.code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
        if (status === HttpStatus.FORBIDDEN) throw new ForbiddenException({ reasonCode: error.code });
        if (status === HttpStatus.NOT_FOUND) throw new NotFoundException({ reasonCode: error.code });
        throw new UnprocessableEntityException({ reasonCode: error.code });
      }
      throw error;
    }
  }
}
