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
 */
import { Controller, Get, Inject, NotFoundException, Param, ServiceUnavailableException } from "@nestjs/common";
import { CurrentPrincipal } from "../current-principal.decorator";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository } from "../../application/identity/ports";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import { AuthzUnavailableError } from "../../application/chat/resolve-visibility";
import { AGENT_RUN_STORE, type AgentRunStore } from "../../application/agent-run/ports";
import { AgentRunNotVisibleError, readAgentRun } from "../../application/agent-run/read-run";

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
}
