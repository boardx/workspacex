/**
 * `POST /skill-versions/:versionId/trial-run` —— 契约 `skills.operations.runTrialRun`。
 *
 * 独立文件，理由与 `agent-trial-run.controller.ts` 头注一致：不改 `skill.controller.ts`。
 * 判断全部在 `application/skill/trial-run-skill.ts`（含"为什么面向模型 A 不是模型 B"
 * 那段长注）——本文件只做 HTTP 边界：鉴权异常翻译、契约 `.parse()`。
 */
import { randomUUID } from "node:crypto";
import { Body, Controller, Inject, Param, Post, ServiceUnavailableException } from "@nestjs/common";
import { skills as C } from "@repo/contracts";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { AGENT_RUN_STORE, MODEL_CALL_PORT, type AgentRunStore, type ModelCallPort } from "../../application/agent-run/ports";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { TrialRunSkillError, trialRunSkill } from "../../application/skill/trial-run-skill";

type TrialRunSkillBody = { readonly versionId: string; readonly sampleInput: string };

export const SKILL_TRIALRUN_MODEL_ID = Symbol("SkillTrialRunModelId");

@Controller()
export class SkillTrialRunController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(AGENT_RUN_STORE) private readonly runs: AgentRunStore,
    @Inject(MODEL_CALL_PORT) private readonly model: ModelCallPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
    @Inject(SKILL_TRIALRUN_MODEL_ID) private readonly modelIds: { readonly provider: string; readonly modelId: string },
  ) {}

  private readonly log = (message: string, detail: Record<string, unknown>): void => {
    this.logger.error(message, { traceId: randomUUID(), err: detail.detail ?? message, ...detail });
  };

  @Post(C.operations.runTrialRun.path)
  async trialRun(
    @CurrentPrincipal() principal: Principal,
    @Param("versionId") versionId: string,
    @Body(new ZodBodyPipe(C.operations.runTrialRun.in)) body: TrialRunSkillBody,
  ) {
    assertPrincipal(principal);
    // Path is authoritative, same discipline as `agent-trial-run.controller.ts`.
    void body.versionId;
    try {
      const result = await trialRunSkill(
        {
          identities: this.identities,
          runs: this.runs,
          model: this.model,
          modelProvider: this.modelIds.provider,
          modelId: this.modelIds.modelId,
          log: this.log,
        },
        {
          orgId: toOrgId(principal.orgId),
          actorId: principal.userId,
          versionId,
          sampleInput: body.sampleInput,
        },
      );
      return C.operations.runTrialRun.out.parse({ trialRun: result, asyncTaskId: null });
    } catch (e) {
      if (e instanceof TrialRunSkillError) {
        throw new ServiceUnavailableException({ reasonCode: e.code });
      }
      throw e;
    }
  }
}
