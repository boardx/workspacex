/**
 * UC-17.8 B4.3 —— `design-workbench` 束的六条路由。
 *
 * ## 为什么是独立 controller
 *
 * 同 `inbox.controller.ts` 的理由：设计项目的主语是「设计项目」,不是反馈——挂到
 * `FeedbackController`（已经 750+ 行,`AGENTS.md` 的 2000 行硬上限也不该被这种无关依赖
 * 推着往上走）只会让那个文件替一个与反馈本身无关的资源背依赖。
 *
 * ## 状态码
 *
 *   201  新建（`POST /pm-designs` 创建了一行资源）。
 *   200  读 / 改 / 追加对话 / 推送。
 *   403  `NOT_PROJECT_OWNER`——项目对请求者**可见**（全组织可读），只是改不了/删不了/推不了/
 *        发不了消息。⚠ 与 404 分开，同 `FeedbackController` 对 `PERMISSION_REVOKED` 的理由：
 *        对一条你看得见的项目返回 404 只会让人以为它被删了。
 *   404  `PROJECT_NOT_FOUND`——项目本身不存在（或不在本组织,同一码）。
 *   422  `NAME_REQUIRED`——请求体形状合法,但正文规则不合法（同 `DRAFT_EMPTY` 不用 400 的理由）。
 */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  BadRequestException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  UnprocessableEntityException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { designWorkbench as C } from "@repo/contracts";
import { randomUUID } from "node:crypto";
import { createProject } from "../../application/design-workbench/create-project";
import { generateIntakeQuestions } from "../../application/design-workbench/intake-questions";
import { listMyProjects } from "../../application/design-workbench/list-my-projects";
import { updateProject } from "../../application/design-workbench/update-project";
import { appendProjectChat } from "../../application/design-workbench/append-project-chat";
import { PrototypePatchRejectedError, patchPrototype } from "../../application/design-workbench/patch-prototype";
import {
  PrototypeVersionNotFoundError,
  getPrototypeVersion,
  listPrototypeVersions,
  restorePrototypeVersion,
} from "../../application/design-workbench/prototype-versions";
import { deleteProject } from "../../application/design-workbench/delete-project";
import { pushToInbox } from "../../application/design-workbench/push-to-inbox";
import {
  createDesignGithubIssue,
  DesignIssueAlreadyExistsError,
  DesignIssueCreationFailedError,
  DesignIssueInProgressError,
  DesignProjectNotPushedError,
} from "../../application/design-workbench/create-design-github-issue";
import { GITHUB_ISSUE_CREATOR, type GithubIssueCreator } from "../../application/feedback/notification-ports";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { TRANSACTIONAL_MAIL_TRANSPORT, type TransactionalMailTransport } from "../../application/notifications/transactional-mail-ports";
import {
  DESIGN_PROJECT_REPOSITORY,
  type DesignProjectRepositoryFactory,
} from "../../application/design-workbench/project-ports";
import {
  RefImageRejectedError,
  deleteRefImage,
  loadRefImageBytes,
  uploadRefImage,
} from "../../application/design-workbench/ref-images";
import {
  DESIGN_REF_IMAGE_REPOSITORY,
  type DesignRefImageRepositoryFactory,
} from "../../application/design-workbench/ref-image-ports";
import { OBJECT_STORE, ObjectStoreUnavailableError, type ObjectStore } from "../../application/artifact/ports";
import {
  DesignProjectNameRequiredError,
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  loadProjectView,
  type DesignProjectDeps,
} from "../../application/design-workbench/project-shared";
import { FEEDBACK_SUBMITTER_DIRECTORY, type FeedbackSubmitterDirectory } from "../../application/feedback/notification-ports";
import { MODEL_CALL_PORT, type ModelCallPort } from "../../application/agent-run/ports";
import {
  FEEDBACK_STRUCTURE_MODEL_CONFIG,
  type FeedbackStructureModelConfig,
} from "../../application/feedback/structure-feedback-draft";
import { ModelDesignChatReplier } from "../../application/design-workbench/design-chat-model";
import { traceIdOf } from "../middleware/trace";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const CREATE_PROJECT_SCHEMA = C.operations.createProject.in;
export const INTAKE_QUESTIONS_SCHEMA = C.operations.intakeQuestions.in;
type IntakeQuestionsBody = ReturnType<typeof INTAKE_QUESTIONS_SCHEMA.parse>;
export const UPDATE_PROJECT_SCHEMA = C.operations.updateProject.in.omit({ projectId: true });
export const APPEND_PROJECT_CHAT_SCHEMA = C.operations.appendProjectChat.in.omit({ projectId: true });
export const PATCH_PROTOTYPE_SCHEMA = C.operations.patchPrototype.in.omit({ projectId: true });
type PatchPrototypeBody = ReturnType<typeof PATCH_PROTOTYPE_SCHEMA.parse>;
export const PUSH_TO_INBOX_SCHEMA = C.operations.pushToInbox.in.omit({ projectId: true });
export const CREATE_DESIGN_GITHUB_ISSUE_SCHEMA = C.operations.createDesignGithubIssue.in.omit({ projectId: true });
type CreateDesignGithubIssueBody = ReturnType<typeof CREATE_DESIGN_GITHUB_ISSUE_SCHEMA.parse>;

