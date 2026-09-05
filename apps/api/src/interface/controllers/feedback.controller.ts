/**
 * FB-2 / FB-3 —— `feedback-loop` 束的路由（UC-17.8 B1 起含六条草稿路由）。
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
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { feedbackLoop as C } from "@repo/contracts";
import { randomUUID } from "node:crypto";
import {
  PRODUCT_FEEDBACK_REPOSITORY,
  type FeedbackScope,
  type ProductFeedbackRepositoryFactory,
} from "../../application/feedback/ports";
import {
  FEEDBACK_SUBMITTER_DIRECTORY,
  GITHUB_ISSUE_CREATOR,
  GITHUB_ISSUE_IMAGE_UPLOADER,
  type FeedbackSubmitterDirectory,
  type GithubIssueCreator,
  type GithubIssueImageUploader,
} from "../../application/feedback/notification-ports";
import { submitFeedback } from "../../application/feedback/submit-feedback";
import { listFeedback } from "../../application/feedback/list-feedback";
import { voteFeedback } from "../../application/feedback/vote-feedback";
import {
  FeedbackIllegalTransitionError,
  FeedbackIssueCreationFailedError,
  FeedbackIssueInProgressError,
  FeedbackNotFoundError,
  FeedbackTriageForbiddenError,
  FeedbackTriageReasonRequiredError,
  triageFeedback,
} from "../../application/feedback/triage-feedback";
import { FeedbackNoGithubIssueError } from "../../application/feedback/notification-ports";
import {
  FeedbackGithubIssueQueryFailedError,
  getFeedbackGithubIssue,
} from "../../application/feedback/get-feedback-github-issue";
import { listFeedbackEvents } from "../../application/feedback/list-feedback-events";
import {
  FeedbackCommentBodyRequiredError,
  FeedbackGithubCommentFailedError,
  commentOnFeedbackGithubIssue,
} from "../../application/feedback/comment-on-feedback-github-issue";
import {
  FEEDBACK_ATTACHMENT_REPOSITORY,
  type FeedbackAttachmentRepository,
} from "../../application/feedback/attachment-ports";
import {
  UploadFeedbackAttachmentError,
  uploadFeedbackAttachment,
} from "../../application/feedback/upload-feedback-attachment";
import {
  FeedbackAttachmentAccessDeniedError,
  FeedbackAttachmentNotFoundError,
  downloadFeedbackAttachment,
} from "../../application/feedback/download-feedback-attachment";
import {
  FEEDBACK_STRUCTURE_MODEL_CONFIG,
  FeedbackStructuringUnavailableError,
  structureFeedbackDraft,
  type FeedbackStructureModelConfig,
} from "../../application/feedback/structure-feedback-draft";
import {
  FEEDBACK_DRAFT_REPOSITORY,
  type FeedbackDraftRepositoryFactory,
} from "../../application/feedback/draft-ports";
import { FeedbackDetailNotVisibleError, deepenFeedback } from "../../application/feedback/deepen-feedback";
import {
  DESIGN_PROJECT_REPOSITORY,
  type DesignProjectRepositoryFactory,
} from "../../application/design-workbench/project-ports";
import {
  FeedbackDraftEmptyError,
  FeedbackDraftNotFoundError,
  type FeedbackDraftDeps,
} from "../../application/feedback/drafts/draft-shared";
import { createFeedbackDraft } from "../../application/feedback/drafts/create-feedback-draft";
import { listMyFeedbackDrafts } from "../../application/feedback/drafts/list-my-feedback-drafts";
import { countMyFeedbackDrafts } from "../../application/feedback/drafts/count-my-feedback-drafts";
import { updateFeedbackDraft } from "../../application/feedback/drafts/update-feedback-draft";
import { deleteFeedbackDraft } from "../../application/feedback/drafts/delete-feedback-draft";
import { submitFeedbackDraft } from "../../application/feedback/drafts/submit-feedback-draft";
import { ModelDraftRefiner } from "../../application/feedback/drafts/draft-refine-model";
import { MODEL_CALL_PORT, type ModelCallPort } from "../../application/agent-run/ports";
import { OBJECT_STORE, ObjectStoreUnavailableError, type ObjectStore } from "../../application/artifact/ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { TRANSACTIONAL_MAIL_TRANSPORT, type TransactionalMailTransport } from "../../application/notifications/transactional-mail-ports";
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
export const COMMENT_ON_FEEDBACK_GITHUB_ISSUE_SCHEMA = C.operations.commentOnFeedbackGithubIssue.in;
export const UPLOAD_FEEDBACK_ATTACHMENT_SCHEMA = C.operations.uploadFeedbackAttachment.in;
export const STRUCTURE_FEEDBACK_DRAFT_SCHEMA = C.operations.structureFeedbackDraft.in;
export const CREATE_FEEDBACK_DRAFT_SCHEMA = C.operations.createFeedbackDraft.in;
/** 路径参数 `draftId` 不在 body 里再传一次——`.omit()` 保留 `.strict()`，多传即 400（见 lint-body-path-param-leak）。 */
export const UPDATE_FEEDBACK_DRAFT_SCHEMA = C.operations.updateFeedbackDraft.in.omit({ draftId: true });

