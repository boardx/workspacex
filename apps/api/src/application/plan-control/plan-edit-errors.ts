/**
 * Shared error shape for the F974 edit use cases (UC-3/4/5/6), F975's `confirmPlan`
 * (UC-7), and F976's run-control use cases (UC-9/UC-10/UC-13).
 *
 * `usecases.md`'s per-UC `err` arrays are a SUBSET of `PlanControlError`
 * (`packages/contracts/src/plan-control.ts`) — this class carries exactly one of those
 * codes so a caller (a future HTTP controller) can map it to the wire error 1:1 without
 * re-deriving it from a message string.
 */
import type { PlanControlError } from "@repo/contracts/plan-control";

export type PlanEditErrorCode = Extract<
  PlanControlError,
  | "PLAN_NOT_FOUND" | "PLAN_REVISION_CHANGED" | "PLAN_STEP_NOT_FOUND"
  | "PLAN_EMPTY_NOT_ALLOWED" | "PLAN_CONSTRAINT_BLANK" | "PLAN_CONSTRAINT_TOO_LONG"
  | "AUDIT_SINK_UNAVAILABLE" | "PLAN_DELIVERY_FAILED"
  | "NO_ACTIVE_RUN" | "RUN_ALREADY_TERMINAL" | "NO_PAUSED_STATE"
>;

export class PlanEditError extends Error {
  constructor(public readonly code: PlanEditErrorCode) {
    super(code);
    this.name = "PlanEditError";
  }
}
