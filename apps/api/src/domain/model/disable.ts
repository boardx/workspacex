/**
 * `disableModel` (F50 / uc-20-2 R3 步骤 3–4, invariants I-5 I-16, D-U5).
 *
 * Two invariants, both reverse-assertable and both encoded as pure functions so they can be
 * tested without a database:
 *
 *   1. **停用绝不静默换模型** — a reference to a disabled model becomes VISIBLY broken
 *      (`依赖失败`), never quietly reassigned to some other model that happens to be
 *      enabled. `evaluateDisableCascade` never returns a replacement model id anywhere in
 *      its result; there is no field to put one in.
 *   2. **停用二选一** — `interrupt` (stop in-flight calls now) and `drain` (let the current
 *      round finish, refuse new calls) are the only two modes, and each has a distinct,
 *      observable effect on `interruptedCalls`. A third silent option (e.g. "finish
 *      everything, no cutoff at all") is not representable: `DisableMode` is the contract's
 *      closed two-value enum, and this function is total over it.
 *
 * ## Why the last-self-hosted refusal is computed, not stored
 *
 * `poolSelfHostedEnabledCount` counts every OTHER model in `已启用` with `kind ===
 * "self-hosted"`. Excluding the target itself is the caller's job (it is the one row this
 * function is about to disable); handing this function the pool row it is deciding about
 * would let a bug double-count "myself" as "another one still standing".
 */
import type { DisableMode } from "./registry";

export const LAST_SELF_HOSTED_MODEL = "LAST_SELF_HOSTED_MODEL" as const;

/** What `listModelReferences` hands back — the snapshot `disableModel` must be given back. */
export interface ModelReferenceSnapshot {
  readonly referenceSnapshotId: string;
  readonly agents: readonly string[];
  readonly skills: readonly string[];
  readonly blueprintPolicies: readonly string[];
  readonly activeProjects: readonly string[];
  readonly inFlightCalls: number;
}

export type DisableCascadeResult =
  | {
      readonly ok: true;
      readonly affectedAgentIds: readonly string[];
      readonly affectedSkillIds: readonly string[];
      readonly affectedProjectIds: readonly string[];
      /**
       * ⚠ Only `mode: "interrupt"` ever produces a non-zero count. `drain` lets the
       * in-flight round finish — by definition nothing was interrupted, so this is always
       * `0` on that path, and a non-zero value there would be the "silently kept running
       * past what the admin chose" bug this function exists to make impossible to write.
       */
      readonly interruptedCalls: number;
    }
  | { readonly ok: false; readonly code: typeof LAST_SELF_HOSTED_MODEL };

/**
 * The cascade decision for UC-20.2 R3 步骤 3–4.
 *
 * ⚠ Does not decide `VERSION_CHANGED` — that is an optimistic-concurrency check against
 * `referenceSnapshotId`, made by the use case before this runs (comparing two opaque ids is
 * not a domain rule; it belongs where the snapshot is fetched, not here).
 */
export function evaluateDisableCascade(
  target: { readonly kind: "closed-api" | "self-hosted" },
  poolSelfHostedEnabledCount: number,
  mode: DisableMode,
  snapshot: ModelReferenceSnapshot,
): DisableCascadeResult {
  if (target.kind === "self-hosted" && poolSelfHostedEnabledCount === 0) {
    return { ok: false, code: LAST_SELF_HOSTED_MODEL };
  }
  return {
    ok: true,
    affectedAgentIds: snapshot.agents,
    affectedSkillIds: snapshot.skills,
    affectedProjectIds: snapshot.activeProjects,
    // ⚠ The one line that holds invariant 2: `drain` is `0` by construction, not by the
    // caller happening to pass `inFlightCalls: 0` for that mode.
    interruptedCalls: mode === "interrupt" ? snapshot.inFlightCalls : 0,
  };
}
