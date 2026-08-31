/**
 * `board` 契约束的 HTTP 面（F02/F06 首次接线；F01 的状态机本身刻意没有 controller，
 * 见 `apps/api/src/application/board/change-task-status.ts` 头注）。
 *
 * 路由：
 *   GET   /tasks?scope=project|global&projectId=...   -- F02 列表 + 三处计数
 *   POST  /tasks                                       -- F02 手工建卡
 *   PATCH /tasks/:id/status                             -- F01 状态机 + F02 回写事务
 *   GET   /tasks/today                                   -- F06 我的今天
 *
 * R5 权限：观察者（observer）对看板与「我的今天」一律 403，不是空列表——同
 * `plan-control.controller.ts` 的既有纪律（可见性判定在 controller 前置，不是在
 * repository 查完之后才发现"其实不该给"）。
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { changeTaskStatusWithWriteback } from "../../application/board/change-task-status-with-writeback";
import { createTask, CreateTaskRejectedError } from "../../application/board/create-task";
import { getMyToday } from "../../application/board/get-my-today";
import { listTasks } from "../../application/board/list-tasks";
import { TASK_REPOSITORY, TASK_STATUS_AUDIT_WRITER, type TaskRepository, type TaskStatusAuditWriter } from "../../application/board/ports";
import { ManualSourceWriteback } from "../../application/board/writeback-port";
import { IllegalTransitionError, TaskNotFoundError } from "../../application/board/errors";
import { DATABASE_PORT, type DatabasePort } from "../../application/ports/database.port";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import type { ProjectRole } from "../../domain/identity/roles";
import { CurrentPrincipal } from "../current-principal.decorator";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";

/** 项目经理/引导师视角——见 R5「可见本项目全部卡」。本仓的 `ProjectRole` 没有单独的
 *  「项目经理」值，`facilitator` 是它在本表里最接近的落点；组织层 `admin`/`lead` 同样
 *  给到不受组限制的全项目可见性（与既有 `authorize.ts` 里"org 层已经先判过"的分层一致）。*/
function isPrivilegedBoardRole(projectRole: ProjectRole | null, orgRole: string | null): boolean {
  return projectRole === "facilitator" || orgRole === "admin" || orgRole === "lead";
}

const manualWriteback = new ManualSourceWriteback();

@Controller()
export class BoardController {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepository,
    @Inject(TASK_STATUS_AUDIT_WRITER) private readonly audit: TaskStatusAuditWriter,
    @Inject(DATABASE_PORT) private readonly db: DatabasePort,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
  ) {}

  /** Resolves the caller's board-visibility role for one project. Observer -> throw 403. */
  private async resolveProjectRole(
    orgId: ReturnType<typeof toOrgId>,
    userId: string,
    projectId: string,
  ): Promise<{ role: ProjectRole | "org-wide-admin"; groupId: string | null }> {
    const [org, membership] = await Promise.all([
      this.identity.findOrgMembership(userId, orgId),
      this.identity.findProjectMembership(userId, projectId, orgId),
    ]);
    if (membership === null) throw new ForbiddenException("NO_PROJECT_ROLE");
    if (membership.projectRole === "observer") throw new ForbiddenException("OBSERVER_CANNOT_VIEW_BOARD");
    const privileged = isPrivilegedBoardRole(membership.projectRole, org?.orgRole ?? null);
    return { role: privileged ? "org-wide-admin" : membership.projectRole, groupId: membership.groupId };
  }

  @Get("/tasks")
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query("scope") rawScope: string | undefined,
    @Query("projectId") projectId: string | undefined,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const scope = rawScope === "global" ? "global" : "project";
    if (scope === "project" && !projectId) throw new BadRequestException("PROJECT_ID_REQUIRED_FOR_PROJECT_SCOPE");

    // 全局视图（跨项目五列）本次实现为"当前项目的全局五列投影"，不做跨项目大合并——
    // uc-11-1 全局视图与「我的今天」的跨项目聚合是两件事（本视图仍然限定在 projectId
    // 之内，只是不折叠 inbox 列）；真正的"看全部项目的全局看板"需要一个项目选择器/
    // 多项目聚合 UI，F02 notes 已经点名 needs_ui_signoff，本次没有对应界面，接口保持
    // 诚实：不接收 projectId 时会用 400 拒绝，而不是悄悄返回全组织所有任务。
    if (!projectId) throw new BadRequestException("PROJECT_ID_REQUIRED");
    const { role, groupId } = await this.resolveProjectRole(orgId, principal.userId, projectId);

    return listTasks(
      { db: this.db, tasks: this.tasks },
      { orgId, userId: principal.userId, scope, projectId, role, groupId, now: new Date() },
    );
  }

  @Get("/tasks/today")
  async myToday(@CurrentPrincipal() principal: Principal, @Query("projectId") projectId: string | undefined) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    // 「我的今天」跨项目聚合（R2），但仍需要至少一个已知项目来判定"是不是观察者"——
    // 本次实现取调用方传入的 `projectId`（前端可以传用户当前所在的任一项目）作为角色
    // 判定的锚点；真正的多项目角色求并集留给 F04（筛选与我的待办）落地时一起做，
    // 这里先诚实地要求一个 projectId，不猜。
    if (!projectId) throw new BadRequestException("PROJECT_ID_REQUIRED");
    const { role, groupId } = await this.resolveProjectRole(orgId, principal.userId, projectId);
    return getMyToday({ db: this.db, tasks: this.tasks }, { orgId, userId: principal.userId, role, groupId, now: new Date() });
  }

  @Post("/tasks")
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: {
      projectId?: string | null;
      title: string;
      ownerUserId: string;
      executor?: string | null;
      dueAt?: string | null;
      riskLevel?: string | null;
      waitingOn?: string | null;
      status?: string;
    },
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    if (body.projectId) {
      // Manual creation still respects "observer cannot touch the board" -- reuse the
      // same role resolution; any non-observer role may create (R7 does not restrict
      // WHO may create, only that the fields are valid).
      await this.resolveProjectRole(orgId, principal.userId, body.projectId);
    }
    try {
      return await createTask(
        { db: this.db, tasks: this.tasks },
        {
          orgId,
          projectId: body.projectId ?? null,
          title: body.title,
          ownerUserId: body.ownerUserId,
          executor: body.executor ?? null,
          dueAt: body.dueAt ?? null,
          riskLevel: body.riskLevel ?? null,
          waitingOn: body.waitingOn ?? null,
          status: body.status,
        },
      );
    } catch (e) {
      if (e instanceof CreateTaskRejectedError) throw new HttpException({ reasonCode: e.code }, 422);
      throw e;
    }
  }

  @Patch("/tasks/:id/status")
  async changeStatus(
    @CurrentPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body() body: { toStatus: string; reason?: string | null; sameProjectScope?: boolean },
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    try {
      return await changeTaskStatusWithWriteback(
        { db: this.db, tasks: this.tasks, audit: this.audit, writeback: manualWriteback },
        {
          orgId,
          taskId: id,
          actorId: principal.userId,
          toStatus: body.toStatus,
          reason: body.reason ?? null,
          sameProjectScope: body.sameProjectScope,
          // 手工创建的卡是本次唯一的写路径产出——回写走 no-op 适配器（见 writeback-port.ts）。
          sourceKind: "手工创建",
        },
      );
    } catch (e) {
      if (e instanceof TaskNotFoundError) throw new HttpException({ reasonCode: e.code }, 404);
      if (e instanceof IllegalTransitionError) throw new HttpException({ reasonCode: e.code }, 422);
      throw e;
    }
  }
}