type CreateProjectBody = ReturnType<typeof CREATE_PROJECT_SCHEMA.parse>;
type UpdateProjectBody = ReturnType<typeof UPDATE_PROJECT_SCHEMA.parse>;
type AppendProjectChatBody = ReturnType<typeof APPEND_PROJECT_CHAT_SCHEMA.parse>;
type PushToInboxBody = ReturnType<typeof PUSH_TO_INBOX_SCHEMA.parse>;

/** 六条路由共用的错误映射——同 `mapDraftError` 的形状与理由（见 `feedback.controller.ts`）。 */
function mapProjectError(e: unknown): Error | null {
  if (e instanceof DesignProjectNotFoundError) return new NotFoundException({ reasonCode: "PROJECT_NOT_FOUND" });
  if (e instanceof DesignProjectNotOwnerError) return new ForbiddenException({ reasonCode: "NOT_PROJECT_OWNER" });
  if (e instanceof PrototypeVersionNotFoundError) return new NotFoundException({ reasonCode: "VERSION_NOT_FOUND" });
  if (e instanceof PrototypePatchRejectedError) {
    return new BadRequestException({ reasonCode: "PROTOTYPE_PATCH_REJECTED", patchReason: e.reason, ...(e.nodeId !== undefined ? { nodeId: e.nodeId } : {}) });
  }
  if (e instanceof DesignProjectNameRequiredError) return new UnprocessableEntityException({ reasonCode: "NAME_REQUIRED" });
  // 2026-09-05「转开发」——四个错误码的 HTTP 语义：
  //   · 未推送 = 请求本身在当前状态下不合法（前置条件不满足）⇒ 409，不是 422：
  //     输入形状没问题，是这个方案还不到能转开发的时候。
  //   · 已有 issue / 并发认领 = 资源当前状态与请求冲突 ⇒ 409（同 feedback 那侧的
  //     `FeedbackIssueInProgressError` 映射）。
  //   · GitHub 建失败 = 下游不可用 ⇒ 503，与 `DEPENDENCY_UNAVAILABLE` 同一类。
  if (e instanceof DesignProjectNotPushedError) return new ConflictException({ reasonCode: "PROJECT_NOT_PUSHED" });
  if (e instanceof DesignIssueAlreadyExistsError) return new ConflictException({ reasonCode: "DESIGN_ISSUE_ALREADY_EXISTS" });
  if (e instanceof DesignIssueInProgressError) return new ConflictException({ reasonCode: "DESIGN_ISSUE_IN_PROGRESS" });
  if (e instanceof DesignIssueCreationFailedError) {
    return new ServiceUnavailableException({ reasonCode: "DESIGN_ISSUE_CREATION_FAILED" });
  }
  return null;
}

@Controller()
export class DesignWorkbenchController {
  constructor(
    @Inject(DESIGN_PROJECT_REPOSITORY) private readonly projects: DesignProjectRepositoryFactory,
    @Inject(FEEDBACK_SUBMITTER_DIRECTORY) private readonly submitterDirectory: FeedbackSubmitterDirectory,
    // B6.3：`pushToInbox` 的「已生成设计方案」邮件——同 `feedback.controller.ts` 分诊邮件用的两个端口。
    @Inject(TRANSACTIONAL_MAIL_TRANSPORT) private readonly mail: TransactionalMailTransport,
    // UC-17.8 B5.2：对话回复用的模型端口——同 `feedback.controller.ts` 草稿那条链的同一个
    // `ModelCallPort` + 同一份 `FEEDBACK_STRUCTURE_MODEL_CONFIG`，不另配。
    @Inject(MODEL_CALL_PORT) private readonly modelCall: ModelCallPort,
    @Inject(FEEDBACK_STRUCTURE_MODEL_CONFIG) private readonly chatModel: FeedbackStructureModelConfig,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
    // 2026-09-05「转开发」——与 `feedback.controller.ts` 建 issue 用的是同一个端口实现，不另配。
    @Inject(GITHUB_ISSUE_CREATOR) private readonly githubIssues: GithubIssueCreator,
    // 迭代 13：参考图——元信息仓储 + 字节的对象存储，与反馈附件用的是同一个 `ObjectStore`。
    @Inject(DESIGN_REF_IMAGE_REPOSITORY) private readonly refImages: DesignRefImageRepositoryFactory,
    @Inject(OBJECT_STORE) private readonly objectStore: ObjectStore,
  ) {}

