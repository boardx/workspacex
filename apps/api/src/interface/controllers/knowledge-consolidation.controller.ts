/**
 * Phase 18 S8（#4365）—— 本人的记忆整合记录与撤销（契约 `listMyConsolidationRuns` / `undoConsolidationRun`）：
 *
 *   GET  /knowledge-graph/me/consolidations
 *   POST /knowledge-graph/me/consolidations/:runId/undo
 *
 * 只有本人：判定与个人空间读口同一个（`decidePersonalSpace`：组织成员 + 查看者就是空间主人），数据库函数再按
 * `app.current_user_id` 只动本人的运行。别人的运行 / 不存在 / 已撤销 ⇒ 同一个 404 `KG_CONSOLIDATION_RUN_NOT_FOUND`。
 * 单开一个 controller（不塞进 `KnowledgeGraphController`）：同一轮里别的 worker 正在改那个文件（#4365 协调约定）。
 */
import { Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, ServiceUnavailableException } from "@nestjs/common";
import { knowledgeGraph as KG } from "@repo/contracts";
import { AuthzUnavailableError } from "../../application/chat/resolve-visibility";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import {
  DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository,
} from "../../application/identity/ports";
import { listMyConsolidationRuns, undoMyConsolidationRun } from "../../application/knowledge-graph/consolidate-memory";
import { newKgId } from "../../application/knowledge-graph/ids";
import { KNOWLEDGE_READ_PORT, type KnowledgeReadPort } from "../../application/knowledge-graph/ports";
import { KG_CONSOLIDATION_PORT, KgConsolidationError, type KgConsolidationPort } from "../../application/knowledge-graph/s8-ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

@Controller()
export class KnowledgeConsolidationController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(KNOWLEDGE_READ_PORT) private readonly knowledge: KnowledgeReadPort,
    @Inject(KG_CONSOLIDATION_PORT) private readonly consolidation: KgConsolidationPort,
  ) {}

  private get deps() {
    return { repo: this.repo, ids: this.ids, chat: this.chat, knowledge: this.knowledge, consolidation: this.consolidation, newActionId: () => newKgId("act") };
  }

  private async run<T>(principal: Principal, fn: (viewer: { userId: string; orgId: ReturnType<typeof toOrgId> }) => Promise<T>): Promise<T> {
    assertPrincipal(principal);
    // HTTP 会话的执行身份就是人（同 KnowledgeGraphController 的 actorKind: "human"）；数据库撤销函数另外要求声明了本人。
    try {
      return await fn({ userId: principal.userId, orgId: toOrgId(principal.orgId) });
    } catch (e) {
      if (e instanceof KgConsolidationError) {
        if (e.code === "KG_NOT_VISIBLE" || e.code === "KG_ACTOR_NOT_HUMAN") throw new ForbiddenException({ reasonCode: e.code });
        throw new NotFoundException({ reasonCode: e.code });
      }
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  @Get(KG.knowledgeGraph.listMyConsolidationRuns.path)
  list(@CurrentPrincipal() principal: Principal) {
    return this.run(principal, async (v) => KG.knowledgeGraph.listMyConsolidationRuns.out.parse({
      runs: await listMyConsolidationRuns(this.deps, v, KG.KG_CONSOLIDATION_RUNS_LIMIT),
    }));
  }

  @Post(KG.knowledgeGraph.undoConsolidationRun.path)
  @HttpCode(200)
  undo(@CurrentPrincipal() principal: Principal, @Param("runId") runId: string) {
    return this.run(principal, async (v) => KG.knowledgeGraph.undoConsolidationRun.out.parse({
      run: await undoMyConsolidationRun(this.deps, v, runId),
    }));
  }
}