/**
 * multer 层的第一道类型过滤——**从契约派生**（`FeedbackAttachmentMime`），不是第二份白名单。
 * 它只看浏览器声明的 `Content-Type`，真正的字节校验在用例 `uploadFeedbackAttachment` 里；
 * 这里提前拒掉是省一次把 8MB 的 zip 读进内存再拒的开销，不是安全边界。
 */
const FEEDBACK_ATTACHMENT_MIMES: readonly string[] = C.FeedbackAttachmentMime.options;

type SubmitBody = ReturnType<typeof C.operations.submitFeedback.in.parse>;
type VoteBody = ReturnType<typeof C.operations.voteFeedback.in.parse>;
type TriageBody = ReturnType<typeof C.operations.triageFeedback.in.parse>;
type CommentOnGithubIssueBody = ReturnType<typeof C.operations.commentOnFeedbackGithubIssue.in.parse>;
type StructureFeedbackDraftBody = ReturnType<typeof C.operations.structureFeedbackDraft.in.parse>;
type CreateFeedbackDraftBody = ReturnType<typeof C.operations.createFeedbackDraft.in.parse>;
type UpdateFeedbackDraftBody = ReturnType<typeof UPDATE_FEEDBACK_DRAFT_SCHEMA.parse>;

@Controller()
export class FeedbackController {
  constructor(
    @Inject(PRODUCT_FEEDBACK_REPOSITORY)
    private readonly feedback: ProductFeedbackRepositoryFactory,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
    @Inject(GITHUB_ISSUE_CREATOR) private readonly githubIssues: GithubIssueCreator,
    @Inject(GITHUB_ISSUE_IMAGE_UPLOADER) private readonly githubImageUploader: GithubIssueImageUploader,
    @Inject(FEEDBACK_SUBMITTER_DIRECTORY) private readonly submitterDirectory: FeedbackSubmitterDirectory,
    @Inject(TRANSACTIONAL_MAIL_TRANSPORT) private readonly mail: TransactionalMailTransport,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
    @Inject(FEEDBACK_ATTACHMENT_REPOSITORY) private readonly attachments: FeedbackAttachmentRepository,
    @Inject(MODEL_CALL_PORT) private readonly modelCall: ModelCallPort,
    @Inject(FEEDBACK_STRUCTURE_MODEL_CONFIG) private readonly structureModel: FeedbackStructureModelConfig,
    @Inject(OBJECT_STORE) private readonly objectStore: ObjectStore,
    @Inject(FEEDBACK_DRAFT_REPOSITORY) private readonly drafts: FeedbackDraftRepositoryFactory,
    @Inject(DESIGN_PROJECT_REPOSITORY) private readonly designProjects: DesignProjectRepositoryFactory,
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
      {
        repo,
        newFeedbackId: () => randomUUID(),
        newEventId: () => randomUUID(),
        attachments: this.attachments,
        submitterDirectory: this.submitterDirectory,
        mail: this.mail,
        log: (message, detail) => this.logger.info(message, { ...detail, traceId: "feedback-submit" }),
      },
      {
        // ⚠ 提交人从 principal 取，**不从请求体**。契约的 `in` 里根本没有这个字段，
        //   所以这不是「传了会被忽略」——是传不进来。
        submittedBy: principal.userId,
        orgId: toOrgId(principal.orgId),
        kind: body.kind,
        target: body.target,
        // 目标**当时**的名字由服务端在别处解析会更权威，但今天没有一个能同时解析
        // agent 与 skill 名字的端口。诚实的做法是先不填（null），而不是从 id 里编一个。
        targetLabel: null,
        title: body.title,
        detail: body.detail,
        occurredRoute: body.occurredRoute,
        appVersion: body.appVersion,
        attachmentIds: body.attachmentIds,
        // UC-17.8 D1：`.optional()` 是契约层的向后兼容；用例层「没传」与「没填」是同一件事。
        structured: body.structured ?? null,
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
        attachments: this.attachments,
        orgId: toOrgId(principal.orgId),
        submitters: this.submitterDirectory,
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

  /**
   * UC-17.8 B4.4——「更复杂？去 PM 设计工作台深化」。契约 `design-workbench.ts` 的
   * `deepenFeedback`（路由挂在 `/feedback` 命名空间，用例在 `deepen-feedback.ts`，头注解释
   * 了为什么用例文件在 `feedback/` 目录而不在 `design-workbench/`）。
   * 201 新建了项目；200 命中了已有的深化结果（`out.created` 区分，两种情况调用方都跳同一个
   * `project.id` 的详情页，不需要按状态码分支）——所以这里**不**用 `@HttpCode` 固定状态码，
   * 按 `created` 现算，同 REST 对幂等创建的一般处理。
   */
  @Post("/feedback/:feedbackId/deepen")
  async deepen(
    @CurrentPrincipal() principal: Principal,
    @Param("feedbackId") feedbackId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertPrincipal(principal);
    const { orgRole, teamId } = await this.viewerRole(principal);
    try {
      const result = await deepenFeedback(
        {
          feedback: this.feedback.forOrg(principal.orgId),
          projects: this.designProjects.forOrg(principal.orgId),
          submitters: this.submitterDirectory,
          newDecisionId: () => this.decisions.next(),
          newProjectId: () => randomUUID(),
        },
        { feedbackId, viewerId: principal.userId, viewerOrgRole: orgRole, viewerTeamId: teamId },
      );
      res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
      return result;
    } catch (e) {
      if (e instanceof FeedbackNotFoundError) throw new NotFoundException({ reasonCode: "FEEDBACK_NOT_FOUND" });
      if (e instanceof FeedbackDetailNotVisibleError) throw new ForbiddenException({ reasonCode: "FEEDBACK_DETAIL_NOT_VISIBLE" });
      throw e;
    }
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
        {
          repo: this.feedback.forOrg(principal.orgId),
          newEventId: () => randomUUID(),
          githubIssues: this.githubIssues,
          submitterDirectory: this.submitterDirectory,
          mail: this.mail,
          logger: this.logger,
          imageUploader: this.githubImageUploader,
          attachments: this.attachments,
          objectStore: this.objectStore,
          newDecisionId: () => this.decisions.next(),
        },
        {
          feedbackId,
          orgId: toOrgId(principal.orgId),
          status: body.status,
          reason: body.reason,
          actorId: principal.userId,
          actorOrgRole: orgRole,
          // `.optional()` 在契约里是为了向后兼容旧调用方——这里把"没传"和"显式传 null"
          // 统一成同一个 null,用例层不需要关心这两者的区别(两者的意思都是"没有草稿")。
          issueDraft: body.issueDraft ?? null,
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
      if (e instanceof FeedbackIssueCreationFailedError) {
        // ⚠ fail closed(见 `triage-feedback.ts` 头注①):状态**没有**变,
        //   503 而不是 500——这是一个已知的、可重试的下游依赖故障,不是服务器错误。
        throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
      }
      if (e instanceof FeedbackIssueInProgressError) {
        // 409 而不是 503/500:这不是"下游依赖不可用",是"这件事正被别的请求同时
        // 处理"——语义上是并发冲突,重试前应该先刷新看看结果,而不是无脑重试。
        throw new ConflictException({ reasonCode: "ISSUE_CREATION_IN_PROGRESS" });
      }
      throw e;
    }
  }

  /**
   * 现查这条反馈挂着的 GitHub issue:开/关状态 + 关联它的 PR。**不落库**——见用例
   * `get-feedback-github-issue.ts` 头注。前端只在管理员真的展开一条反馈的 GitHub
   * 状态时才调这条。
   */
  @Get("/feedback/:feedbackId/github-issue")
  async githubIssue(@CurrentPrincipal() principal: Principal, @Param("feedbackId") feedbackId: string) {
    assertPrincipal(principal);
    const { orgRole } = await this.viewerRole(principal);
    try {
      return await getFeedbackGithubIssue(
        { repo: this.feedback.forOrg(principal.orgId), githubIssues: this.githubIssues },
        { feedbackId, actorId: principal.userId, actorOrgRole: orgRole },
      );
    } catch (e) {
      throw mapGithubIssueSideEffectError(e) ?? e;
    }
  }

  /**
   * 一条反馈完整的状态流水——含每一步"有没有真的发邮件通知提交人、发的是什么"。
   * 给后台看板的 detail 弹层用。见用例 `list-feedback-events.ts` 头注:与
   * `githubIssue` 同一条权限纪律(`canTriage`),不是"管理员 OR 提交人"。
   */
  @Get("/feedback/:feedbackId/events")
  async events(@CurrentPrincipal() principal: Principal, @Param("feedbackId") feedbackId: string) {
    assertPrincipal(principal);
    const { orgRole } = await this.viewerRole(principal);
    try {
      const events = await listFeedbackEvents(
        { repo: this.feedback.forOrg(principal.orgId) },
        { feedbackId, actorId: principal.userId, actorOrgRole: orgRole },
      );
      return {
        events: events.map((e) => ({
          id: e.id,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          reason: e.reason,
          actorId: e.actorId,
          notified: e.notified,
          emailSubject: e.emailSubject,
          emailText: e.emailText,
          createdAt: e.createdAt,
        })),
      };
    } catch (e) {
      if (e instanceof FeedbackTriageForbiddenError) throw new ForbiddenException({ reasonCode: "PERMISSION_REVOKED" });
      if (e instanceof FeedbackNotFoundError) throw new NotFoundException({ reasonCode: "FEEDBACK_NOT_FOUND" });
      throw e;
    }
  }

  /**
   * 管理员手动往这条反馈挂着的 GitHub issue 下面发一条评论。见用例
   * `comment-on-feedback-github-issue.ts` 头注:不是状态转移的副作用。
   */
  @HttpCode(HttpStatus.CREATED)
  @Post("/feedback/:feedbackId/github-issue/comments")
  async commentOnGithubIssue(
    @CurrentPrincipal() principal: Principal,
    @Param("feedbackId") feedbackId: string,
    @Body(new ZodBodyPipe(COMMENT_ON_FEEDBACK_GITHUB_ISSUE_SCHEMA)) body: CommentOnGithubIssueBody,
  ) {
    assertPrincipal(principal);
    const { orgRole } = await this.viewerRole(principal);
    try {
      return await commentOnFeedbackGithubIssue(
        { repo: this.feedback.forOrg(principal.orgId), githubIssues: this.githubIssues },
        { feedbackId, actorId: principal.userId, actorOrgRole: orgRole, body: body.body },
      );
    } catch (e) {
      if (e instanceof FeedbackCommentBodyRequiredError) {
        throw new UnprocessableEntityException({ reasonCode: "COMMENT_BODY_REQUIRED" });
      }
      throw mapGithubIssueSideEffectError(e) ?? e;
    }
  }

  /**
   * FB-5 —— 图片附件上传。`multipart/form-data`，同 `identity.controller.ts` 的
   * `uploadAvatar` 既有先例：`meta` 字段（JSON，须过 `UPLOAD_FEEDBACK_ATTACHMENT_SCHEMA`）
   * + `file` 字段（二进制）。这一步**不需要 `feedbackId`**——附件先落库成
   * `feedback_id IS NULL`，提交表单时才由 `submitFeedback` 认领（见用例头注）：
   * 用户可能先拍照/先说完话再填标题，上传必须先于「这条反馈存在」发生。
   */
  @HttpCode(HttpStatus.CREATED)
  @Post("/feedback/attachments")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
      fileFilter: (_req, file, cb) => cb(null, FEEDBACK_ATTACHMENT_MIMES.includes(file.mimetype)),
    }),
  )
  async uploadAttachment(
    @CurrentPrincipal() principal: Principal,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Body("meta") metaRaw: string | undefined,
  ) {
    assertPrincipal(principal);
    if (!file || !metaRaw) throw new BadRequestException({ reasonCode: "UNSUPPORTED_CONTENT_TYPE" });
    let meta: unknown;
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      throw new BadRequestException({ reasonCode: "UNSUPPORTED_CONTENT_TYPE" });
    }
    const parsed = UPLOAD_FEEDBACK_ATTACHMENT_SCHEMA.safeParse(meta);
    if (!parsed.success) {
      // 同 `uploadAvatar` 的既有分流：`meta.sizeBytes` 本身超过契约上限时 zod 在这一步
      // 就先拒了（服务端对**实际字节**的 `FILE_TOO_LARGE` 判断走不到），按失败字段分流
      // 而不是笼统地都报 `UNSUPPORTED_CONTENT_TYPE`。
      const tooLarge = parsed.error.issues.some((i) => i.path.includes("sizeBytes"));
      throw new BadRequestException({ reasonCode: tooLarge ? "FILE_TOO_LARGE" : "UNSUPPORTED_CONTENT_TYPE" });
    }
    try {
      return await uploadFeedbackAttachment(
        { store: this.objectStore, attachments: this.attachments },
        {
          orgId: toOrgId(principal.orgId),
          uploadedBy: principal.userId,
          declaredContentType: parsed.data.contentType,
          bytes: new Uint8Array(file.buffer),
        },
      );
    } catch (e) {
      if (e instanceof UploadFeedbackAttachmentError) {
        throw new BadRequestException({ reasonCode: e.reasonCode });
      }
      if (e instanceof ObjectStoreUnavailableError) {
        throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
      }
      throw e;
    }
  }

  /**
   * 附件字节的下载路由。权限判法见用例 `download-feedback-attachment.ts` 头注：
   * 与正文（`detail`）完全一致——D3，管理员 + 提交人。
   */
  @Get("/feedback/attachments/:attachmentId")
  async downloadAttachment(
    @CurrentPrincipal() principal: Principal,
    @Param("attachmentId") attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    assertPrincipal(principal);
    const { orgRole, teamId } = await this.viewerRole(principal);
    let found: { objectKey: string; contentType: string };
    try {
      found = await downloadFeedbackAttachment(
        {
          attachments: this.attachments,
          feedback: this.feedback.forOrg(principal.orgId),
          drafts: this.drafts,
          newDecisionId: () => this.decisions.next(),
        },
        {
          orgId: toOrgId(principal.orgId),
          attachmentId,
          viewerId: principal.userId,
          viewerOrgRole: orgRole,
          viewerTeamId: teamId,
        },
      );
    } catch (e) {
      if (e instanceof FeedbackAttachmentNotFoundError || e instanceof FeedbackNotFoundError) {
        res.status(404).end();
        return;
      }
      if (e instanceof FeedbackAttachmentAccessDeniedError) {
        res.status(403).end();
        return;
      }
      throw e;
    }
    const bytes = await this.objectStore.get(found.objectKey);
    if (bytes === null) {
      res.status(404).end();
      return;
    }
    // ⚠ 不带 `{ passthrough: true }`——理由同 `identity.controller.ts` 的
    // `downloadAvatar`：本路由自己接管响应生命周期，不让 Nest 把 Buffer 重新序列化。
    res.set("Content-Type", found.contentType);
    res.set("Cache-Control", "private, max-age=300");
    res.status(200).end(Buffer.from(bytes));
  }

  /**
   * FB-5 —— 把一段语音转录文字整理成结构化草稿（`{kind,title,detail}`），
   * 填进提交表单，人工再改再提交。见用例头注：模型调用失败在这里映射成 503，
   * 不静默降级——整理失败等于这次点击的唯一目的没有达成。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/feedback/structure-draft")
  async structureDraft(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(STRUCTURE_FEEDBACK_DRAFT_SCHEMA)) body: StructureFeedbackDraftBody,
  ) {
    assertPrincipal(principal);
    try {
      return await structureFeedbackDraft(
        {
          model: this.modelCall,
          structureModel: this.structureModel,
          log: (message, detail) => this.logger.info(message, { ...detail, traceId: "feedback-structure-draft" }),
        },
        { transcript: body.transcript },
      );
    } catch (e) {
      if (e instanceof FeedbackStructuringUnavailableError) {
        throw new ServiceUnavailableException({ reasonCode: "STRUCTURING_FAILED" });
      }
      throw e;
    }
  }

  /* ─────────── UC-17.8 B1 · 反馈草稿（提交人私有）─────────── */

  /**
   * 六条草稿路由共用的依赖——草稿仓储按组织构造，附件仓储按方法接 orgId（既有的两种形状）。
   * ⚠ owner 恒从 principal 取；契约 `in` 里没有 ownerId，传不进来。
   */
  /**
   * UC-17.8 B5.1：「继续完善」对话与提交时摘要用的模型端口——同 `structureDraft` 那条路由的
   * 同一个 `ModelCallPort` + 同一份 `FEEDBACK_STRUCTURE_MODEL_CONFIG`，不另配一套模型。
   */
  private draftRefiner(): ModelDraftRefiner {
    return new ModelDraftRefiner({
      model: this.modelCall,
      structureModel: this.structureModel,
      log: (message, detail) => this.logger.info(message, { ...detail, traceId: "feedback-draft-refine" }),
    });
  }

  private draftDeps(principal: Principal): FeedbackDraftDeps {
    return {
      drafts: this.drafts.forOrg(principal.orgId),
      attachments: this.attachments,
      orgId: toOrgId(principal.orgId),
    };
  }

  @HttpCode(HttpStatus.CREATED)
  @Post("/feedback/drafts")
  async createDraft(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(CREATE_FEEDBACK_DRAFT_SCHEMA)) body: CreateFeedbackDraftBody,
  ) {
    assertPrincipal(principal);
    return createFeedbackDraft(
      {
        ...this.draftDeps(principal),
        newDraftId: () => randomUUID(),
        log: (message, detail) => this.logger.info(message, { ...detail, traceId: "feedback-draft" }),
      },
      {
        ownerId: principal.userId,
        kind: body.kind,
        target: body.target,
        detail: body.detail,
        structured: body.structured,
        occurredRoute: body.occurredRoute,
        appVersion: body.appVersion,
        attachmentIds: body.attachmentIds,
      },
    );
  }

  @Get("/feedback/drafts")
  async listDrafts(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const items = await listMyFeedbackDrafts(this.draftDeps(principal), { ownerId: principal.userId });
    return { items };
  }

  /** ⚠ 声明在 `/feedback/drafts/:draftId` 之前——Nest 按声明顺序匹配，否则 `count` 会被当成一个 draftId。 */
  @Get("/feedback/drafts/count")
  async countDrafts(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    return countMyFeedbackDrafts({ drafts: this.drafts.forOrg(principal.orgId) }, { ownerId: principal.userId });
  }

  @Patch("/feedback/drafts/:draftId")
  async updateDraft(
    @CurrentPrincipal() principal: Principal,
    @Param("draftId") draftId: string,
    @Body(new ZodBodyPipe(UPDATE_FEEDBACK_DRAFT_SCHEMA)) body: UpdateFeedbackDraftBody,
  ) {
    assertPrincipal(principal);
    try {
      return await updateFeedbackDraft(
        { ...this.draftDeps(principal), now: () => new Date(), refine: this.draftRefiner() },
        {
          draftId,
          ownerId: principal.userId,
          kind: body.kind,
          detail: body.detail,
          structured: body.structured,
          appendChat: body.appendChat,
        },
      );
    } catch (e) {
      throw mapDraftError(e) ?? e;
    }
  }

  @Delete("/feedback/drafts/:draftId")
  async deleteDraft(@CurrentPrincipal() principal: Principal, @Param("draftId") draftId: string) {
    assertPrincipal(principal);
    try {
      return await deleteFeedbackDraft(
        {
          ...this.draftDeps(principal),
          log: (message, detail) => this.logger.info(message, { ...detail, traceId: "feedback-draft" }),
        },
        { draftId, ownerId: principal.userId },
      );
    } catch (e) {
      throw mapDraftError(e) ?? e;
    }
  }

  /** 201：同 `POST /feedback`——这条路由创建了一行反馈资源。 */
  @HttpCode(HttpStatus.CREATED)
  @Post("/feedback/drafts/:draftId/submit")
  async submitDraft(@CurrentPrincipal() principal: Principal, @Param("draftId") draftId: string) {
    assertPrincipal(principal);
    try {
      return await submitFeedbackDraft(
        {
          ...this.draftDeps(principal),
          refine: this.draftRefiner(),
          submit: {
            repo: this.feedback.forOrg(principal.orgId),
            newFeedbackId: () => randomUUID(),
            newEventId: () => randomUUID(),
            attachments: this.attachments,
            submitterDirectory: this.submitterDirectory,
            mail: this.mail,
            log: (message, detail) => this.logger.info(message, { ...detail, traceId: "feedback-submit" }),
          },
        },
        { draftId, ownerId: principal.userId },
      );
    } catch (e) {
      throw mapDraftError(e) ?? e;
    }
  }
}

