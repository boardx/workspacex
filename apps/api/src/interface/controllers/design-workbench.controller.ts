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
 *   201  新建（`POST /design-projects` 创建了一行资源）。
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
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import { designWorkbench as C } from "@repo/contracts";
import { randomUUID } from "node:crypto";
import { createProject } from "../../application/design-workbench/create-project";
import { listMyProjects } from "../../application/design-workbench/list-my-projects";
import { updateProject } from "../../application/design-workbench/update-project";
import { appendProjectChat } from "../../application/design-workbench/append-project-chat";
import { deleteProject } from "../../application/design-workbench/delete-project";
import { pushToInbox } from "../../application/design-workbench/push-to-inbox";
import {
  DESIGN_PROJECT_REPOSITORY,
  type DesignProjectRepositoryFactory,
} from "../../application/design-workbench/project-ports";
import {
  DesignProjectNameRequiredError,
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  type DesignProjectDeps,
} from "../../application/design-workbench/project-shared";
import { FEEDBACK_SUBMITTER_DIRECTORY, type FeedbackSubmitterDirectory } from "../../application/feedback/notification-ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const CREATE_PROJECT_SCHEMA = C.operations.createProject.in;
export const UPDATE_PROJECT_SCHEMA = C.operations.updateProject.in.omit({ projectId: true });
export const APPEND_PROJECT_CHAT_SCHEMA = C.operations.appendProjectChat.in.omit({ projectId: true });
export const PUSH_TO_INBOX_SCHEMA = C.operations.pushToInbox.in.omit({ projectId: true });

type CreateProjectBody = ReturnType<typeof CREATE_PROJECT_SCHEMA.parse>;
type UpdateProjectBody = ReturnType<typeof UPDATE_PROJECT_SCHEMA.parse>;
type AppendProjectChatBody = ReturnType<typeof APPEND_PROJECT_CHAT_SCHEMA.parse>;
type PushToInboxBody = ReturnType<typeof PUSH_TO_INBOX_SCHEMA.parse>;

/** 六条路由共用的错误映射——同 `mapDraftError` 的形状与理由（见 `feedback.controller.ts`）。 */
function mapProjectError(e: unknown): Error | null {
  if (e instanceof DesignProjectNotFoundError) return new NotFoundException({ reasonCode: "PROJECT_NOT_FOUND" });
  if (e instanceof DesignProjectNotOwnerError) return new ForbiddenException({ reasonCode: "NOT_PROJECT_OWNER" });
  if (e instanceof DesignProjectNameRequiredError) return new UnprocessableEntityException({ reasonCode: "NAME_REQUIRED" });
  return null;
}

@Controller()
export class DesignWorkbenchController {
  constructor(
    @Inject(DESIGN_PROJECT_REPOSITORY) private readonly projects: DesignProjectRepositoryFactory,
    @Inject(FEEDBACK_SUBMITTER_DIRECTORY) private readonly submitterDirectory: FeedbackSubmitterDirectory,
  ) {}

  private deps(principal: Principal): DesignProjectDeps {
    return {
      projects: this.projects.forOrg(principal.orgId),
      orgId: toOrgId(principal.orgId),
      submitters: this.submitterDirectory,
    };
  }

  @HttpCode(HttpStatus.CREATED)
  @Post("/design-projects")
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
        },
      );
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  @Get("/design-projects")
  async list(@CurrentPrincipal() principal: Principal, @Query("q") q: string | undefined) {
    assertPrincipal(principal);
    const items = await listMyProjects(this.deps(principal), { ownerId: principal.userId, q });
    return { items };
  }

  @Patch("/design-projects/:projectId")
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
      });
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  @Post("/design-projects/:projectId/chat")
  async appendChat(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(APPEND_PROJECT_CHAT_SCHEMA)) body: AppendProjectChatBody,
  ) {
    assertPrincipal(principal);
    try {
      return await appendProjectChat(this.deps(principal), { projectId, ownerId: principal.userId, text: body.text });
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  @Delete("/design-projects/:projectId")
  async remove(@CurrentPrincipal() principal: Principal, @Param("projectId") projectId: string) {
    assertPrincipal(principal);
    try {
      return await deleteProject(this.deps(principal), { projectId, ownerId: principal.userId });
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }

  @Post("/design-projects/:projectId/push")
  async push(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(PUSH_TO_INBOX_SCHEMA)) body: PushToInboxBody,
  ) {
    assertPrincipal(principal);
    try {
      return await pushToInbox(this.deps(principal), { projectId, ownerId: principal.userId, note: body.note });
    } catch (e) {
      throw mapProjectError(e) ?? e;
    }
  }
}
