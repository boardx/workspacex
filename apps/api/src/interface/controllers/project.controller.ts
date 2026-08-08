/**
 * F117 / F122 的两条路由（UC-P1 / UC-P2）。协议适配，判断全在 `application`。
 *
 *   POST /projects   建一个容器（受全局 Guard 保护）
 *   GET  /projects   两段式列表（F122，UC-P2）：`{ member, managed }`
 *
 * ## `GET /projects` 的 `orgId` 从 query 来，不从 `principal.orgId` 来
 *
 * 与 `createProject` 同一条理由：`orgId` 不是授权依据，用例拿它去查
 * **调用者在该组织的角色**，查不到就当非管理者处理（`managed` 段为 `[]`）。
 * 之所以不直接用会话里的「当前组织」，是因为契约 `listProjects.in` 显式收
 * `orgId` 这个字段——两个来源打架时（前端在多组织间来回切换但会话还没落定），
 * 让 query 参数赢，与 `createProject.in.orgId` 同型。
 *
 * ## 🔴 这里**没有**第二条创建路由，那是本 feature 的交付物之一
 *
 * Q-1 裁 C：一条创建路径 + 蓝本可选参数。三类容器**不各开一条**
 * （`POST /workshops` / `POST /research-projects` / …），空白新建也**不另开一条**。
 * 理由与 `addProjectMember` 那条「两个入口共用同一个用例」逐字相同：
 * 另开一个接口意味着不变量要写两遍，**漏掉的那一遍不会有任何东西报警**。
 * `tests/project/create-project-atomic-two-rows.test.ts` 里两条断言把它变成会红的东西
 * （唯一的路由 + 唯一的 `INSERT INTO projects` 写点）。
 *
 * ## `orgId` 从 body 来，不从路径来
 *
 * 契约 `createProject.path` 是 `/projects`，`in` 里带 `orgId` —— 与 `inviteOrgMember`
 * 那条（路径参数 + body 回声）形状不同，所以这里没有「路径参数赢」的取舍。
 * ⚠ 但 `orgId` 仍然**不是**授权依据：用例拿它去查**调用者在该组织的角色**，
 *   查不到或不是 `lead` 一律 `ORG_ROLE_INSUFFICIENT`。请求体里写谁都改不了这一点。
 *
 * ## `provenanceEventId` 不在响应体里
 *
 * 契约 `createProject.out` 要求它，而 `ProvenanceEventType` 里没有「项目已创建」
 * 这个类型（契约自己登记的 `KNOWN_CONTRACT_GAPS.P3`）。编一个 id 让响应体好看，
 * 等于宣称写了一条审计而审计里什么都没有。理由与不选边的判断写在
 * `application/project/create-project.ts` 的文件头，并已报给签核人。
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { project as C, orgAdmin as OA } from "@repo/contracts";
import type { z } from "zod";
import { createProject } from "../../application/project/create-project";
import { listProjects } from "../../application/project/list-projects";
import { renderRoleView } from "../../application/project/render-role-view";
import { previewAsRole } from "../../application/project/preview-as-role";
import { advanceAgendaSegment } from "../../application/project/advance-agenda-segment";
import { createAgendaSegment } from "../../application/project/create-agenda-segment";
import {
  AgendaSegmentNotFoundError,
  MergeTargetRequiredError,
} from "../../application/project/advance-agenda-segment-errors";
import { getProjectOverview } from "../../application/project/get-project-overview";
import { archiveProject } from "../../application/project/archive-project";
import { unarchiveProject } from "../../application/project/unarchive-project";
import { addProjectMember } from "../../application/project/add-project-member";
import { changeProjectRole } from "../../application/project/change-project-role";
import { removeProjectMember } from "../../application/project/remove-project-member";
import {
  ProjectArchiveBlockedByActiveSegmentError,
  ProjectError,
  ProjectMemberAlreadyExistsError,
} from "../../application/project/errors";
import {
  AGENDA_SEGMENT_REPOSITORY,
  PROJECT_ARCHIVE_REPOSITORY,
  PROJECT_LIST_REPOSITORY,
  PROJECT_OVERVIEW_REPOSITORY,
  PROJECT_REPOSITORY,
  type AgendaSegmentRepository,
  type ProjectArchiveRepository,
  type ProjectListRepository,
  type ProjectOverviewRepository,
  type ProjectRepository,
} from "../../application/project/ports";
import {
  MEMBER_SUBJECT_RESOLVER,
  PROJECT_MEMBERSHIP_REPOSITORY,
  type MemberSubjectResolver,
  type ProjectMembershipRepository,
} from "../../application/project/member-ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type IdentityRepository,
  type DecisionIdFactory,
} from "../../application/identity/ports";
import { isProjectRole } from "../../domain/identity/roles";
import {
  BINDING_REPOSITORY,
  type BindingDeps,
  type BindingRepository,
} from "../../application/artifact/binding-ports";
import {
  ARTIFACT_REPOSITORY,
  ID_FACTORY,
  type ArtifactRepository,
  type IdFactory,
} from "../../application/artifact/ports";
import {
  PROVENANCE_WRITER,
  type ProvenanceWriter,
} from "../../application/provenance/ports";
import {
  TEMPORARY_GRANT_REPOSITORY,
  type TemporaryGrantRepository,
} from "../../application/identity/temporary-grant-ports";
import { CLOCK, type Clock } from "../../application/auth/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

/** 导出，供 `contract-single-source.test.ts` 断言与契约是**同一个对象**而非长得像。 */
export const CREATE_PROJECT_SCHEMA = C.operations.createProject.in;
/** 同上，`listProjects` 的入参契约。 */
export const LIST_PROJECTS_SCHEMA = C.operations.listProjects.in;
/** F04 —— `renderRoleView` / `previewAsRole` 属 `org-admin` 束，入参契约同一条纪律。 */
export const RENDER_ROLE_VIEW_SCHEMA = OA.operations.renderRoleView.in;
export const PREVIEW_AS_ROLE_SCHEMA = OA.operations.previewAsRole.in;
/** 同上，`advanceAgendaSegment` 的入参契约（F119）。 */
export const ADVANCE_AGENDA_SEGMENT_SCHEMA = C.operations.advanceAgendaSegment.in;

