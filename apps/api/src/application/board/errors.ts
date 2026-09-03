/**
 * Errors for the `board` use cases (F01). One class per `TransitionRejectReason` so a
 * caller can `instanceof`-branch instead of string-matching a `.code`, same discipline as
 * `identity/errors.ts`.
 */
import type { TransitionRejectReason } from "../../domain/board/transition-matrix";

export class TaskNotFoundError extends Error {
  readonly code = "TASK_NOT_FOUND";
  constructor(readonly taskId: string) {
    super("TASK_NOT_FOUND");
  }
}

/**
 * The status change was rejected by O-27. Carries the domain's own `TransitionRejectReason`
 * as `code` rather than inventing a parallel string, so there is exactly one vocabulary of
 * rejection reasons between the pure decision function and the use case that acts on it.
 */
export class IllegalTransitionError extends Error {
  constructor(
    readonly code: TransitionRejectReason,
    readonly from: string,
    readonly to: string,
  ) {
    super(code);
  }
}
