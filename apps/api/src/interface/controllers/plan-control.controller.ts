/**
 * `plan-control` 契约束的 HTTP 面（F977 首次接线）—— UC-1 `getPlanLedger` 唯一的读接口。
 *
 * 可见性判定**不在本束**（`usecases.md` 统一约定："NOT_VISIBLE...一律委托 chat 束 F108
 * 的判定结果"）：这里复用 `getThread`（`chat.controller.ts` `GET /chat/threads/:threadId`
 * 用的**同一个**已签核用例），不重新发明第二套判定；不可见与不存在同一个出口（404），
 * 与 `chat.controller.ts` 的既有纪律一致（`ThreadNotVisibleError` → 404、无 body）。
 */
import { Controller, Get, Inject, NotFoundException, Param, Query } from "@nestjs/common";
import { getThread, ThreadNotVisibleError } from "../../application/chat/get-thread";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY } from "../../application/identity/ports";
import type { IdentityRepository, DecisionIdFactory } from "../../application/identity/ports";
import { getPlanLedger } from "../../application/plan-control/get-plan-ledger";
import {
  PLAN_LEDGER_REPOSITORY, PLAN_RUN_STATUS_READER,
  type PlanLedgerRepository, type PlanRunStatusReader,
} from "../../application/plan-control/ports";
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
  ) {}

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
}