/** 直接取自契约的推断类型——`action` 因此是四值联合而不是裸 `string`（同 F119 domain 层）。 */
type AdvanceBody = z.infer<typeof C.operations.advanceAgendaSegment.in>;

/** #627，`createAgendaSegment` 的入参契约。 */
export const CREATE_AGENDA_SEGMENT_SCHEMA = C.operations.createAgendaSegment.in;
type CreateAgendaSegmentBody = z.infer<typeof C.operations.createAgendaSegment.in>;

/** 同上，`getProjectOverview` 的入参契约（F123）。 */
export const GET_PROJECT_OVERVIEW_SCHEMA = C.operations.getProjectOverview.in;
/** 同上，`archiveProject` / `unarchiveProject` 的入参契约（F124）。两者形状相同：`{ projectId }`。 */
export const ARCHIVE_PROJECT_SCHEMA = C.operations.archiveProject.in;
export const UNARCHIVE_PROJECT_SCHEMA = C.operations.unarchiveProject.in;
/** 同上，F125 三个成员操作的入参契约。 */
export const ADD_PROJECT_MEMBER_SCHEMA = C.operations.addProjectMember.in;
export const CHANGE_PROJECT_ROLE_SCHEMA = C.operations.changeProjectRole.in;
export const REMOVE_PROJECT_MEMBER_SCHEMA = C.operations.removeProjectMember.in;

type AddMemberBody = z.infer<typeof C.operations.addProjectMember.in>;
type ChangeRoleBody = z.infer<typeof C.operations.changeProjectRole.in>;

type CreateBody = {
  orgId: string;
  name: string;
  kind: string;
  blueprintVersionId: string | null;
};

