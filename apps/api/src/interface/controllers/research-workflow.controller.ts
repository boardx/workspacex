/**
 * 研判工作流的 HTTP 边界 —— 契约 `researchWorkflow` 的五个端点。
 *
 * 协议适配而已：**每一条判断都在 application / domain**。本控制器不判阶段、不判门、
 * 不判可见性——它只负责把 `ResearchGateRefusedError` 翻成 409、把
 * `ThreadNotVisibleError` 翻成 404。
 *
 * ## 为什么拒绝是 409 而不是 403
 *
 * 403 的意思是"你没资格"，但过门被拒通常不是资格问题——是**当前状态不允许**
 * （材料还没审完、前一道门没过）。同一个人过几分钟就可以成功。409 Conflict
 * 说的正是这件事：请求与资源当前状态冲突。
 *
 * 响应体带 `reasonCode`（契约 `RESEARCH_REFUSALS` 之一）与 `phase`：前端要据此
 * 给出"下一步该做什么"，而不是摊一句"操作失败"。可用性那一半分数就在这里。
 *
 * ⚠ **没有"直接设置阶段"的端点**。阶段只能经门或经状态机允许的推进改变——
 * 开一个 `PUT /phase` 等于把三道门做成装饰品。
 */
import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { researchWorkflow as C } from "@repo/contracts";
import {
  addMaterials,
  advancePhaseGuarded,
  passGateGuarded,
  readAudit,
  readSession,
  reviewMaterial,
  type ResearchActor,
  type ResearchOpsDeps,
} from "../../application/research-workflow/guarded-operations";
import { ResearchGateRefusedError } from "../../application/research-workflow/pass-gate";
import { ThreadNotVisibleError } from "../../application/chat/get-thread";
import {
  RESEARCH_WORKFLOW_REPOSITORY,
  type ResearchWorkflowRepository,
} from "../../application/research-workflow/ports";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { randomUUID } from "node:crypto";

@Controller()
export class ResearchWorkflowController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(RESEARCH_WORKFLOW_REPOSITORY) private readonly research: ResearchWorkflowRepository,
  ) {}

  private deps(): ResearchOpsDeps {
    return {
      repo: this.repo,
      ids: this.ids,
      chat: this.chat,
      research: this.research,
      uuid: { next: () => randomUUID() },
      now: () => new Date(),
    };
  }

  /** team3 走个人线程 ⇒ `projectId` 恒为 null。见 `components/agent/team3-chat.tsx`。 */
  private actor(principal: Principal, threadId: string): ResearchActor {
    return {
      userId: principal.userId,
      orgId: toOrgId(principal.orgId),
      projectId: null,
      threadId,
    };
  }

  /**
   * 三类出口的唯一映射处。
   * 放在一个 helper 里而不是每个路由各写一遍 try/catch：五个路由各写一遍，
   * 迟早有一个漏掉 `ResearchGateRefusedError`，于是那条路由把业务拒绝变成 500。
   */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof ResearchGateRefusedError) {
        throw new ConflictException({
          reasonCode: e.refusal,
          phase: e.fromPhase,
          message: C.REFUSAL_LABELS[e.refusal],
        });
      }
      throw e;
    }
  }

  @Get("/threads/:threadId/research-session")
  async getSession(@CurrentPrincipal() principal: Principal, @Param("threadId") threadId: string) {
    assertPrincipal(principal);
    return this.run(() => readSession(this.deps(), this.actor(principal, threadId)));
  }

  @Get("/threads/:threadId/research-audit")
  async getAudit(@CurrentPrincipal() principal: Principal, @Param("threadId") threadId: string) {
    assertPrincipal(principal);
    return this.run(() => readAudit(this.deps(), this.actor(principal, threadId)));
  }

  @Post("/threads/:threadId/research-materials")
  async postMaterials(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    const parsed = C.addResearchMaterials.in.parse({ ...(body as object), threadId });
    return this.run(() => addMaterials(this.deps(), this.actor(principal, threadId), parsed.materials));
  }

  @Post("/threads/:threadId/research-materials/:materialId/review")
  async postReview(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Param("materialId") materialId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    const parsed = C.reviewResearchMaterial.in.parse({ ...(body as object), threadId, materialId });
    return this.run(() =>
      reviewMaterial(this.deps(), this.actor(principal, threadId), materialId, parsed.verdict, parsed.note),
    );
  }

  @Post("/threads/:threadId/research-gate")
  async postGate(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    const parsed = C.passResearchGate.in.parse({ ...(body as object), threadId });
    return this.run(() => passGateGuarded(this.deps(), this.actor(principal, threadId), parsed.gate));
  }

  @Post("/threads/:threadId/research-advance")
  async postAdvance(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    const parsed = C.advanceResearchPhase.in.parse({ ...(body as object), threadId });
    return this.run(() => advancePhaseGuarded(this.deps(), this.actor(principal, threadId), parsed.to));
  }
}
