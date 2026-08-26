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
}

export interface PlanRunCreatorOutput {
  readonly runId: string;
}

export interface PlanRunCreator {
  /**
   * Starts the next turn on this thread as "the user confirmed the plan, proceed" (I-10's
   * "下一轮 run"). Throws on any failure -- `confirm-plan.ts` maps that to
   * `PLAN_DELIVERY_FAILED` (fail closed, I-10: a run that could not be created is not a
   * half-delivered one, it is simply not created).
   */
  createConfirmedRun(input: PlanRunCreatorInput): Promise<PlanRunCreatorOutput>;
}

export const PLAN_RUN_CREATOR = Symbol("PlanRunCreator");
