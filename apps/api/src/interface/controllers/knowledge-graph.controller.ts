/**
 * Phase 18 F09 —— 知识图谱的读接口（契约 packages/contracts/src/chat-knowledge-graph.ts）。
 *
 * 路径字面量与契约 op 的 `path` 逐字一致。不可见与不存在同一个出口（404 + 同一个 reasonCode）：
 * 分开了就能探测别人的会话 / 结论是否存在。
 */
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject,
  NotFoundException, Param, Post, Put, ServiceUnavailableException,
} from "@nestjs/common";
import { knowledgeGraph as KG } from "@repo/contracts";
import { AuthzUnavailableError } from "../../application/chat/resolve-visibility";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import {
  DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository,
} from "../../application/identity/ports";
import { actOnMemoryCard } from "../../application/knowledge-graph/act-on-memory-card";
import { applyHumanAction } from "../../application/knowledge-graph/apply-human-action";
import { listPromotionNominations, promoteToPersonal } from "../../application/knowledge-graph/promote-to-personal";
import {
  HUMAN_ACTION_PORT, KG_EXTRACTION_MODEL_CONFIG, KG_ORG_EXTRACTION_SETTINGS_PORT, KNOWLEDGE_READ_PORT, KgHumanActionError, MEMORY_CARD_PORT, PROMOTION_PORT,
  type HumanActionPort, type KgExtractionModelConfig, type KgOrgExtractionSettingsPort, type KnowledgeReadPort, type MemoryCardPort, type PromotionPort,
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
    /** issue #4178：记忆抽取的组织开关 + 部署能力位。 */
    @Inject(KG_ORG_EXTRACTION_SETTINGS_PORT) private readonly extractionSettings: KgOrgExtractionSettingsPort,
    @Inject(KG_EXTRACTION_MODEL_CONFIG) private readonly extractionModelConfig: KgExtractionModelConfig,
    /** F17 确认卡。生产合成必定注入；只测别的接口的构造点可以不给（此时这条接口回 503，不假装成功）。 */
    @Inject(MEMORY_CARD_PORT) private readonly cards?: MemoryCardPort,
  ) {}

  private get deps(): KnowledgeReadDeps {
    return { repo: this.repo, ids: this.ids, chat: this.chat, knowledge: this.knowledge };
  }

  private async run<T>(principal: Principal, fn: (viewer: { userId: string; orgId: ReturnType<typeof toOrgId> }) => Promise<T>): Promise<T> {
    assertPrincipal(principal);
    try {
      return await fn({ userId: principal.userId, orgId: toOrgId(principal.orgId) });
    } catch (e) {
      // KG_NOT_VISIBLE 只来自个人空间（不是 / 已不是组织成员，契约 getPersonalKnowledge.err）：本人的空间
      // 没有「存在性」可探测，报 403 说清是看不到；会话 / 结论的看不见仍与不存在同一个 404 出口。
      if (e instanceof KgReadError) {
        if (e.code === "KG_NOT_VISIBLE") throw new ForbiddenException({ reasonCode: e.code });
        throw new NotFoundException({ reasonCode: e.code });
      }
      if (e instanceof KgHumanActionError) {
        const body = { reasonCode: e.code };
        if (e.code === "KG_NOT_OWNER" || e.code === "KG_ACTOR_NOT_HUMAN" || e.code === "KG_SCOPE_NOT_PERSONAL") throw new ForbiddenException(body);
        if (e.code === "KG_PROMOTE_BATCH_TOO_LARGE" || e.code === "KG_INVALID_REQUEST") throw new BadRequestException(body);
        if (e.code === "KG_REVISION_CHANGED" || e.code === "KG_CONTESTED_NEEDS_RESOLUTION" || e.code === "KG_CARD_STALE") {
          throw new ConflictException(body);
        }
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

  /** UC-KG-12 actOnMemoryCard —— 对「记住 / 忘掉」确认卡做决定（人的动作：接口只接受人类会话，I-15 / I-17） */
  @Post("/knowledge-graph/cards/:cardId")
  @HttpCode(200)
  memoryCard(@CurrentPrincipal() principal: Principal, @Param("cardId") cardId: string, @Body() body: unknown) {
    const parsed = KG.knowledgeGraph.actOnMemoryCard.in.safeParse({ ...(body as object), cardId });
    if (!parsed.success) throw new BadRequestException({ reasonCode: "KG_INVALID_REQUEST" });
    const cards = this.cards;
    if (cards === undefined) throw new ServiceUnavailableException("memory_cards_unavailable");
    const { decision, claimIds, editedStatement } = parsed.data;
    return this.run(principal, (v) => actOnMemoryCard(
      { ...this.deps, cards, newId: newKgId },
      { ...v, actorKind: "human", cardId, decision, ...(claimIds !== undefined ? { claimIds } : {}), ...(editedStatement !== undefined ? { editedStatement } : {}) },
    ));
  }

  /**
   * issue #4178 getKnowledgeExtractionSetting —— 任何组织成员可读：这是「这个组织现在
   * 抽不抽」这件事本身，不是要按内容披露的租户数据（同 #3068 `listStandingToolGrants`
   * 的读写分权理由，见 `application/knowledge-graph/ports.ts` 的 `KgOrgExtractionSettingsPort` 头注）。
   */
  @Get("/knowledge-graph/extraction-setting")
  async extractionSetting(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const orgEnabled = await this.extractionSettings.getEnabled(toOrgId(principal.orgId));
    return KG.knowledgeGraph.getKnowledgeExtractionSetting.out.parse({
      deploymentCapable: this.extractionModelConfig.enabled, orgEnabled,
    });
  }

  /**
   * issue #4178 setKnowledgeExtractionSetting —— 仅组织 admin。判据与 `tool-permission-
   * grant.controller.ts` 的 `requireOrgAdmin` 同一实现思路（查 `org_memberships`，
   * `orgRole !== 'admin'` ⇒ 403 `KG_NOT_ORG_ADMIN`）——组织从调用者当前会话取，
   * 不接受调用方在请求体里指定别的组织。
   */
  @Put("/knowledge-graph/extraction-setting")
  async setExtractionSetting(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    assertPrincipal(principal);
    const parsed = KG.knowledgeGraph.setKnowledgeExtractionSetting.in.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ reasonCode: "KG_INVALID_REQUEST" });
    const orgId = toOrgId(principal.orgId);
    const membership = await this.repo.findOrgMembership(principal.userId, orgId);
    if (membership === null || membership.orgRole !== "admin") {
      throw new ForbiddenException({ reasonCode: "KG_NOT_ORG_ADMIN" });
    }
    const orgEnabled = await this.extractionSettings.setEnabled(orgId, parsed.data.enabled, principal.userId);
    return KG.knowledgeGraph.setKnowledgeExtractionSetting.out.parse({
      deploymentCapable: this.extractionModelConfig.enabled, orgEnabled,
    });
  }
}