/**
 * 草稿路由共用的错误映射（同 `mapGithubIssueSideEffectError` 的形状与理由）：
 *   404 `DRAFT_NOT_FOUND` —— 不存在**或不是你的**（草稿私有，同 404 非 403 纪律）。
 *   422 `DRAFT_EMPTY`     —— 形状合法、与当前内容的关系不合法（同 `TRIAGE_REASON_REQUIRED` 不用 400 的理由）。
 */
function mapDraftError(e: unknown): Error | null {
  if (e instanceof FeedbackDraftNotFoundError) return new NotFoundException({ reasonCode: "DRAFT_NOT_FOUND" });
  if (e instanceof FeedbackDraftEmptyError) return new UnprocessableEntityException({ reasonCode: "DRAFT_EMPTY" });
  return null;
}

/**
 * `githubIssue` / `commentOnGithubIssue` 共用的错误映射——两条路由除了各自专属的
 * 错误(评论的 `COMMENT_BODY_REQUIRED`)之外,其余四种失败形状完全一样,写两遍
 * 就是把同一张映射表拆成两份、改一处另一处不知道跟。
 *
 * ⚠ 认不出来的错误返回 `null`,调用方原样 `throw e`——**不**在这里拿
 *   `String(e)` 兜底拼一个新 `Error`(`lint-error-leak.mjs` 会拦这个形状):
 *   那等于把原始异常的细节字符串化之后塞进一个新对象,原始的 `stack`/`cause`
 *   丢了,而且这条路径本来就该交给全局异常过滤器按未知错误处理、记日志。
 */
function mapGithubIssueSideEffectError(e: unknown): Error | null {
  if (e instanceof FeedbackTriageForbiddenError) return new ForbiddenException({ reasonCode: "PERMISSION_REVOKED" });
  if (e instanceof FeedbackNotFoundError) return new NotFoundException({ reasonCode: "FEEDBACK_NOT_FOUND" });
  if (e instanceof FeedbackNoGithubIssueError) return new NotFoundException({ reasonCode: "NO_GITHUB_ISSUE" });
  if (e instanceof FeedbackGithubIssueQueryFailedError || e instanceof FeedbackGithubCommentFailedError) {
    return new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
  }
  return null;
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
