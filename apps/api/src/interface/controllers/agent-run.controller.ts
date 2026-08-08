/**
 * `GET /agent-runs/:runId` -- Wave 2's run transport (delta §5).
 *
 * Polling, not SSE: the delta says so, and the client contract is "bounded backoff, stop
 * at a terminal status". There is no POST here. A run is created by writing a Chat message
 * (§2) and executed by the executor; an endpoint that could start one would be a second
 * way to make a run exist, with no human message attached to it.
 *
 * ## `GET /agent-runs/:runId/stream` (#654 阶段2c) -- additive, this endpoint is UNCHANGED
 *
 * `stream-run.ts`'s own head explains why this is a second, independent way to observe a
 * run rather than a change to this one. `GET /agent-runs/:runId` above keeps returning
 * exactly what it always has, for exactly the callers who already poll it; nothing here
 * removes or narrows that contract.
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
import { Controller, ConflictException, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Res, ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";
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
import { streamAgentRunDeltas } from "../../application/agent-run/stream-run";

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
   * #654 阶段2c -- see file head. Additive: does not change `run()` above.
   *
   * Same 404/503 shape as `run()` for the same reasons (Chat's I-3 rule): visibility is
   * checked before the SSE headers go out, so a run that does not exist or is not visible
   * gets an ordinary 404 response, never an SSE stream that opens and then says nothing.
   */
  @Get("/agent-runs/:runId/stream")
  async stream(
    @CurrentPrincipal() principal: Principal,
    @Param("runId") runId: string,
    @Res() response: Response,
  ): Promise<void> {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const deps = { repo: this.repo, ids: this.ids, chat: this.chat, runs: this.runs };

    // Visibility-only: the projection itself is intentionally discarded (see the long
    // comment below `write` for why the SSE loop below re-derives status from scratch
    // instead of branching on what was true at this exact instant).
    try {
      await readAgentRun(deps, { userId: principal.userId, orgId, runId });
    } catch (e) {
      if (e instanceof AgentRunNotVisibleError) throw new NotFoundException();
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (event: Record<string, unknown>): void => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // ⚠ 2026-08-08 —— 这里曾经有一条"`initial` 已经是终态就跳过 `streamAgentRunDeltas`，
    // 直接吐一条 final 就关连接"的捷径分支，删掉了。它是一个真实的 bug，不是无害的
    // 优化：`readModelDeltas(afterSeq=-1)` 这个查询的确定性保证是"返回目前为止已提交
    // 的全部增量"——不管 run 是还在跑还是已经跑完，这条保证都成立。run 已经终态时，
    // 这批增量恰好就是**全部**增量（模型调用阶段必然已经结束）。跳过它直接吐
    // final，等于在"run 恰好在网络往返期间就跑完"的场景里（CI 上比本地更容易撞见：
    // loopback provider 走完整个流程可能比 HTTP 请求本身的排队/调度还快）永远拿不到
    // 一条 delta——`agent-run-stream-endpoint.test.ts` 的第一条用例实测撞到过。
    // 现在两条路径（"连接时还在跑"、"连接时已经跑完"）统一交给
    // `streamAgentRunDeltas` 处理：它的循环第一轮就会把目前已提交的全部增量读出来，
    // 不需要区分"这是不是它的第一轮"。
    try {
      const outcome = await streamAgentRunDeltas(deps, {
        userId: principal.userId, orgId, runId,
        onDelta: (text) => write({ type: "delta", text }),
      });
      if (outcome.kind === "succeeded") {
        write({ type: "final", status: "succeeded", resultMessageId: outcome.resultMessageId });
      } else if (outcome.kind === "failed") {
        write({ type: "final", status: "failed", error: outcome.error });
      } else {
        write({ type: "timeout" });
      }
    } catch (e) {
      // Visibility can change mid-connection (thread archived, membership revoked) --
      // `stream-run.ts`'s own head explains why this is re-checked every iteration.
      // Whatever the cause, report it and close; never leave the connection open silently.
      if (e instanceof AgentRunNotVisibleError) {
        write({ type: "final", status: "failed", error: "NOT_VISIBLE" });
      } else if (e instanceof AuthzUnavailableError) {
        write({ type: "final", status: "failed", error: "AUTHZ_UNAVAILABLE" });
      } else {
        response.end();
        throw e;
      }
    }
    response.end();
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
