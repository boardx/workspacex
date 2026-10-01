/**
 * phase-18 S10（issue #4367）——「分享到项目…」的三个接口（契约 packages/contracts/src/chat-knowledge-graph.ts
 * `listProjectShareTargets` / `shareToProject` / `unshareFromProject`）。路径字面量与契约 op 的 `path` 逐字一致。
 *
 * 单独一个控制器，不往 knowledge-graph.controller.ts 里加：那边同时有别的轮次在改，这里只加不改。
 * 错误出口：别人的个人结论 / 不存在 / 目标项目不是你的 ⇒ 404（人类决定：别人的个人结论一律 404，不是 403）；
 * 观察者 / 归档项目 / 没有登录的人 ⇒ 403；原件有矛盾 ⇒ 409。
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
import { newKgId } from "../../application/knowledge-graph/ids";
import { KNOWLEDGE_READ_PORT, type KnowledgeReadPort } from "../../application/knowledge-graph/ports";
import {
  KgShareError, PROJECT_SHARE_PORT, listProjectShareTargets, shareToProject, unshareFromProject,
  type ProjectSharePort, type ShareDeps,
} from "../../application/knowledge-graph/share-to-project";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

@Controller()
export class KnowledgeShareController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(KNOWLEDGE_READ_PORT) private readonly knowledge: KnowledgeReadPort,
    @Inject(PROJECT_SHARE_PORT) private readonly share: ProjectSharePort,
  ) {}

  private get deps(): ShareDeps {
    return { repo: this.repo, ids: this.ids, chat: this.chat, knowledge: this.knowledge, share: this.share, newId: newKgId };
  }

  private async run<T>(principal: Principal, fn: (viewer: { userId: string; orgId: ReturnType<typeof toOrgId> }) => Promise<T>): Promise<T> {
    assertPrincipal(principal);
    try {
      return await fn({ userId: principal.userId, orgId: toOrgId(principal.orgId) });
    } catch (e) {
      if (e instanceof KgShareError) {
        const body = { reasonCode: e.code };
        if (e.code === "KG_PROJECT_READ_ONLY" || e.code === "KG_ACTOR_NOT_HUMAN" || e.code === "KG_SCOPE_NOT_ENABLED") throw new ForbiddenException(body);
        if (e.code === "KG_CONTESTED_NEEDS_RESOLUTION") throw new ConflictException(body);
        throw new NotFoundException(body);
      }
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /** S10 listProjectShareTargets —— 能分享到哪些项目、谁会看到（只有主人；别人的 404） */
  @Get("/knowledge-graph/personal/claims/:claimId/share-targets")
  targets(@CurrentPrincipal() principal: Principal, @Param("claimId") claimId: string) {
    const parsed = KG.knowledgeGraph.listProjectShareTargets.in.safeParse({ claimId });
    if (!parsed.success) throw new BadRequestException({ reasonCode: "KG_INVALID_REQUEST" });
    return this.run(principal, (v) => listProjectShareTargets(this.deps, { ...v, claimId: parsed.data.claimId }));
  }

  /** S10 shareToProject —— 派生副本进项目记忆（幂等） */
  @Post("/knowledge-graph/personal/claims/:claimId/share")
  @HttpCode(200)
  shareClaim(@CurrentPrincipal() principal: Principal, @Param("claimId") claimId: string, @Body() body: unknown) {
    const parsed = KG.knowledgeGraph.shareToProject.in.safeParse({ ...(body as object), claimId });
    if (!parsed.success) throw new BadRequestException({ reasonCode: "KG_INVALID_REQUEST" });
    return this.run(principal, (v) => shareToProject(this.deps, { ...v, claimId: parsed.data.claimId, projectId: parsed.data.projectId }));
  }

  /** S10 unshareFromProject —— 撤回：项目副本失效，原件不动 */
  @Post("/knowledge-graph/personal/claims/:claimId/unshare")
  @HttpCode(200)
  unshareClaim(@CurrentPrincipal() principal: Principal, @Param("claimId") claimId: string, @Body() body: unknown) {
    const parsed = KG.knowledgeGraph.unshareFromProject.in.safeParse({ ...(body as object), claimId });
    if (!parsed.success) throw new BadRequestException({ reasonCode: "KG_INVALID_REQUEST" });
    return this.run(principal, (v) => unshareFromProject(this.deps, { ...v, claimId: parsed.data.claimId, projectId: parsed.data.projectId }));
  }
}
