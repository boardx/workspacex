/**
 * `PlanRunCreator` —— UC-7 `confirmPlan`'s "放行执行" half.
 *
 * ⚠ **Not this bundle's job to reinvent.** `usecases.md`'s "跨束委托" list is explicit:
 * "run 的创建 / 状态 / 工具事件 → agent-runtime 束 + deep-agent-model-provider". This port
 * exists so `confirm-plan.ts` can trigger a new run WITHOUT knowing how one is actually
 * created (agent resolution, Skill pinning, idempotency, RLS-scoped writes -- all of that
 * already lives in `application/chat/message-roundtrip.ts`'s `acceptHumanMessage`, which
 * this port's real implementation wraps rather than re-deriving).
 */
import type { OrgId } from "../../domain/org-id";

export interface PlanRunCreatorInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly actorId: string;
  /**
   * F976 —— UC-13 `resumePlanRun` / UC-10 `retryPlanStep` reuse this SAME "start the next
   * turn" mechanism with different synthetic wording (not a free-text field a user typed --
   * neither UC's `in` shape has one). Omitted ⇒ the confirm-plan wording (F975's original,
   * unchanged default).
   */
  readonly messageText?: string;
}

export interface PlanRunCreatorOutput {
  readonly runId: string;
}

export interface PlanRunCreator {
  /**
   * Starts the next turn on this thread (I-10's "下一轮 run" for UC-7 `confirmPlan`; the
   * same mechanism F976 reuses, with different wording, for UC-13/UC-10). Throws on any
   * failure -- callers map that to their own fail-closed error (`confirm-plan.ts` ->
   * `PLAN_DELIVERY_FAILED`; a run that could not be created is not a half-delivered one,
   * it is simply not created).
   */
  createConfirmedRun(input: PlanRunCreatorInput): Promise<PlanRunCreatorOutput>;
}

export const PLAN_RUN_CREATOR = Symbol("PlanRunCreator");
