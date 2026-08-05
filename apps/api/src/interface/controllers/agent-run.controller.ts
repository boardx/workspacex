/**
 * `GET /agent-runs/:runId` -- Wave 2's run transport (delta §5).
 *
 * Polling, not SSE: the delta says so, and the client contract is "bounded backoff, stop
 * at a terminal status". There is no POST here. A run is created by writing a Chat message
 * (§2) and executed by the executor; an endpoint that could start one would be a second
 * way to make a run exist, with no human message attached to it.
 *
 * ## One refusal for three different situations
 *
 * Unknown run, another tenant's run, and a thread this person cannot see all return 404
 * with no body. That is Chat's I-3 rule, applied to the read that would otherwise be the
 * easiest existence oracle in the system: run ids appear in Chat responses, so a
 * distinguishable 403 would let anyone confirm which ones are real.
 *
 * ## 🟡 `POST /agent-runs/:runId/retries` 于 #519 补上，**该契约面待人类补签**
 *
 * 照 #496 `createTemplate` 先例。它不是「第二种造 run 的方式」——上面那段说的是这个——
 * 它**重开一个既有 run**：`agent_runs` 上 `UNIQUE (org_id, input_message_id)`（#415）让
 * 「同一条消息的第二个 run」结构上不可能存在，coord-main 在 #519 上裁定该约束优先于 §6
 * 的措辞。补签时要一并裁的三件写在契约里 `retryAgentRun` 的文件头上。
 *
 * 403/409 在这条路由上**不是**存在性 oracle：两者都在**可见性判定通过之后**才可能返回，
 * 也就是提问的人已经能看见这个 run 了。
 */
import { Controller, ConflictException, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, ServiceUnavailableException } from "@nestjs/common";
import { CurrentPrincipal } from "../current-principal.decorator";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository } from "../../application/identity/ports";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import { AuthzUnavailableError } from "../../application/chat/resolve-visibility";
import { AGENT_RUN_STORE, type AgentRunStore } from "../../application/agent-run/ports";
import { AgentRunNotVisibleError, readAgentRun } from "../../application/agent-run/read-run";
import {
  AgentRunNotRetryableError, AgentRunRetryForbiddenError, retryAgentRun,
} from "../../application/agent-run/retry-run";

@Controller()
export class AgentRunController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(AGENT_RUN_STORE) private readonly runs: AgentRunStore,
  ) {}

  @Get("/agent-runs/:runId")
  async run(@CurrentPrincipal() principal: Principal, @Param("runId") runId: string) {
    assertPrincipal(principal);
    try {
      return await readAgentRun(
        { repo: this.repo, ids: this.ids, chat: this.chat, runs: this.runs },
        { userId: principal.userId, orgId: toOrgId(principal.orgId), runId },
      );
    } catch (e) {
      if (e instanceof AgentRunNotVisibleError) throw new NotFoundException();
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /**
   * 🟡 #519，**待人类补签**（见文件头）。
   *
   * 200 而不是 202：返回的是重开后的 run 投影，客户端照 §5 继续轮询到终态。
   */
  @Post("/agent-runs/:runId/retries")
  @HttpCode(200)
  async retry(@CurrentPrincipal() principal: Principal, @Param("runId") runId: string) {
    assertPrincipal(principal);
    try {
      return await retryAgentRun(
        { repo: this.repo, ids: this.ids, chat: this.chat, runs: this.runs },
        { userId: principal.userId, orgId: toOrgId(principal.orgId), runId },
      );
    } catch (e) {
      if (e instanceof AgentRunNotVisibleError) throw new NotFoundException();
      if (e instanceof AgentRunRetryForbiddenError) {
        throw new ForbiddenException("AGENT_RUN_RETRY_FORBIDDEN");
      }
      if (e instanceof AgentRunNotRetryableError) {
        throw new ConflictException({ reasonCode: "AGENT_RUN_NOT_RETRYABLE" });
      }
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }
}
