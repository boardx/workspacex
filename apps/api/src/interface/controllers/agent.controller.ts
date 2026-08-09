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
import { Body, Controller, ForbiddenException, HttpStatus, Inject, NotFoundException, Param, Post, Res, UnprocessableEntityException } from "@nestjs/common";
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
import {
  selfPublishToollessAgent,
  SelfPublishAgentError,
  SELF_PUBLISH_AGENT_REPOSITORY,
  type SelfPublishAgentRepository,
} from "../../application/agent/self-publish-toolless-agent";

type CreateAgentBody = ReturnType<typeof C.operations.createAgent.in.parse>;
type SelfPublishBody = ReturnType<typeof C.operations.selfPublishToollessAgent.in.parse>;

const ERROR_STATUS: Record<string, HttpStatus> = {
  ROLE_INSUFFICIENT: HttpStatus.FORBIDDEN,
  AGENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  AGENT_MARKET_NOT_AVAILABLE: HttpStatus.UNPROCESSABLE_ENTITY,
  /* #660 草案边的三条拒绝——都是 422「请求本身合法但当前状态不允许」。 */
  AGENT_NOT_DRAFT: HttpStatus.UNPROCESSABLE_ENTITY,
  AGENT_NOT_TOOLLESS: HttpStatus.UNPROCESSABLE_ENTITY,
  AGENT_VISIBILITY_UNSUPPORTED: HttpStatus.UNPROCESSABLE_ENTITY,
};

@Controller()
export class AgentController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(CREATE_AGENT_REPOSITORY) private readonly repository: CreateAgentRepository,
    @Inject(SELF_PUBLISH_AGENT_REPOSITORY)
    private readonly selfPublishRepository: SelfPublishAgentRepository,
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
      if (error instanceof CreateAgentError) throw this.toHttp(error.code);
      throw error;
    }
  }

  /**
   * `POST /agents/:agentId/self-publish` —— #660。**⚠⚠ 草案边，尚未经人类签核**
   * （契约 `selfPublishToollessAgent` 头注 / `KNOWN_CONTRACT_GAPS.AR11`）。
   *
   * ⚠ 本方法**不**接收任何"这个 agent 有没有工具"的入参：`in` 只有 `agentId`。
   *   能力面、状态、可见性三项全部由用例从库里读出来交给 domain 判定。
   *   一个"调用方声明自己无工具"的入参就是这条豁免的绕过路径本身。
   */
  @Post(C.operations.selfPublishToollessAgent.path)
  async selfPublish(
    @CurrentPrincipal() principal: Principal,
    @Param("agentId") agentId: string,
    @Body(new ZodBodyPipe(C.operations.selfPublishToollessAgent.in)) body: SelfPublishBody,
  ) {
    assertPrincipal(principal);
    // 路径与请求体不一致时按路径为准是"猜"——两者都写了就必须相等，
    // 同 `skill-review.controller.ts` 的 `assertPathMatchesBody`。
    if (body.agentId !== agentId) throw new NotFoundException({ reasonCode: "AGENT_NOT_FOUND" });
    try {
      const result = await selfPublishToollessAgent(
        { orgId: principal.orgId, actorId: principal.userId, agentId },
        { identities: this.identities, repository: this.selfPublishRepository },
      );
      return C.operations.selfPublishToollessAgent.out.parse({
        agentId: result.agentId,
        publishState: result.publishState,
        agentVersionId: result.agentVersionId,
        publishRoute: "自助发布",
      });
    } catch (error) {
      if (error instanceof SelfPublishAgentError) throw this.toHttp(error.code);
      throw error;
    }
  }

  /** 码 → HTTP 的唯一映射点，两条路由共用（同一张 `ERROR_STATUS` 表）。 */
  private toHttp(code: string) {
    const status = ERROR_STATUS[code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
    if (status === HttpStatus.FORBIDDEN) return new ForbiddenException({ reasonCode: code });
    if (status === HttpStatus.NOT_FOUND) return new NotFoundException({ reasonCode: code });
    return new UnprocessableEntityException({ reasonCode: code });
  }
}