@Controller()
export class ProjectController {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly repo: ProjectRepository,
    @Inject(PROJECT_LIST_REPOSITORY) private readonly listRepo: ProjectListRepository,
    @Inject(PROJECT_OVERVIEW_REPOSITORY) private readonly overviewRepo: ProjectOverviewRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
    @Inject(AGENDA_SEGMENT_REPOSITORY) private readonly segments: AgendaSegmentRepository,
    @Inject(PROJECT_ARCHIVE_REPOSITORY) private readonly archiveRepo: ProjectArchiveRepository,
    @Inject(PROJECT_MEMBERSHIP_REPOSITORY) private readonly members: ProjectMembershipRepository,
    @Inject(MEMBER_SUBJECT_RESOLVER) private readonly memberSubjects: MemberSubjectResolver,
    @Inject(BINDING_REPOSITORY) private readonly bindings: BindingRepository,
    @Inject(ARTIFACT_REPOSITORY) private readonly artifacts: ArtifactRepository,
    @Inject(ID_FACTORY) private readonly ids: IdFactory,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
    @Inject(TEMPORARY_GRANT_REPOSITORY) private readonly grants: TemporaryGrantRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * F123 只复用这一整套（`listBackflow` 要求完整的 `BindingDeps`），不新开一套
   * 「只带 bindings + auth」的窄类型——同 `ArtifactBindingController` 的 `deps` getter。
   */
  private get bindingDeps(): BindingDeps {
    return {
      bindings: this.bindings,
      artifacts: this.artifacts,
      auth: { repo: this.identity, ids: this.decisions },
      ids: this.ids,
      provenance: this.provenance,
    };
  }

  @Post("/projects")
  async create(
    @Body(new ZodBodyPipe(CREATE_PROJECT_SCHEMA)) body: CreateBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);

