/**
 * `plan-control` 契约束的 HTTP 面（F977 首次接线只挂了 UC-1 `getPlanLedger`）。
 *
 * ⚠ 本 PR 补的部分——issue 描述："把 copilotkit-v2-panel 接到 plan-control" 时发现
 * `usecases.md`/`packages/contracts/src/plan-control.ts` 里 UC-3…UC-10、UC-13 全部
 * 已经写好、也在 `apps/api/tests/plan-control/*.test.ts` 里被真实测过——但只在测试文件
 * 里手工 `new` 依赖直接调用应用层函数，从没有一条 `@Post` 路由、也没有对应的 DI
 * provider（`PLAN_RUN_CREATOR`/`ENGINE_RUN_CONTROLLER` 此前未在 `kernel.module.ts`
 * 绑定）。这是一处「设计假设与现有机制对不上」——F972-F978 的 issue 正文写的是「后端
 * 能力已完整」，实测只有读面完整。这里按 `usecases.md` 已经定好的 method/path/in/out/err
 * 补齐 controller 层（纯路由 + 错误码映射 + 可见性/写权前置），不改契约形状、不改
 * 应用层任何一个已测过的函数。
 *
 * 可见性判定复用 `resolveVisibility`（`chat` 束 UC-0 的唯一实现）——与 `getThread`、
 * `chat.controller.ts` 的 `createMessage` 同一条门，不第二次发明。
 */
import {
  Body, Controller, ForbiddenException, Get, HttpException, Inject, NotFoundException, Optional, Param, Post, Query,
} from "@nestjs/common";
import { MODEL_CALL_PORT, type ModelCallPort } from "../../application/agent-run/ports";
import { INTERJECTION_STORE, type InterjectionStore } from "../../application/agent-run/interjection-store";
import { getThread, ThreadNotVisibleError } from "../../application/chat/get-thread";
import { resolveVisibility } from "../../application/chat/resolve-visibility";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY } from "../../application/identity/ports";
import type { IdentityRepository, DecisionIdFactory } from "../../application/identity/ports";
import { getPlanLedger } from "../../application/plan-control/get-plan-ledger";
import {
  PLAN_LEDGER_REPOSITORY, PLAN_RUN_STATUS_READER,
  type PlanLedgerRepository, type PlanRunStatusReader,
} from "../../application/plan-control/ports";
import { PLAN_RUN_CREATOR, type PlanRunCreator } from "../../application/plan-control/plan-run-creator-port";
import {
  ENGINE_RUN_CONTROLLER, type EngineRunController,
} from "../../application/plan-control/engine-run-controller-port";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../application/provenance/ports";
import { DATABASE_PORT, type DatabasePort } from "../../application/ports/database.port";
import { reorderPlanStep } from "../../application/plan-control/reorder-plan-step";
import { deletePlanStep } from "../../application/plan-control/delete-plan-step";
import { addPlanConstraint } from "../../application/plan-control/add-plan-constraint";
import { removePlanConstraint } from "../../application/plan-control/remove-plan-constraint";
import { confirmPlan } from "../../application/plan-control/confirm-plan";
import { pausePlanRun } from "../../application/plan-control/pause-plan-run";
import { resumePlanRun } from "../../application/plan-control/resume-plan-run";
import { retryPlanStep } from "../../application/plan-control/retry-plan-step";
import { PlanEditError, type PlanEditErrorCode } from "../../application/plan-control/plan-edit-errors";
import { CurrentPrincipal } from "../current-principal.decorator";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";

@Controller()
export class PlanControlController {
  constructor(
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(PLAN_LEDGER_REPOSITORY) private readonly planLedger: PlanLedgerRepository,
    @Inject(PLAN_RUN_STATUS_READER) private readonly runs: PlanRunStatusReader,
    @Inject(PLAN_RUN_CREATOR) private readonly runCreator: PlanRunCreator,
    @Inject(ENGINE_RUN_CONTROLLER) private readonly engine: EngineRunController,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
    @Inject(DATABASE_PORT) private readonly db: DatabasePort,
    @Optional() @Inject(INTERJECTION_STORE) private readonly interjections?: InterjectionStore,
    @Optional() @Inject(MODEL_CALL_PORT) private readonly model?: ModelCallPort,
  ) {}