  private designChat(): ModelDesignChatReplier {
    return new ModelDesignChatReplier({
      model: this.modelCall,
      chatModel: this.chatModel,
      log: (message, detail) => this.logger.info(message, { ...detail, traceId: "design-workbench-chat" }),
    });
  }

  private refImageDeps(principal: Principal) {
    return { ...this.deps(principal), store: this.objectStore, refImages: this.refImages.forOrg(principal.orgId) };
  }

  private deps(principal: Principal): DesignProjectDeps {
    return {
      projects: this.projects.forOrg(principal.orgId),
      orgId: toOrgId(principal.orgId),
      submitters: this.submitterDirectory,
      mail: this.mail,
      logger: this.logger,
    };
  }

  /**
   * 迭代 13：按一句 brief 生成澄清问题。**不落库、不建项目**。
   * ⚠ 路由要排在 `POST /pm-designs` **之前**——Nest 按声明顺序匹配，
   * 反过来的话这条静态子路径会被上面那条吃掉。
   */
  @Post("/pm-designs/intake-questions")
  async intakeQuestions(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(INTAKE_QUESTIONS_SCHEMA)) body: IntakeQuestionsBody,
  ) {
    assertPrincipal(principal);
    // 从不抛：模型不可用时回退通用六问并把 fallback 置真（见用例头注）。
    return await generateIntakeQuestions(
      { model: this.modelCall, chatModel: this.chatModel, log: (m, f) => this.logger.info(m, { ...f, traceId: "design-workbench-intake" }) },
      { brief: body.brief },
    );
  }

  @HttpCode(HttpStatus.CREATED)
  @Post("/pm-designs")
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(CREATE_PROJECT_SCHEMA)) body: CreateProjectBody,
  ) {
    assertPrincipal(principal);
    try {
      return await createProject(
        { ...this.deps(principal), newProjectId: () => randomUUID() },
        {
          ownerId: principal.userId,
          name: body.name,
          template: body.template,
          problem: body.problem,
          linkedFeedbackId: body.linkedFeedbackId,
          intake: body.intake,
          successQuestions: (body.intake ?? []).map((a) => a.question),
        },
      );
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  @Get("/pm-designs")
  async list(@CurrentPrincipal() principal: Principal, @Query("q") q: string | undefined) {
    assertPrincipal(principal);
    const items = await listMyProjects(this.deps(principal), { ownerId: principal.userId, q });
    return { items };
  }

  @Patch("/pm-designs/:projectId")
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(UPDATE_PROJECT_SCHEMA)) body: UpdateProjectBody,
  ) {
    assertPrincipal(principal);
    try {
      return await updateProject(this.deps(principal), {
        projectId,
        ownerId: principal.userId,
        name: body.name,
        template: body.template,
        problem: body.problem,
        theme: body.theme,
      });
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  @Post("/pm-designs/:projectId/chat")
  async appendChat(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(APPEND_PROJECT_CHAT_SCHEMA)) body: AppendProjectChatBody,
  ) {
    assertPrincipal(principal);
    try {
      /**
       * 迭代 13：这一轮要带上的参考图**字节**在这里取。前端传来的 id 不可信——
       * `loadRefImageBytes` 只认确实属于这个项目的那些（见其头注）。
       * 取不到字节的跳过而不是整轮失败：少一张参考图不该让这次对话作废。
       */
      const refImages = await loadRefImageBytes(
        { store: this.objectStore, refImages: this.refImages.forOrg(principal.orgId) },
        projectId,
        body.refImageIds ?? [],
      );
      return await appendProjectChat(
        { ...this.deps(principal), ai: this.designChat() },
        {
          projectId, ownerId: principal.userId, text: body.text,
          ...(body.focusNodeId !== undefined ? { focusNodeId: body.focusNodeId } : {}),
          ...(refImages.length > 0 ? { refImages } : {}),
        },
      );
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  /* ── 迭代 5：人直接改画布 ── */

  @Post("/pm-designs/:projectId/prototype/patch")
  async patchPrototype(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(PATCH_PROTOTYPE_SCHEMA)) body: PatchPrototypeBody,
  ) {
    assertPrincipal(principal);
    try {
      return await patchPrototype(this.deps(principal), { projectId, ownerId: principal.userId, ops: body.ops, ...(body.summary !== undefined ? { summary: body.summary } : {}) });
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  /* ── 迭代 3：原型版本历史 ── */

  @Get("/pm-designs/:projectId/versions")
  async listVersions(@CurrentPrincipal() principal: Principal, @Param("projectId") projectId: string) {
    assertPrincipal(principal);
    try {
      return await listPrototypeVersions(this.deps(principal), { projectId });
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  @Get("/pm-designs/:projectId/versions/:versionId")
  async getVersion(@CurrentPrincipal() principal: Principal, @Param("projectId") projectId: string, @Param("versionId") versionId: string) {
    assertPrincipal(principal);
    try {
      return await getPrototypeVersion(this.deps(principal), { projectId, versionId });
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  @Post("/pm-designs/:projectId/versions/:versionId/restore")
  async restoreVersion(@CurrentPrincipal() principal: Principal, @Param("projectId") projectId: string, @Param("versionId") versionId: string) {
    assertPrincipal(principal);
    try {
      return await restorePrototypeVersion(this.deps(principal), { projectId, ownerId: principal.userId, versionId });
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  @Delete("/pm-designs/:projectId")
  async remove(@CurrentPrincipal() principal: Principal, @Param("projectId") projectId: string) {
    assertPrincipal(principal);
    try {
      return await deleteProject(this.deps(principal), { projectId, ownerId: principal.userId });
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  @Post("/pm-designs/:projectId/push")
  async push(
    @Req() req: unknown,
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(PUSH_TO_INBOX_SCHEMA)) body: PushToInboxBody,
  ) {
    assertPrincipal(principal);
    try {
      // B6.4：只有推送事务记日志（见 push-to-inbox.ts 文件头），logger/traceId 只在这一条路由上挂。
      return await pushToInbox(
        { ...this.deps(principal), logger: this.logger, traceId: traceIdOf(req) },
        { projectId, ownerId: principal.userId, note: body.note },
      );
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  /* ── 迭代 13：参考图（delta `design-chat-inputs` §1）── */

  /**
   * `multipart/form-data`，同 `feedback.controller.ts` 的附件上传：`file` 字段是二进制，
   * `contentType` 字段是声明的类型。声明只用来**对照**字节，不作数——真正判类型的是
   * magic byte（用例层 `sniffDeclaredType`）。
   *
   * 400 `REF_IMAGE_REJECTED` 带 `rejectReason`（TYPE / SIZE / TOO_MANY）：三种情形合成
   * 一个错误码，因为屏上给用户的下一步是同一句话「换一张图」；`rejectReason` 让文案能说得更准。
   */
  @HttpCode(HttpStatus.CREATED)
  @Post("/pm-designs/:projectId/ref-images")
  @UseInterceptors(
    FileInterceptor("file", {
      // ⚠ multer 这道限只是**先挡一手**，省得 4MB 以上的字节全读进内存才被拒。
      //   真正的判定在用例层（同一个契约常量），multer 这里放宽一点以免它先于用例层
      //   用一个没有 reasonCode 的 500 把请求打掉。
      limits: { fileSize: C.PROTOTYPE_REF_IMAGE_MAX_BYTES + 1024, files: 1 },
    }),
  )
  async uploadRefImage(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined,
    @Body("contentType") contentType: string | undefined,
  ) {
    assertPrincipal(principal);
    if (!file || typeof contentType !== "string") {
      throw new BadRequestException({ reasonCode: "REF_IMAGE_REJECTED", rejectReason: "TYPE" });
    }
    try {
      const { image } = await uploadRefImage(this.refImageDeps(principal), {
        orgId: toOrgId(principal.orgId),
        projectId,
        ownerId: principal.userId,
        name: file.originalname ?? "参考图",
        declaredContentType: contentType,
        bytes: new Uint8Array(file.buffer),
      });
      return { image, project: await loadProjectView(this.deps(principal), projectId) };
    } catch (e) {
      if (e instanceof RefImageRejectedError) {
        throw new BadRequestException({ reasonCode: "REF_IMAGE_REJECTED", rejectReason: e.reason });
      }
      if (e instanceof ObjectStoreUnavailableError) {
        throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
      }
      throw mapProjectError(e) ?? e;
    }
  }

  @Delete("/pm-designs/:projectId/ref-images/:imageId")
  async deleteRefImage(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Param("imageId") imageId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await deleteRefImage(this.refImageDeps(principal), { projectId, ownerId: principal.userId, imageId });
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  @Post("/pm-designs/:projectId/github-issue")
  async createGithubIssue(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(CREATE_DESIGN_GITHUB_ISSUE_SCHEMA)) body: CreateDesignGithubIssueBody,
  ) {
    assertPrincipal(principal);
    try {
      return await createDesignGithubIssue(
        { ...this.deps(principal), logger: this.logger, githubIssues: this.githubIssues },
        { projectId, ownerId: principal.userId, draft: body.draft },
      );
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }
}
