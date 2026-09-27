/**
 * B2-S5（#4429）—— 设置页「AI 权限」的两条路由，协议适配，判断全在 `application`：
 *
 *   GET /projects/:projectId/ai-settings   读（项目成员，含观察者）
 *   PUT /projects/:projectId/ai-settings   整体替换（引导师，或组织 lead / admin）
 *
 * 路径取自契约 `project.operations.*.path`（符号化，不手抄第二份）。`orgId` 取自
 * `principal.orgId`——同 `overview` / `updateTags` 的形状，契约 `in` 里没有 `orgId` 字段。
 * 拒绝面与同束其它路由同型：`AUTH_SERVICE_UNAVAILABLE` → 503（判定服务不可用不是一个裁定），其余 → 403。
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Put,
  ServiceUnavailableException,
} from "@nestjs/common";
import { project as C } from "@repo/contracts";
import type { z } from "zod";
import { DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository } from "../../application/identity/ports";
import { ProjectError } from "../../application/project/errors";
import { getProjectAiSettings, type ProjectAiSettingsOutput } from "../../application/project/get-project-ai-settings";
import { PROJECT_AI_SETTINGS_REPOSITORY, type ProjectAiSettingsRepository } from "../../application/project/project-ai-settings-ports";
import { updateProjectAiSettings } from "../../application/project/update-project-ai-settings";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const GET_PROJECT_AI_SETTINGS_SCHEMA = C.operations.getProjectAiSettings.in;
export const UPDATE_PROJECT_AI_SETTINGS_SCHEMA = C.operations.updateProjectAiSettings.in;

type GetInput = z.infer<typeof GET_PROJECT_AI_SETTINGS_SCHEMA>;
type UpdateInput = z.infer<typeof UPDATE_PROJECT_AI_SETTINGS_SCHEMA>;

function rethrow(e: unknown): never {
  if (e instanceof ProjectError) {
    if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
      throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
    }
    throw new ForbiddenException({ reasonCode: e.reasonCode });
  }
  throw e;
}

@Controller()
export class ProjectAiSettingsController {
  constructor(
    @Inject(PROJECT_AI_SETTINGS_REPOSITORY) private readonly repo: ProjectAiSettingsRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
  ) {}

  @Get(C.operations.getProjectAiSettings.path)
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
  ): Promise<ProjectAiSettingsOutput> {
    assertPrincipal(principal);
    // GET 没有 body，契约的 `in` 照样要过一遍——同 `overview` 路由的理由。
    const input = new ZodBodyPipe(GET_PROJECT_AI_SETTINGS_SCHEMA).transform({ projectId }) as GetInput;
    try {
      return await getProjectAiSettings(
        { repo: this.repo, auth: { repo: this.identity, ids: this.decisions } },
        { userId: principal.userId, orgId: principal.orgId, projectId: input.projectId },
      );
    } catch (e) {
      rethrow(e);
    }
  }

  @Put(C.operations.updateProjectAiSettings.path)
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body() rawBody: unknown,
  ): Promise<ProjectAiSettingsOutput> {
    assertPrincipal(principal);
    // `projectId` 来自路径、`allowedSources` 来自 body，合并后一起过契约（同 `updateTags`）。
    const body = (rawBody ?? {}) as { allowedSources?: unknown };
    const input = new ZodBodyPipe(UPDATE_PROJECT_AI_SETTINGS_SCHEMA).transform({
      projectId,
      allowedSources: body.allowedSources,
    }) as UpdateInput;
    try {
      return await updateProjectAiSettings(
        { repo: this.repo, identity: this.identity },
        { actorId: principal.userId, orgId: principal.orgId, projectId: input.projectId, allowedSources: input.allowedSources },
      );
    } catch (e) {
      rethrow(e);
    }
  }
}