  private get visibilityDeps() {
    return { repo: this.repo, ids: this.ids, chat: this.chat };
  }

  private get planEditDeps() {
    return { db: this.db, repo: this.planLedger, runs: this.runs };
  }

  /** UC-1 `getPlanLedger`。零计划是正常态（I-1）：不存在账本 ≠ 404，`getThread` 只判「这条
   * 线程本身看不看得见」，通过之后一律走 `getPlanLedger` 的「零计划」出参，不在这里分岔。 */
  @Get("/plan-control/threads/:threadId/ledger")
  async ledger(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Query("projectId") rawProjectId?: string,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const projectId = rawProjectId === undefined || rawProjectId === "" ? null : rawProjectId;
    try {
      await getThread(
        { chat: this.chat, repo: this.repo, ids: this.ids },
        { userId: principal.userId, orgId, projectId, threadId },
      );
    } catch (e) {
      // 不可见与不存在同一个出口，同 `chat.controller.ts` 的既有纪律（I-3）。
      if (e instanceof ThreadNotVisibleError) throw new NotFoundException();
      throw e;
    }
    return getPlanLedger(this.planLedger, this.runs, { orgId, threadId });
  }

  /**
   * B/C/D 组写操作的共同前置：可见性（NOT_VISIBLE→404）+ 写权（观察者→403 NO_WRITE_ROLE）+
   * 归档（→409 THREAD_ARCHIVED_READONLY）。与 `getThread`/`createMessage` 同一个
   * `resolveVisibility`，不第二次实现「谁能写」。
   */
  private async assertWritable(
    principal: Principal, threadId: string, rawProjectId?: string,
  ): Promise<void> {
    const orgId = toOrgId(principal.orgId);
    const projectId = rawProjectId === undefined || rawProjectId === "" ? null : rawProjectId;
    const outcome = await resolveVisibility(this.visibilityDeps, {
      userId: principal.userId, orgId, projectId, threadId,
    });
    if (outcome.kind !== "allow") throw new NotFoundException();
    if (outcome.actor.projectRole === "observer") throw new ForbiddenException("NO_WRITE_ROLE");
    if (outcome.thread.archived) {
      throw new HttpException({ reasonCode: "THREAD_ARCHIVED_READONLY" }, 409);
    }
  }

  @Post("/plan-control/threads/:threadId/steps/reorder")
  async reorder(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body() body: { basedOnRevision: number; planStepId: string; toIndex: number },
    @Query("projectId") projectId?: string,
  ) {
    assertPrincipal(principal);
    await this.assertWritable(principal, threadId, projectId);
    return this.runPlanEdit(() => reorderPlanStep(this.planEditDeps, this.provenance, {
      orgId: toOrgId(principal.orgId), threadId, actorId: principal.userId,
      basedOnRevision: body.basedOnRevision, planStepId: body.planStepId, toIndex: body.toIndex,
    }));
  }

  @Post("/plan-control/threads/:threadId/steps/delete")
  async delete(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body() body: { basedOnRevision: number; planStepId: string },
    @Query("projectId") projectId?: string,
  ) {
    assertPrincipal(principal);
    await this.assertWritable(principal, threadId, projectId);
    return this.runPlanEdit(() => deletePlanStep(this.planEditDeps, this.provenance, {
      orgId: toOrgId(principal.orgId), threadId, actorId: principal.userId,
      basedOnRevision: body.basedOnRevision, planStepId: body.planStepId,
    }));
  }

  @Post("/plan-control/threads/:threadId/constraints")
  async addConstraint(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body() body: { basedOnRevision: number; planStepId: string; text: string },
    @Query("projectId") projectId?: string,
  ) {
    assertPrincipal(principal);
    await this.assertWritable(principal, threadId, projectId);
    return this.runPlanEdit(() => addPlanConstraint(this.planEditDeps, this.provenance, {
      orgId: toOrgId(principal.orgId), threadId, actorId: principal.userId,
      basedOnRevision: body.basedOnRevision, planStepId: body.planStepId, text: body.text,
    }));
  }

