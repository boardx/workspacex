/**
 * O-27: the legal status-transition matrix. Pure. No clock, no randomness, no I/O -- exactly
 * like `identity/permission-decision.ts`, and for the same reason: this function IS the
 * feature (F01), and it has to be exhaustively testable without a database.
 *
 * ## The rule, transcribed from
 * `phases/phase-02-visible-outcomes/requirements/11-board/uc-11-1-四列看板与推进.md` R10
 *
 *   1. Any FORWARD jump (target further along the natural order
 *      inbox < todo < in_progress < review < done) is allowed unconditionally -- no need to
 *      pass through every column in between.
 *   2. Any BACKWARD move requires a non-blank `reason`, and must be audited (actor, time,
 *      card id, before/after status, reason) by the CALLER of this function -- this function
 *      only decides, it does not write anything.
 *   3. `inbox` can only be LEFT. Once a card has left `inbox`, no status may transition back
 *      into it -- not even with a reason. This is not "backward move needs a reason", it is
 *      a harder wall: the whole `inbox` column is refused, unconditionally.
 *   4. `scope: "global"` forbids moving a card into a DIFFERENT project than the one it is
 *      currently in. This is an orthogonal check to the status matrix -- it can reject a
 *      transition the status matrix itself would allow.
 *
 * A same-status "transition" (`from === to`) is not a cell of the O-27 table at all (the
 * diagonal is drawn as "--", i.e. not applicable) -- it is rejected as a no-op rather than
 * silently treated as a successful move.
 */
import { isTaskStatus, statusRank, type TaskStatus } from "./task-status";

export type TransitionRejectReason =
  /** `from` or `to` is not one of the five declared statuses. */
  | "UNKNOWN_STATUS"
  /** `from === to`. Not a cell in the O-27 table; there is nothing to transition. */
  | "NOOP_TRANSITION"
  /** Rule 3: any attempt to move back into `inbox` once a card has left it. */
  | "INBOX_REENTRY_FORBIDDEN"
  /** Rule 2: a backward move was attempted with an empty/blank/missing `reason`. */
  | "REASON_REQUIRED"
  /** Rule 4: `scope: "global"` forbids a cross-project status change. */
  | "GLOBAL_SCOPE_CROSS_PROJECT_FORBIDDEN";

export interface TransitionOptions {
  /**
   * Whether this change happens inside a single project's own board (`true`, the default)
   * or from a `scope: "global"` cross-project view (`false`). F01 only has to be able to
   * CARRY this rule -- the global board UI itself is F02's scope, not this feature's.
   */
  readonly sameProjectScope?: boolean;
}

export type TransitionDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reasonCode: TransitionRejectReason };

const allow = (): TransitionDecision => ({ allowed: true });
const deny = (reasonCode: TransitionRejectReason): TransitionDecision => ({ allowed: false, reasonCode });

/**
 * Decide whether `from -> to` is legal under O-27.
 *
 * `reason` is the free-text justification a backward move must carry; blank/whitespace-only
 * counts as absent (a reason nobody can read back is not a reason).
 */
export function decideTransition(
  from: string,
  to: string,
  reason?: string | null,
  opts?: TransitionOptions,
): TransitionDecision {
  if (!isTaskStatus(from) || !isTaskStatus(to)) return deny("UNKNOWN_STATUS");

  // Rule 4 first: an out-of-scope request is refused regardless of what the status matrix
  // would otherwise say -- it is a request that should never have reached this project's
  // board in the first place.
  if (opts?.sameProjectScope === false) return deny("GLOBAL_SCOPE_CROSS_PROJECT_FORBIDDEN");

  if (from === to) return deny("NOOP_TRANSITION");

  const target: TaskStatus = to;
  // Rule 3: the whole inbox COLUMN is refused, unconditionally, once a card has left it.
  // This must be checked before the generic backward-move check below, because inbox sits
  // at rank 0 and would otherwise be classified as an ordinary (reason-satisfiable)
  // backward move -- which is exactly the leniency rule 3 forbids.
  if (target === "inbox") return deny("INBOX_REENTRY_FORBIDDEN");

  const isForward = statusRank(to) > statusRank(from);
  if (isForward) return allow();

  // Backward move (rank(to) < rank(from), to !== "inbox"): needs a non-blank reason.
  const trimmed = reason?.trim() ?? "";
  if (trimmed === "") return deny("REASON_REQUIRED");
  return allow();
}
