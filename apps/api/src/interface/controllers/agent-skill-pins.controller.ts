/**
 * #595 A2 —— `POST /admin/agents/:agentId/skill-pins`。
 *
 * ## 为什么这条路由存在
 *
 * 验收第 4 条（导入后能在 `/chat` 里选中并成功调用）撞在一个结构性断口上：
 * URL 导入产出的 skill 版本发布到模型 A，但**没有任何路径**能让它进入某次
 * chat 调用的 `skillVersionIds`（详见 issue #595 的勘探评论）。本 controller
 * 是那条缺失的写入点——浏览器可触发，全程留在模型 A，不碰 #598。
 *
 * ## ⚠ 契约面是草案，尚未经人类签核
 *
 * 路径 / 字段名 / 错误码全部来自 `packages/contracts` 的 `setAgentSkillPins`，
 * 标注未签核（ADR-023）。
 */
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Response } from "express";
import { agentRuntime as C } from "@repo/contracts";
import {
  setAgentSkillPins,
  AGENT_SKILL_PINS_REPOSITORY,
  type AgentSkillPinsRepository,
} from "../../application/agent-skill-pins/set-agent-skill-pins";
import { SetAgentSkillPinsError } from "../../application/agent-skill-pins/set-agent-skill-pins-draft";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

type PinsBody = ReturnType<typeof C.operations.setAgentSkillPins.in.parse>;

const ERROR_STATUS: Record<string, HttpStatus> = {
  ROLE_INSUFFICIENT: HttpStatus.FORBIDDEN,
  AGENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  AGENT_NOT_PUBLISHED: HttpStatus.UNPROCESSABLE_ENTITY,
  VERSION_CHANGED: HttpStatus.CONFLICT,
  SKILL_VERSION_NOT_FOUND: HttpStatus.UNPROCESSABLE_ENTITY,
};

@Controller()
export class AgentSkillPinsController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(AGENT_SKILL_PINS_REPOSITORY) private readonly repository: AgentSkillPinsRepository,
  ) {}

  @Post("/admin/agents/:agentId/skill-pins")
  async pin(
    @CurrentPrincipal() principal: Principal,
    @Param("agentId") agentId: string,
    @Body(new ZodBodyPipe(C.operations.setAgentSkillPins.in)) body: PinsBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPrincipal(principal);
    /**
     * ⚠ 与 `skill-mount.controller.ts` 的 `assertPathMatchesBody` 同一理由：
     *   路径段与 body 字段必须一致，否则 URL 与实际操作对象可能对不上——
     *   不信任前端把两者填成一样，服务端自己核对。
     */
    if (agentId !== body.agentId) {
      throw new UnprocessableEntityException({ reasonCode: "CONTRACT_VALIDATION_FAILED" });
    }
    try {
      const result = await setAgentSkillPins(
        { orgId: principal.orgId, actorId: principal.userId, ...body },
        { identities: this.identities, repository: this.repository },
      );
      response.status(HttpStatus.CREATED);
      return C.operations.setAgentSkillPins.out.parse(result);
    } catch (error) {
      if (error instanceof SetAgentSkillPinsError) {
        const status = ERROR_STATUS[error.code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
        if (status === HttpStatus.FORBIDDEN) throw new ForbiddenException({ reasonCode: error.code });
        if (status === HttpStatus.NOT_FOUND) throw new NotFoundException({ reasonCode: error.code });
        if (status === HttpStatus.CONFLICT) throw new ConflictException({ reasonCode: error.code });
        throw new UnprocessableEntityException({ reasonCode: error.code });
      }
      throw error;
    }
  }
}