  @Post("/plan-control/threads/:threadId/constraints/remove")
  async removeConstraint(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body() body: { basedOnRevision: number; constraintId: string },
    @Query("projectId") projectId?: string,
  ) {
    assertPrincipal(principal);
    await this.assertWritable(principal, threadId, projectId);
    return this.runPlanEdit(() => removePlanConstraint(this.planEditDeps, this.provenance, {
      orgId: toOrgId(principal.orgId), threadId, actorId: principal.userId,
      basedOnRevision: body.basedOnRevision, constraintId: body.constraintId,
    }));
  }

  @Post("/plan-control/threads/:threadId/confirm")
  async confirm(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body() body: { basedOnRevision: number },
    @Query("projectId") projectId?: string,
  ) {
    assertPrincipal(principal);
    await this.assertWritable(principal, threadId, projectId);
    const orgId = toOrgId(principal.orgId);
    return this.runPlanEdit(() => confirmPlan(
      {
        repo: this.planLedger, runCreator: this.runCreator,
        appendAudit: (input) => this.provenance.append({
          orgId, actorId: input.actorId, type: "human-edited",
          target: { kind: "thread", id: threadId }, detail: input.detail,
        }),
      },
      { orgId, threadId, actorId: principal.userId, basedOnRevision: body.basedOnRevision },
    ));
  }

  @Post("/plan-control/threads/:threadId/runs/pause")
  async pause(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Query("projectId") projectId?: string,
  ) {
    assertPrincipal(principal);
    await this.assertWritable(principal, threadId, projectId);
    return this.runPlanEdit(() => pausePlanRun(
      { runs: this.runs, engine: this.engine, provenance: this.provenance, interjections: this.interjections, model: this.model },
      { orgId: toOrgId(principal.orgId), threadId, actorId: principal.userId },
    ));
  }

  @Post("/plan-control/threads/:threadId/runs/resume")
  async resume(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Query("projectId") projectId?: string,
  ) {
    assertPrincipal(principal);
    await this.assertWritable(principal, threadId, projectId);
    return this.runPlanEdit(() => resumePlanRun(
      { runs: this.runs, runCreator: this.runCreator, provenance: this.provenance },
      { orgId: toOrgId(principal.orgId), threadId, actorId: principal.userId },
    ));
  }

  @Post("/plan-control/threads/:threadId/steps/retry")
  async retry(
    @CurrentPrincipal() principal: Principal,
    @Param("threadId") threadId: string,
    @Body() body: { planStepId: string },
    @Query("projectId") projectId?: string,
  ) {
    assertPrincipal(principal);
    await this.assertWritable(principal, threadId, projectId);
    return this.runPlanEdit(() => retryPlanStep(
      { ...this.planEditDeps, runCreator: this.runCreator }, this.provenance,
      { orgId: toOrgId(principal.orgId), threadId, actorId: principal.userId, planStepId: body.planStepId },
    ));
  }

  /** `PlanEditError` → HTTP，一处映射，B/C/D 组共用（不逐个 handler 重复 catch 逻辑）。 */
  private async runPlanEdit<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof PlanEditError) {
        throw new HttpException({ reasonCode: e.code }, statusFor(e.code));
      }
      throw e;
    }
  }
}

function statusFor(code: PlanEditErrorCode): number {
  switch (code) {
    case "PLAN_NOT_FOUND":
    case "PLAN_STEP_NOT_FOUND":
      return 404;
    case "PLAN_REVISION_CHANGED":
    case "NO_ACTIVE_RUN":
    case "RUN_ALREADY_TERMINAL":
    case "NO_PAUSED_STATE":
      return 409;
    case "PLAN_EMPTY_NOT_ALLOWED":
    case "PLAN_CONSTRAINT_BLANK":
    case "PLAN_CONSTRAINT_TOO_LONG":
      return 422;
    case "AUDIT_SINK_UNAVAILABLE":
    case "PLAN_DELIVERY_FAILED":
      return 503;
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}
