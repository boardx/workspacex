/**
 * Phase 18 F09 —— 知识图谱的读接口（契约 packages/contracts/src/chat-knowledge-graph.ts）。
 *
 * 路径字面量与契约 op 的 `path` 逐字一致。不可见与不存在同一个出口（404 + 同一个 reasonCode）：
 * 分开了就能探测别人的会话 / 结论是否存在。
 */
import {
  Controller, Get, Inject, NotFoundException, Param, ServiceUnavailableException,
} from "@nestjs/common";
import { AuthzUnavailableError } from "../../application/chat/resolve-visibility";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import {
  DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository,
} from "../../application/identity/ports";
import { KNOWLEDGE_READ_PORT, type KnowledgeReadPort } from "../../application/knowledge-graph/ports";
import {
  KgReadError, getClaimSources, getThreadKnowledge, getTurnMemory, type KnowledgeReadDeps,
} from "../../application/knowledge-graph/read-thread-knowledge";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

@Controller()
export class KnowledgeGraphController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(KNOWLEDGE_READ_PORT) private readonly knowledge: KnowledgeReadPort,
  ) {}

  private get deps(): KnowledgeReadDeps {
    return { repo: this.repo, ids: this.ids, chat: this.chat, knowledge: this.knowledge };
  }

  private async run<T>(principal: Principal, fn: (viewer: { userId: string; orgId: ReturnType<typeof toOrgId> }) => Promise<T>): Promise<T> {
    assertPrincipal(principal);
    try {
      return await fn({ userId: principal.userId, orgId: toOrgId(principal.orgId) });
    } catch (e) {
      if (e instanceof KgReadError) throw new NotFoundException({ reasonCode: e.code });
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /** UC-KG-1 getThreadKnowledge */
  @Get("/knowledge-graph/threads/:threadId")
  threadKnowledge(@CurrentPrincipal() principal: Principal, @Param("threadId") threadId: string) {
    return this.run(principal, (v) => getThreadKnowledge(this.deps, { ...v, threadId }));
  }

  /** UC-KG-2 getClaimSources */
  @Get("/knowledge-graph/claims/:claimId/sources")
  claimSources(@CurrentPrincipal() principal: Principal, @Param("claimId") claimId: string) {
    return this.run(principal, (v) => getClaimSources(this.deps, { ...v, claimId }));
  }

  /** UC-KG-11 getTurnMemory */
  @Get("/knowledge-graph/threads/:threadId/messages/:messageId/memory")
  turnMemory(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Param("messageId") messageId: string,
  ) {
    return this.run(principal, (v) => getTurnMemory(this.deps, { ...v, threadId, messageId }));
  }
}
