/**
 * FB-2 / FB-3 —— `feedback-loop` 束的五条路由。
 *
 * ## 为什么是独立 controller
 *
 * 反馈的主语是**反馈**，不是 chat、不是 skill、不是 org-admin。挂到任何一个已有
 * controller 上都会让那个 controller 依赖本束的仓储，而反馈的三个入口
 * （导航栏弹层 / chat 内 agent·skill 按钮 / 后台分诊屏）分属三个不同的束——
 * 挂给其中任何一个都是错的。
 *
 * ## 状态码
 *
 *   201  提交成功（`POST /feedback` 创建了一行资源）。
 *   200  读 / 投票 / 分诊。
 *   403  分诊权限不足（`PERMISSION_REVOKED`）。⚠ 与 404 分开：这里**不**隐藏存在性，
 *        因为标题本来就对全组织可见（D3）——对一条你看得见标题的反馈返回 404，
 *        只会让人以为它被删了。
 *   404  反馈不存在或不在本组织（`FEEDBACK_NOT_FOUND`）。
 *   422  转 `不做` 未给理由（`TRIAGE_REASON_REQUIRED`）/ 非法状态转移。
 *        ⚠ 不是 400：请求体的**形状**是合法的（zod 过了），
 *        被拒的是它与当前状态的关系。400 会让前端把它当成填错字段去高亮。
 *
 * ## GET 的 query 参数是**拍平的**，然后重新组装回契约形状再校验
 *
 * 契约的 `listFeedback.in` 是 `{ orgId, scope: <判别联合> }`，而 URL query 只能是
 * 平的键值对。所以这里把 `?scope=target&targetKind=skill&targetId=s-1` 组装成
 * `{ kind: "target", target: { kind: "skill", skillId: "s-1" } }` **再交给契约 schema 校验**。
 * ⚠ 组装之后必须过一次契约校验，不能「组装完直接用」——那等于这条路由自己定义了
 *   一份入参形状，就是 ADR-020 禁止的第二份事实源。
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import { feedbackLoop as C } from "@repo/contracts";
import { randomUUID } from "node:crypto";
import {
  PRODUCT_FEEDBACK_REPOSITORY,
  type FeedbackScope,
  type ProductFeedbackRepositoryFactory,
} from "../../application/feedback/ports";
import { submitFeedback } from "../../application/feedback/submit-feedback";
import { listFeedback } from "../../application/feedback/list-feedback";
import { voteFeedback } from "../../application/feedback/vote-feedback";
import {
  FeedbackIllegalTransitionError,
  FeedbackNotFoundError,
  FeedbackTriageForbiddenError,
  FeedbackTriageReasonRequiredError,
  triageFeedback,
} from "../../application/feedback/triage-feedback";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import { canTriage } from "../../domain/feedback/product-feedback";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const SUBMIT_FEEDBACK_SCHEMA = C.operations.submitFeedback.in;
export const VOTE_FEEDBACK_SCHEMA = C.operations.voteFeedback.in;
export const TRIAGE_FEEDBACK_SCHEMA = C.operations.triageFeedback.in;
export const LIST_FEEDBACK_SCHEMA = C.operations.listFeedback.in;

type SubmitBody = ReturnType<typeof C.operations.submitFeedback.in.parse>;
type VoteBody = ReturnType<typeof C.operations.voteFeedback.in.parse>;
type TriageBody = ReturnType<typeof C.operations.triageFeedback.in.parse>;

@Controller()
export class FeedbackController {
  constructor(
    @Inject(PRODUCT_FEEDBACK_REPOSITORY)
    private readonly feedback: ProductFeedbackRepositoryFactory,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
  ) {}

  /** 看的人在本组织的角色。null = 不是成员——`decideFeedbackDetailVisibility` 据此整条拒。 */
  private async viewerRole(principal: Principal) {
    const membership = await this.identity.findOrgMembership(principal.userId, principal.orgId);
    return { orgRole: membership?.orgRole ?? null, teamId: membership?.teamId ?? null };
  }

  @HttpCode(HttpStatus.CREATED)
  @Post("/feedback")
  async submit(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(SUBMIT_FEEDBACK_SCHEMA)) body: SubmitBody,
  ) {
    assertPrincipal(principal);
    const repo = this.feedback.forOrg(principal.orgId);
    return submitFeedback(
      { repo, newFeedbackId: () => randomUUID(), newEventId: () => randomUUID() },
      {
        // ⚠ 提交人从 principal 取，**不从请求体**。契约的 `in` 里根本没有这个字段，
        //   所以这不是「传了会被忽略」——是传不进来。
        submittedBy: principal.userId,
        kind: body.kind,
        target: body.target,
        // 目标**当时**的名字由服务端在别处解析会更权威，但今天没有一个能同时解析
        // agent 与 skill 名字的端口。诚实的做法是先不填（null），而不是从 id 里编一个。
        targetLabel: null,
        title: body.title,
        detail: body.detail,
        occurredRoute: body.occurredRoute,
        appVersion: body.appVersion,
      },
    );
  }

  @Get("/feedback")
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query("scope") scopeKind: string | undefined,
    @Query("targetKind") targetKind: string | undefined,
    @Query("targetId") targetId: string | undefined,
  ) {
    assertPrincipal(principal);
    const scope = parseScope(scopeKind, targetKind, targetId);
    // 组装回契约形状再校验——见文件头。orgId 从 principal 来，不从 query。
    const parsed = LIST_FEEDBACK_SCHEMA.safeParse({ orgId: String(principal.orgId), scope });
    if (!parsed.success) throw new BadRequestException("validation_failed");

    const { orgRole, teamId } = await this.viewerRole(principal);
    const items = await listFeedback(
      {
        repo: this.feedback.forOrg(principal.orgId),
        newDecisionId: () => this.decisions.next(),
      },
      { scope, viewerId: principal.userId, viewerOrgRole: orgRole, viewerTeamId: teamId },
    );
    return { items };
  }

  @Get("/feedback/counts")
  async counts(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const { orgRole } = await this.viewerRole(principal);
    // ⚠ 计数是**分诊面板**的数字，不是给所有人看的。标题可见 ≠ 全局统计可见：
    //   一个非管理员知道「本周 40 条待处理」没有任何用处，而它泄露的是团队的处理节奏。
    if (!canTriage(orgRole)) throw new ForbiddenException({ reasonCode: "PERMISSION_REVOKED" });
    return this.feedback.forOrg(principal.orgId).counts();
  }

  @HttpCode(HttpStatus.OK)
  @Post("/feedback/:feedbackId/vote")
  async vote(
    @CurrentPrincipal() principal: Principal,
    @Param("feedbackId") feedbackId: string,
    @Body(new ZodBodyPipe(VOTE_FEEDBACK_SCHEMA)) body: VoteBody,
  ) {
    assertPrincipal(principal);
    try {
      return await voteFeedback(
        { repo: this.feedback.forOrg(principal.orgId) },
        // ⚠ 用 **path** 的 feedbackId，不用请求体里那个（同 message-rating.controller 的理由）：
        //   路径是资源的地址，请求体里那份只是契约 `in` 的形状要求。
        { feedbackId, voterId: principal.userId, voted: body.voted },
      );
    } catch (e) {
      if (e instanceof FeedbackNotFoundError) throw new NotFoundException({ reasonCode: "FEEDBACK_NOT_FOUND" });
      throw e;
    }
  }

  @Put("/feedback/:feedbackId/status")
  async triage(
    @CurrentPrincipal() principal: Principal,
    @Param("feedbackId") feedbackId: string,
    @Body(new ZodBodyPipe(TRIAGE_FEEDBACK_SCHEMA)) body: TriageBody,
  ) {
    assertPrincipal(principal);
    const { orgRole } = await this.viewerRole(principal);
    try {
      return await triageFeedback(
        { repo: this.feedback.forOrg(principal.orgId), newEventId: () => randomUUID() },
        {
          feedbackId,
          status: body.status,
          reason: body.reason,
          actorId: principal.userId,
          actorOrgRole: orgRole,
        },
      );
    } catch (e) {
      if (e instanceof FeedbackTriageForbiddenError) {
        throw new ForbiddenException({ reasonCode: "PERMISSION_REVOKED" });
      }
      if (e instanceof FeedbackNotFoundError) {
        throw new NotFoundException({ reasonCode: "FEEDBACK_NOT_FOUND" });
      }
      if (e instanceof FeedbackTriageReasonRequiredError) {
        throw new UnprocessableEntityException({ reasonCode: "TRIAGE_REASON_REQUIRED" });
      }
      if (e instanceof FeedbackIllegalTransitionError) {
        // ⚠ 回的是**当前状态与目标状态**，不是一句「不允许」。分诊的人看到
        //   「已修复 → 不做 不是一条边」才知道该先退回待处理；只说不允许他会重试。
        throw new UnprocessableEntityException({
          reasonCode: "ILLEGAL_TRANSITION",
          from: e.from,
          to: e.to,
        });
      }
      throw e;
    }
  }
}

