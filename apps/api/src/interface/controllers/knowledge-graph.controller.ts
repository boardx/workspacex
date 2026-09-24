/**
 * Phase 18 F09 —— 知识图谱的读接口（契约 packages/contracts/src/chat-knowledge-graph.ts）。
 *
 * 路径字面量与契约 op 的 `path` 逐字一致。不可见与不存在同一个出口（404 + 同一个 reasonCode）：
 * 分开了就能探测别人的会话 / 结论是否存在。
 */
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject,
  NotFoundException, Param, Post, ServiceUnavailableException,
} from "@nestjs/common";
import { knowledgeGraph as KG } from "@repo/contracts";
import { AuthzUnavailableError } from "../../application/chat/resolve-visibility";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import {
  DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository,
} from "../../application/identity/ports";
import { applyHumanAction } from "../../application/knowledge-graph/apply-human-action";
import { listPromotionNominations, promoteToPersonal } from "../../application/knowledge-graph/promote-to-personal";
import {
  HUMAN_ACTION_PORT, KNOWLEDGE_READ_PORT, KgHumanActionError, PROMOTION_PORT,
  type HumanActionPort, type KnowledgeReadPort, type PromotionPort,
} from "../../application/knowledge-graph/ports";
import { newKgId } from "../../application/knowledge-graph/ids";
import { getBrainOverview, getPersonalKnowledge } from "../../application/knowledge-graph/read-personal-knowledge";
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
    @Inject(HUMAN_ACTION_PORT) private readonly actions: HumanActionPort,
    @Inject(PROMOTION_PORT) private readonly promotion: PromotionPort,
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
      if (e instanceof KgHumanActionError) {
        const body = { reasonCode: e.code };
        if (e.code === "KG_NOT_OWNER" || e.code === "KG_ACTOR_NOT_HUMAN" || e.code === "KG_SCOPE_NOT_PERSONAL") throw new ForbiddenException(body);
        if (e.code === "KG_PROMOTE_BATCH_TOO_LARGE") throw new BadRequestException(body);
        if (e.code === "KG_REVISION_CHANGED" || e.code === "KG_CONTESTED_NEEDS_RESOLUTION") throw new ConflictException(body);
        throw new NotFoundException(body);
      }
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

  /** UC-KG-7 getPersonalKnowledge —— 本人个人空间（长期记忆），只有本人 */
  @Get("/knowledge-graph/personal")
  personalKnowledge(@CurrentPrincipal() principal: Principal) {
    return this.run(principal, (v) => getPersonalKnowledge(this.deps, v));
  }

  /** getBrainOverview —— 大脑页：本人各会话的记忆计数 + 个人结论的来源会话 */
  @Get("/knowledge-graph/me/overview")
  brainOverview(@CurrentPrincipal() principal: Principal) {
    return this.run(principal, (v) => getBrainOverview(this.deps, v));
  }

  /** UC-KG-3 applyHumanAction —— 人的动作（确认 / 改写 / 忘掉 / 标冲突 / 合并 / 拆分 / 改名） */
  @Post("/knowledge-graph/threads/:threadId/actions")
  @HttpCode(200)
  humanAction(@CurrentPrincipal() principal: Principal, @Param("threadId") threadId: string, @Body() body: unknown) {
    const parsed = KG.knowledgeGraph.applyHumanAction.in.safeParse({ ...(body as object), threadId });
    if (!parsed.success) throw new BadRequestException({ reasonCode: "KG_INVALID_REQUEST" });
    return this.run(principal, (v) => applyHumanAction(
      { ...this.deps, actions: this.actions, newId: newKgId },
      { ...v, threadId, basedOnRevision: parsed.data.basedOnRevision, action: parsed.data.action },
    ));
  }

  /** UC-KG-5 promoteToPersonal —— 「记到我的长期记忆」（逐条部分成功） */
  @Post("/knowledge-graph/threads/:threadId/promote")
  @HttpCode(200)
  promote(@CurrentPrincipal() principal: Principal, @Param("threadId") threadId: string, @Body() body: unknown) {
    const raw = (body ?? {}) as { claimIds?: unknown };
    if (Array.isArray(raw.claimIds) && raw.claimIds.length > KG.KG_PROMOTE_MAX_BATCH) {
      throw new BadRequestException({ reasonCode: "KG_PROMOTE_BATCH_TOO_LARGE" });
    }
    const parsed = KG.knowledgeGraph.promoteToPersonal.in.safeParse({ ...(body as object), threadId });
    if (!parsed.success) throw new BadRequestException({ reasonCode: "KG_INVALID_REQUEST" });
    return this.run(principal, (v) => promoteToPersonal(
      { ...this.deps, promotion: this.promotion, newId: newKgId },
      { ...v, threadId, claimIds: parsed.data.claimIds, ...(parsed.data.choices ? { choices: parsed.data.choices } : {}) },
    ));
  }

  /** UC-KG-6 listPromotionNominations —— AI 只提名，不执行 */
  @Get("/knowledge-graph/threads/:threadId/nominations")
  nominations(@CurrentPrincipal() principal: Principal, @Param("threadId") threadId: string) {
    return this.run(principal, (v) => listPromotionNominations({ ...this.deps, promotion: this.promotion, newId: newKgId }, { ...v, threadId }));
  }
}
