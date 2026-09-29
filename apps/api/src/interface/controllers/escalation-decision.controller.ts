/**
 * AG06 —— `POST /agent-interrupts/:interruptId/escalation-decision`
 * （契约 `agentRole.operations.decideEscalation`）。
 *
 * 请求体**不**过 `ZodBodyPipe(decideEscalation.in)`：错形 decision（例如 choose_option 形状）
 * 必须到 decision-guard 判成 `INTERRUPT_KIND_MISMATCH`，而不是在管道里被笼统 422 掉（E6）。
 * 决策人资格只在用例里从持久化状态解析，本层只传 principal。
 */
import {
  Body, ConflictException, Controller, ForbiddenException, HttpCode, Inject, NotFoundException, Param, Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { agentRole as R } from "@repo/contracts";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import {
  AGENT_RUN_EXECUTOR, AGENT_RUN_STORE, type AgentRunExecutorPort, type AgentRunStore,
} from "../../application/agent-run/ports";
import {
  decideEscalation, DecideEscalationError, ESCALATION_STORE,
  type DecideEscalationErrorCode, type EscalationStore,
} from "../../application/agent-interrupts/decide-escalation";

export function escalationErrorToHttp(code: DecideEscalationErrorCode) {
  switch (code) {
    case "ESCALATION_DECIDER_FORBIDDEN":
      return new ForbiddenException({ reasonCode: code });
    case "INTERRUPT_KIND_MISMATCH":
      return new ConflictException({ reasonCode: code });
    case "AGENT_NOT_FOUND":
      return new NotFoundException({ reasonCode: code });
    case "VALIDATION_FAILED":
      return new UnprocessableEntityException({ reasonCode: code });
  }
}

@Controller()
export class EscalationDecisionController {
  constructor(
    @Inject(ESCALATION_STORE) private readonly escalations: EscalationStore,
    @Inject(AGENT_RUN_STORE) private readonly runs: AgentRunStore,
    @Inject(AGENT_RUN_EXECUTOR) private readonly executor: AgentRunExecutorPort,
  ) {}

  @Post(R.operations.decideEscalation.path)
  @HttpCode(200)
  async decide(
    @CurrentPrincipal() principal: Principal,
    @Param("interruptId") interruptId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    const rawDecision = typeof body === "object" && body !== null ? (body as { decision?: unknown }).decision : undefined;
    try {
      const out = await decideEscalation(
        { escalations: this.escalations, runs: this.runs, kick: (orgId) => this.executor.kick(orgId) },
        { orgId: principal.orgId, userId: principal.userId, interruptId, rawDecision },
      );
      return R.operations.decideEscalation.out.parse(out);
    } catch (error) {
      if (error instanceof DecideEscalationError) throw escalationErrorToHttp(error.code);
      throw error;
    }
  }
}