/**
 * 把拍平的 query 组装回判别联合。
 *
 * ⚠ 缺省是 `org` 而不是 `mine`：不带参数地读 `/feedback` 最自然的语义是
 *   「这个组织的反馈」。缺省成 `mine` 会让一个忘了带参数的调用悄悄只看到自己的，
 *   而那看起来像「组织里只有我提过反馈」。
 * ⚠ 认不出来的 `scope` 值**不静默退回缺省**——退回缺省时 `?scope=mien`（拼错）
 *   会返回全组织的反馈，而调用方以为自己拿到的是「我的」。
 */
export function parseScope(
  scopeKind: string | undefined,
  targetKind: string | undefined,
  targetId: string | undefined,
): FeedbackScope {
  if (scopeKind === undefined || scopeKind === "org") return { kind: "org" };
  if (scopeKind === "mine") return { kind: "mine" };
  if (scopeKind === "target") {
    if (targetKind === "product") return { kind: "target", target: { kind: "product" } };
    if (targetKind === "agent" && targetId) {
      return { kind: "target", target: { kind: "agent", agentId: targetId } };
    }
    if (targetKind === "skill" && targetId) {
      return { kind: "target", target: { kind: "skill", skillId: targetId } };
    }
    throw new BadRequestException("validation_failed");
  }
  throw new BadRequestException("validation_failed");
}
