/**
 * 对话可见性路由（F108）。协议适配而已——每一个判断都发生在 `application`。
 *
 * ## 状态码就是需求本身
 *
 *   404  不可见 **或** 不存在。两者**逐字节相同**（I-3）：403 会回答「这里是不是有东西
 *        我看不到」，而对私聊/别组线程来说，那个回答本身就是泄露。
 *   503  判定依赖不可用（`AUTHZ_UNAVAILABLE`）。**拒绝，不降级放行**（uc-8-5 V10）。
 *   403  不是组织管理员（审计端口）。这一档可以说实话：它与资源是否存在无关。
 *
 * ⚠ `deniedLayer` **不进对外响应**（契约 `resolveVisibility` 注释逐字如此）。
 *   它是内部判定记录与审计里的字段；放进响应体，I-3 就白做了——
 *   「组织层拒的」与「项目层拒的」这两种回答本身就能反推出资源存在。
 */
import {
  Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Inject,
  NotFoundException, Param, Post, Query, ServiceUnavailableException,
} from "@nestjs/common";
import { chat as C } from "@repo/contracts";
import {
  adminAuditRead,
  NotOrgAdminError,
} from "../../application/chat/admin-audit-read";
import { getThread, ThreadNotVisibleError } from "../../application/chat/get-thread";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import {
  AuthzUnavailableError,
  resolveVisibility,
} from "../../application/chat/resolve-visibility";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../application/provenance/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const RESOLVE_VISIBILITY_SCHEMA = C.operations.resolveVisibility.in;
export const ADMIN_AUDIT_READ_SCHEMA = C.operations.adminAuditRead.in;

type ResolveBody = { actorId: string; projectId: string; threadId: string | null; resourceKind: "thread" | "message" | "transcript" | "file" };
type AdminAuditBody = { threadId: string; projectId: string; layer: "project" | "personal" };

@Controller()
export class ChatController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
  ) {}

  private get deps() {
    return { repo: this.repo, ids: this.ids, chat: this.chat };
  }

  /**
   * 判定一次读取。**每个读端口的前置**，这里把它也暴露成路由，供界面预先禁用入口。
   *
   * ⚠ 拒绝时返回的 `scope` 恒为最严的 `private`，`deniedLayer` 恒为 `null`：
   *   把真实 scope 或拒绝层写进拒绝响应，等于用另一个字段回答了 I-3 禁止回答的问题。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/visibility/resolve")
  async resolve(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(RESOLVE_VISIBILITY_SCHEMA)) body: ResolveBody,
  ) {
    assertPrincipal(principal);
    if (body.threadId === null) throw new NotFoundException();
    try {
      const outcome = await resolveVisibility(this.deps, {
        // 以**登录主体**为准，不以请求体里的 actorId 为准。
        // 否则任何人都能填别人的 id 去问「他能不能看见」，那是一个免费的权限探测器。
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        projectId: body.projectId,
        threadId: body.threadId,
      });
      if (outcome.kind !== "allow") {
        return { allowed: false, scope: "private" as const, decisionId: outcome.decisionId, deniedLayer: null };
      }
      return {
        allowed: true,
        scope: outcome.decision.scope,
        decisionId: outcome.decisionId,
        deniedLayer: null,
      };
    } catch (e) {
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /** 线程详情（含四视角投影）。观察者拿到的是**服务端已经删过**的那一份（I-5）。 */
  @Get("/chat/threads/:threadId")
  async thread(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Query("projectId") projectId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await getThread(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        projectId,
        threadId,
      });
    } catch (e) {
      // 不可见与不存在同一个出口，且**不带任何 body**：带了 reasonCode 就分得出来了。
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (e instanceof AuthzUnavailableError) throw new ServiceUnavailableException("authz_unavailable");
      throw e;
    }
  }

  /**
   * 管理员审计读。**返回内容不是 403**（I-8 / O-04），且必然留痕。
   *
   * POST 而非 GET：它有副作用（那条审计事件）。200 而非 201：
   * 从调用方看没有任何东西被创建，客户端若按 201 分支会把一次读当成一次写。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/chat/threads/:threadId/admin-audit-read")
  async adminAudit(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(ADMIN_AUDIT_READ_SCHEMA)) body: AdminAuditBody,
  ) {
    assertPrincipal(principal);
    try {
      return await adminAuditRead(
        { repo: this.repo, chat: this.chat, provenance: this.provenance, ids: this.ids },
        {
          adminId: principal.userId,
          orgId: toOrgId(principal.orgId),
          projectId: body.projectId,
          threadId: body.threadId,
          layer: body.layer,
        },
      );
    } catch (e) {
      // 403，不是 404：这一档与「资源是否存在」无关，它讲的是调用者的组织角色。
      if (e instanceof NotOrgAdminError) throw new ForbiddenException();
      throw e;
    }
  }
}