    try {
      const out = await createProject(
        { repo: this.repo, identity: this.identity },
        {
          orgId: toOrgId(body.orgId),
          actorId: principal.userId,
          name: body.name,
          kind: body.kind,
          blueprintVersionId: body.blueprintVersionId,
        },
      );
      // ⚠ `created` 不进响应体：契约的 `out` 是 `.strict()` 且不含它。它只是让幂等
      //   在测试里可断言（见 `application/project/ports.ts`）。把它暴露出去，
      //   前端就会拿「这次是不是新建」去分支，而重放在设计上就是不可观测的。
      return { id: out.id, kind: out.kind, status: out.status };
    } catch (e) {
      if (e instanceof ProjectError) {
        // ⚠ `INVALID_KIND` 在 HTTP 上**到不了这里**：`ZodBodyPipe` 会先用契约的
        //   三值闭集把它拦成字段级 400。留着这一支不是死代码——用例的 `kind` 收的是
        //   `string`，任何不经 HTTP 的调用方（脚本、未来的队列消费者）都走那道门，
        //   而它们抛出来的码必须与契约对得上。
        if (e.reasonCode === "INVALID_KIND") throw new BadRequestException({ reasonCode: e.reasonCode });
        if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
          // 503 而不是 403：判定服务不可用**不是**一个裁定。把它渲染成拒绝，
          // 用户会去找管理员要一个他本来就有的权限。
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  @Get("/projects")
  async list(
    @Query("orgId") orgId: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    // GET 没有 body，契约的 `in` 照样要过一遍——同 `backflow` 那条路由的理由：
    // 跳过它，`GET /projects` 就是唯一一个没有任何东西校验入参的操作。
    const input = new ZodBodyPipe(LIST_PROJECTS_SCHEMA).transform({ orgId }) as {
      orgId: string;
    };

    try {
      const out = await listProjects(
        { repo: this.listRepo, identity: this.identity },
        { orgId: toOrgId(input.orgId), actorId: principal.userId },
      );
      return out;
    } catch (e) {
      if (e instanceof ProjectError) {
        if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /**
   * F04 `RenderRoleView` —— 同一套屏按项目角色裁剪。
   *
   * ⚠ 契约 `err: []`：这条路由**永不 403/503**，无权限时也是 200 +
   * `allowed:false` 的 `decision`（见 `render-role-view.ts` 头部理由）。
   */
  @Get("/projects/:projectId/role-view")
  async roleView(
    @Param("projectId") projectId: string,
    @Query("orgId") orgId: string | undefined,
    @Query("screen") screen: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    const input = new ZodBodyPipe(RENDER_ROLE_VIEW_SCHEMA).transform({ projectId, orgId, screen }) as {
      projectId: string;
      orgId: string;
      screen: string;
    };
    return renderRoleView(
      { repo: this.identity, ids: this.decisions },
      {
        userId: principal.userId,
        orgId: toOrgId(input.orgId),
        projectId: input.projectId,
        screen: input.screen,
      },
    );
  }

  /**
   * F04 `PreviewAsRole` —— 视角切换器（引导师/项目负责人预览别人看到什么）。
   *
   * ⚠ I-30：切换视角不改数据，只改可见范围；预览态下全部写端点必须另经
   * `authorizeProjectWrite({ previewing: true })`，本路由本身不执行、也不暴露任何写操作。
   */
  @Get("/projects/:projectId/role-view/preview")
  async previewRoleView(
    @Param("projectId") projectId: string,
    @Query("screen") screen: string | undefined,
    @Query("asRole") asRole: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    // ⚠ 契约 `previewAsRole.in` **没有** `orgId` 字段（与 `renderRoleView` 不同形）：
    // orgId 取自会话里的 `principal.orgId`，不再走 query——这是签核契约本身的形状，不是本
    // 实现临时决定的。
    const input = new ZodBodyPipe(PREVIEW_AS_ROLE_SCHEMA).transform({ projectId, asRole }) as {
      projectId: string;
      asRole: string;
    };
    if (!isProjectRole(input.asRole)) {
      throw new BadRequestException({ reasonCode: "INVALID_ROLE" });
    }
    try {
      return await previewAsRole(
        { repo: this.identity, ids: this.decisions, provenance: this.provenance },
        {
          userId: principal.userId,
          orgId: principal.orgId,
          projectId: input.projectId,
          screen: screen ?? "project-workbench",
          asRole: input.asRole,
        },
      );
    } catch (e) {
      if (e instanceof ProjectError) {
        if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /**
   * F119 UC-P7：推进 / 提前结束 / 跳过 / 合并。`workshopId` 在超类型模型下与 `projectId`
   * 同值域（F116），鉴权仍走 `authorize({ object: { kind: "project", id: workshopId } })`——
   * 同 `bind-to-project-step` 一路复用「project」这个 object kind，不为工作坊另开一种。
   */
  @Post("/workshops/:workshopId/agenda-segments/:segmentId/advance")
  async advance(
    @CurrentPrincipal() principal: Principal,
    @Param("workshopId") workshopId: string,
    @Param("segmentId") segmentId: string,
    @Body(new ZodBodyPipe(ADVANCE_AGENDA_SEGMENT_SCHEMA)) body: AdvanceBody,
  ) {
    assertPrincipal(principal);
    // 同 `bind`/`upgrade` 的纪律：路径是资源，body 是契约校验的对象，两者不一致时
    // 不许静默择一——否则审计里记的可能不是调用者以为自己在动的那一条环节。
    if (body.workshopId !== workshopId || body.segmentId !== segmentId) {
      throw new BadRequestException("workshop_or_segment_id_mismatch");
    }

    try {
      const out = await advanceAgendaSegment(
        {
          auth: { repo: this.identity, ids: this.decisions },
          segments: this.segments,
          provenance: this.provenance,
          // F127: real storage layer for `revokedTemporaryGrants` -- see
          // `advance-agenda-segment.ts`'s header and `pg-temporary-grant-repository.ts`.
          grants: this.grants,
          clock: { now: () => this.clock.now().toISOString() },
        },
        {
          userId: principal.userId,
          orgId: principal.orgId,
          workshopId,
          segmentId,
          action: body.action,
          mergeIntoSegmentId: body.mergeIntoSegmentId,
        },
      );
      return out;
    } catch (e) {
      if (e instanceof AgendaSegmentNotFoundError) {
        // ⚠ 契约的 `err` 里没有专门的码——见 `advance-agenda-segment-errors.ts` 头注。
        throw new NotFoundException();
      }
      if (e instanceof MergeTargetRequiredError) {
        throw new BadRequestException("merge_requires_target");
      }
      if (e instanceof ProjectError) {
        if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        // 409，不是 403：这两个码是**状态冲突**（并发抢到同一个 active 名额 / 对终态
        // 再次操作），调用者的权限没有问题——同 `CANNOT_DOWNGRADE` 在 binding 控制器
        // 里的映射（`artifact-binding.controller.ts:213`）。
        if (e.reasonCode === "SEGMENT_ALREADY_ACTIVE" || e.reasonCode === "SEGMENT_TERMINAL") {
          throw new ConflictException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /**
   * #627 UC-P6：新建一条环节。契约 `path` 与 `advance` 同前缀，`workshopId` 走路径
   * 参数、其余字段走 body——`in.workshopId` 在契约里是必填的（`.strict()`），与
   * `advance` 的「路径/body 双写、必须一致」不同形：这里只有路径一个来源，
   * body 里的 `workshopId` 只是契约形状本身要求的回声字段，用路径值覆盖，不比对
   * 后 400——同 `bindTemplateToSegment` 的路径参数优先处理方式，没有第二个来源
   * 需要防「悄悄择一」。
   */
  @Post("/workshops/:workshopId/agenda-segments")
  async createSegment(
    @CurrentPrincipal() principal: Principal,
    @Param("workshopId") workshopId: string,
    @Body(new ZodBodyPipe(CREATE_AGENDA_SEGMENT_SCHEMA)) body: CreateAgendaSegmentBody,
  ) {
    assertPrincipal(principal);
    try {
      const segment = await createAgendaSegment(
        { auth: { repo: this.identity, ids: this.decisions }, segments: this.segments },
        {
          userId: principal.userId,
          orgId: principal.orgId,
          workshopId,
          agendaSegmentDefinitionId: body.agendaSegmentDefinitionId,
          ordinal: body.ordinal,
          title: body.title,
          duration: body.duration,
        },
      );
      return C.operations.createAgendaSegment.out.parse(segment);
    } catch (e) {
      if (e instanceof ProjectError) {
        if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /**
   * F123 / UC-P3。三态在这里映射成三种 HTTP 呈现，互不可混：
   *   200   正常返回（含空态——`backflow: []` / 四个角色计数为 0 都是合法的 200 体）
   *   403   `NO_PROJECT_ROLE` / `ADMIN_NOT_SUPERUSER`（分层无权限，两个不同的 reasonCode）
   *   503   `DEPENDENCY_UNAVAILABLE`（依赖失败——不得渲染成空列表，见用例文件头）
   */
  @Get("/projects/:projectId/overview")
  async overview(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
  ) {
    assertPrincipal(principal);
    // GET 没有 body，契约的 `in` 照样要过一遍——同 `list`/`backflow` 两条路由的理由。
    const input = new ZodBodyPipe(GET_PROJECT_OVERVIEW_SCHEMA).transform({ projectId }) as {
      projectId: string;
    };

    try {
      return await getProjectOverview(
        {
          repo: this.overviewRepo,
          auth: { repo: this.identity, ids: this.decisions },
          binding: this.bindingDeps,
        },
        {
          userId: principal.userId,
          orgId: principal.orgId,
          projectId: input.projectId,
        },
      );
    } catch (e) {
      if (e instanceof ProjectError) {
        if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE" || e.reasonCode === "DEPENDENCY_UNAVAILABLE") {
          // ⚠ 两者都是 503：判定服务不可用、以及本操作自己的依赖不可用，都不是一个
          //   裁定，渲染成 403 会让用户去找管理员要一个他本来就有的权限。
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /**
   * F124 UC-P4 `archiveProject`。`orgId` 取自 `principal.orgId`——同 `advance`/`overview`
   * 两条路由的形状，契约 `archiveProject.in` 本就只有 `{ projectId }`，没有 `orgId` 字段。
   *
   * ⚠ `active-segment-exists`（U-2⑵）落成一个**不带 `reasonCode` 的裸 400**——
   * 契约的 `archiveProject.err` 表达不了这个已裁定的失败（`KNOWN_CONTRACT_GAPS.P7`），
   * 见 `application/project/errors.ts` 的 `ProjectArchiveBlockedByActiveSegmentError`
   * 文件头。这不是本路由的疏漏，是已知、已报告的契约缺口。
   */
  @Post("/projects/:projectId/archive")
  async archive(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
  ) {
    assertPrincipal(principal);
    const input = new ZodBodyPipe(ARCHIVE_PROJECT_SCHEMA).transform({ projectId }) as {
      projectId: string;
    };

    try {
      return await archiveProject(
        { repo: this.archiveRepo, identity: this.identity },
        { orgId: principal.orgId, actorId: principal.userId, projectId: input.projectId },
      );
    } catch (e) {
      if (e instanceof ProjectArchiveBlockedByActiveSegmentError) {
        throw new BadRequestException();
      }
      if (e instanceof ProjectError) {
        if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /**
   * F124 UC-P4 `unarchiveProject`（U-2⑴ 裁 a：归档可逆，权限同归档者）。
   */
  @Post("/projects/:projectId/unarchive")
  async unarchive(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
  ) {
    assertPrincipal(principal);
    const input = new ZodBodyPipe(UNARCHIVE_PROJECT_SCHEMA).transform({ projectId }) as {
      projectId: string;
    };

    try {
      return await unarchiveProject(
        { repo: this.archiveRepo, identity: this.identity },
        { orgId: principal.orgId, actorId: principal.userId, projectId: input.projectId },
      );
    } catch (e) {
      if (e instanceof ProjectError) {
        if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /**
   * F125 UC-P9 `addProjectMember` —— 两个入口（`subject.kind: "orgUser" | "inviteToken"`）
   * 共用同一个 application 用例，见 `application/project/add-project-member.ts` 文件头。
   *
   * ⚠ `orgId` 取自 `principal.orgId`，同 `advance`/`overview`/`archive` 几条路由的形状——
   * 契约 `addProjectMember.in` 本就只有 `projectId`/`subject`/`projectRole`/`isHost`，
   * 没有 `orgId` 字段。
   */
  @Post("/projects/:projectId/members")
  async addMember(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Body(new ZodBodyPipe(ADD_PROJECT_MEMBER_SCHEMA)) body: AddMemberBody,
  ) {
    assertPrincipal(principal);
    if (body.projectId !== projectId) {
      throw new BadRequestException("project_id_mismatch");
    }

    try {
      return await addProjectMember(
        {
          identity: this.identity,
          members: this.members,
          resolver: this.memberSubjects,
          provenance: this.provenance,
        },
        {
          actorId: principal.userId,
          orgId: principal.orgId,
          projectId,
          subject: body.subject,
          projectRole: body.projectRole,
          isHost: body.isHost,
        },
      );
    } catch (e) {
      if (e instanceof ProjectMemberAlreadyExistsError) {
        // ⚠ 契约没有为「已经是成员」命名任何码——见该类文件头。落成一个不带码的 400。
        throw new BadRequestException();
      }
      if (e instanceof ProjectError) {
        if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /**
   * F125 UC-P9 `changeProjectRole`——下一次请求即生效（Q-4③），不缓存跨请求判定结论。
   */
  @Patch("/projects/:projectId/members/:userId")
  async changeMemberRole(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
    @Body(new ZodBodyPipe(CHANGE_PROJECT_ROLE_SCHEMA)) body: ChangeRoleBody,
  ) {
    assertPrincipal(principal);
    if (body.projectId !== projectId || body.userId !== userId) {
      throw new BadRequestException("project_or_user_id_mismatch");
    }

    try {
      return await changeProjectRole(
        { identity: this.identity, members: this.members, provenance: this.provenance },
        {
          actorId: principal.userId,
          orgId: principal.orgId,
          projectId,
          userId,
          projectRole: body.projectRole,
          isHost: body.isHost,
        },
      );
    } catch (e) {
      if (e instanceof ProjectError) {
        if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /**
   * F125 UC-P9 `removeProjectMember`。契约 `removeProjectMember.in` 是 `{ projectId, userId }`,
   * 两者都已在路径参数里,不需要额外的 body 回声比对（同 GET 路由用 query 参数过一遍契约
   * 校验的理由，这里两个字段都来自路径，直接构造后过校验）。
   */
  @Delete("/projects/:projectId/members/:userId")
  async removeMember(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
  ) {
    assertPrincipal(principal);
    REMOVE_PROJECT_MEMBER_SCHEMA.parse({ projectId, userId });

    try {
      return await removeProjectMember(
        { identity: this.identity, members: this.members, provenance: this.provenance },
        { actorId: principal.userId, orgId: principal.orgId, projectId, userId },
      );
    } catch (e) {
      if (e instanceof ProjectError) {
        if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }
}
