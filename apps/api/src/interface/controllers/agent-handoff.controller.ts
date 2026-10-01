/**
 * AG07 —— handoff 的三个 HTTP 面（契约 `agentRole.operations.listThreadHandoffs` / `confirmHandoff` / `cancelHandoff`）：
 *   GET  /agent-handoffs?threadId=…
 *   POST /agent-handoffs/:handoffId/confirm
 *   POST /agent-handoffs/:handoffId/cancel
 *
 * 本层只做 principal / 入参校验与稳定码 → HTTP 映射；判定全在 `application/agent/agent-handoff.ts`。
 * 拒绝体只带 `reasonCode`（+ `HANDOFF_NOT_ALLOWED` 时的 `reason`），不转发任何异常原文。
 */
import {
  Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Optional, Param, Post, Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import { agentRole as R } from "@repo/contracts";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { CurrentPrincipal } from "../current-principal.decorator";
import {
  AGENT_HANDOFF_STORE, AgentHandoffError, SOURCE_READ_PERMISSION_CHECK,
  cancelAgentHandoff, confirmAgentHandoff, listThreadHandoffs,
  type AgentHandoffStore, type SourceReadPermissionCheck,
} from "../../application/agent/agent-handoff";

export function handoffErrorToHttp(error: AgentHandoffError) {
  return error.code === "HANDOFF_NOT_ALLOWED"
    ? new ForbiddenException({ reasonCode: error.code, reason: error.reason })
    : new NotFoundException({ reasonCode: error.code });
}

@Controller()
export class AgentHandoffController {
  constructor(
    @Inject(AGENT_HANDOFF_STORE) private readonly handoffs: AgentHandoffStore,
    @Optional() @Inject(SOURCE_READ_PERMISSION_CHECK) private readonly sources?: SourceReadPermissionCheck,
  ) {}

  @Get(R.operations.listThreadHandoffs.path)
  async list(@CurrentPrincipal() principal: Principal, @Query("threadId") threadId: unknown) {
    assertPrincipal(principal);
    const input = R.operations.listThreadHandoffs.in.safeParse({ threadId });
    if (!input.success) throw new UnprocessableEntityException({ reasonCode: "VALIDATION_FAILED" });
    const out = await listThreadHandoffs(
      { handoffs: this.handoffs, sources: this.sources },
      { orgId: toOrgId(principal.orgId), userId: principal.userId, threadId: input.data.threadId },
    );
    return R.operations.listThreadHandoffs.out.parse(out);
  }

  @Post(R.operations.confirmHandoff.path)
  @HttpCode(200)
  async confirm(@CurrentPrincipal() principal: Principal, @Param("handoffId") handoffId: string) {
    assertPrincipal(principal);
    const input = R.operations.confirmHandoff.in.safeParse({ handoffId });
    if (!input.success) throw new UnprocessableEntityException({ reasonCode: "VALIDATION_FAILED" });
    try {
      const out = await confirmAgentHandoff(
        { handoffs: this.handoffs },
        { orgId: toOrgId(principal.orgId), userId: principal.userId, handoffId: input.data.handoffId },
      );
      return R.operations.confirmHandoff.out.parse(out);
    } catch (error) {
      if (error instanceof AgentHandoffError) throw handoffErrorToHttp(error);
      throw error;
    }
  }

  @Post(R.operations.cancelHandoff.path)
  @HttpCode(200)
  async cancel(@CurrentPrincipal() principal: Principal, @Param("handoffId") handoffId: string) {
    assertPrincipal(principal);
    const input = R.operations.cancelHandoff.in.safeParse({ handoffId });
    if (!input.success) throw new NotFoundException({ reasonCode: "HANDOFF_NOT_FOUND" });
    try {
      const out = await cancelAgentHandoff(
        { handoffs: this.handoffs },
        { orgId: toOrgId(principal.orgId), userId: principal.userId, handoffId: input.data.handoffId },
      );
      return R.operations.cancelHandoff.out.parse(out);
    } catch (error) {
      if (error instanceof AgentHandoffError) throw handoffErrorToHttp(error);
      throw error;
    }
  }
}
