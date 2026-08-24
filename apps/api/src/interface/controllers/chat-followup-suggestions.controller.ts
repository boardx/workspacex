/**
 * `POST /chat/threads/:threadId/followup-suggestions` —— 契约
 * `chat.operations.generateFollowUpSuggestions`（UIUX 对标 CopilotKit gap #2，issue #712）。
 *
 * 独立文件，同 `agent-trial-run.controller.ts` 的理由：不改 `chat.controller.ts`——
 * 那份文件体量已经很大，且这条路由的依赖形状（`ModelCallPort`）与它现有的构造器参数
 * 不重叠，没有必要把两组不相关的依赖挤进同一个类。
 *
 * HTTP 边界只做三件事：解析、鉴权异常翻译、契约 `.parse()`。判断全部在
 * `generate-followup-suggestions.ts`。
 */
import { randomUUID } from "node:crypto";
import {
  Body, Controller, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, ServiceUnavailableException,
} from "@nestjs/common";
import { chat as C } from "@repo/contracts";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { DECISION_ID_FACTORY, type DecisionIdFactory } from "../../application/identity/ports";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import { PUBLISHED_AGENT_READER, type PublishedAgentReader } from "../../application/chat/message-command-ports";
import { ThreadNotVisibleError } from "../../application/chat/get-thread";
import { MODEL_CALL_PORT, type ModelCallPort } from "../../application/agent-run/ports";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import {
  FOLLOWUP_MODEL_CONFIG,
  FollowUpSuggestionsDependencyFailedError,
  type FollowUpModelConfig,
  generateFollowUpSuggestions,
} from "../../application/chat/generate-followup-suggestions";

type GenerateFollowUpSuggestionsBody = { readonly threadId: string; readonly agentId: string };

@Controller()
export class ChatFollowUpSuggestionsController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(PUBLISHED_AGENT_READER) private readonly publishedAgents: PublishedAgentReader,
    @Inject(MODEL_CALL_PORT) private readonly model: ModelCallPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
    // 追问建议固定走的 provider/modelId——不是被选中 Agent 的快照，见
    // `generate-followup-suggestions.ts` 头注「用哪个 provider 调用」一节。绑定在
    // `kernel.module.ts`（组合根，`readFollowUpSuggestionsModelConfig()` 的唯一调用点）
    // ——interface 层不得直接 import infrastructure（`lint-arch-deps.mjs` 门控）。
    @Inject(FOLLOWUP_MODEL_CONFIG) private readonly followUpModel: FollowUpModelConfig,
  ) {}

  /** Server-side only, same adapter shape as `AgentTrialRunController`'s (never reaches a response). */
  private readonly log = (message: string, detail: Record<string, unknown>): void => {
    this.logger.error(message, { traceId: randomUUID(), err: detail.detail ?? message, ...detail });
  };

  @HttpCode(HttpStatus.OK)
  @Post(C.operations.generateFollowUpSuggestions.path)
  async generate(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body(new ZodBodyPipe(C.operations.generateFollowUpSuggestions.in)) body: GenerateFollowUpSuggestionsBody,
  ) {
    assertPrincipal(principal);
    try {
      const result = await generateFollowUpSuggestions(
        {
          repo: this.identities,
          ids: this.ids,
          chat: this.chat,
          publishedAgents: this.publishedAgents,
          model: this.model,
          followUpModel: this.followUpModel,
          log: this.log,
        },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          threadId: body.threadId ?? threadId,
          agentId: body.agentId,
        },
      );
      return C.operations.generateFollowUpSuggestions.out.parse(result);
    } catch (e) {
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof FollowUpSuggestionsDependencyFailedError) {
        throw new ServiceUnavailableException({ reasonCode: "AGENT_DEPENDENCY_FAILED" });
      }
      throw e;
    }
  }
}
