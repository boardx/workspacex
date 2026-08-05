/**
 * `POST /agents/:agentId/trial-run` -- 契约 `agentRuntime.operations.trialRunAgent`
 * （#595 拆分 Line A）。
 *
 * 独立文件，**不**改 `skill.controller.ts`（coord-chat-e2e 同时在改那份文件，见任务分工）。
 *
 * 用例本身（`trial-run-agent.ts`）头注解释了为什么这条路由不复用 `agent_runs` 那整条
 * 队列/写回状态机——这里只做 HTTP 边界：解析、鉴权异常翻译、契约 `.parse()`。
 */
import { randomUUID } from "node:crypto";
import { Body, Controller, ForbiddenException, Inject, Param, Post, ServiceUnavailableException } from "@nestjs/common";
import { agentRuntime as C } from "@repo/contracts";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { PUBLISHED_AGENT_READER, type PublishedAgentReader } from "../../application/chat/message-command-ports";
import { AGENT_RUN_STORE, MODEL_CALL_PORT, type AgentRunStore, type ModelCallPort } from "../../application/agent-run/ports";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import {
  TrialRunAgentDependencyFailedError, TrialRunAgentRoleInsufficientError, trialRunAgent,
} from "../../application/agent-run/trial-run-agent";

type TrialRunAgentBody = { readonly agentId: string; readonly scenario: string };

@Controller()
export class AgentTrialRunController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(PUBLISHED_AGENT_READER) private readonly agents: PublishedAgentReader,
    @Inject(AGENT_RUN_STORE) private readonly runs: AgentRunStore,
    @Inject(MODEL_CALL_PORT) private readonly model: ModelCallPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  /** Server-side only, same adapter shape as `AgentRunExecutor`'s (never reaches a response). */
  private readonly log = (message: string, detail: Record<string, unknown>): void => {
    this.logger.error(message, { traceId: randomUUID(), err: detail.detail ?? message, ...detail });
  };

  @Post(C.operations.trialRunAgent.path)
  async trialRun(
    @CurrentPrincipal() principal: Principal,
    @Param("agentId") agentId: string,
    @Body(new ZodBodyPipe(C.operations.trialRunAgent.in)) body: TrialRunAgentBody,
  ) {
    assertPrincipal(principal);
    // Path is authoritative, same discipline as `skill-review.controller.ts`'s
    // `assertPathMatchesBody` -- except this bundle's `err` union has no
    // `CONTRACT_VALIDATION_FAILED`-shaped code to report a path/body mismatch with, so
    // there is nothing to invent here: the path segment wins, `body.agentId` is unused.
    void body.agentId;
    try {
      const result = await trialRunAgent(
        {
          identities: this.identities,
          agents: this.agents,
          runs: this.runs,
          model: this.model,
          log: this.log,
        },
        {
          orgId: toOrgId(principal.orgId),
          actorId: principal.userId,
          agentId,
          scenario: body.scenario,
        },
      );
      return C.operations.trialRunAgent.out.parse(result);
    } catch (e) {
      if (e instanceof TrialRunAgentRoleInsufficientError) {
        throw new ForbiddenException({ reasonCode: "ROLE_INSUFFICIENT" });
      }
      if (e instanceof TrialRunAgentDependencyFailedError) {
        throw new ServiceUnavailableException({ reasonCode: "AGENT_DEPENDENCY_FAILED" });
      }
      throw e;
    }
  }
}
