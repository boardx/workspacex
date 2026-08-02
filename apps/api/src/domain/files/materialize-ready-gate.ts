/**
 * F43 -- uc-22-3 V6: the AI-generated-provenance READY gate.
 *
 * `SEVEN_SOURCE_FILE_PLAN.generated` (F41) already lists BOTH `content.md` and
 * `provenance.json` as required-to-write files -- `materializeSource` (F41) refuses the whole
 * call if either is missing. That is the right rule for "does a version get written at all",
 * but V6 asks a DIFFERENT, narrower question specifically for the `generated` source: a
 * version missing provenance should still exist and be visible in the file browser (R7 "不存
 * 在业务对象存在但浏览器什么都没有的静默态") -- it should just not be usable as evidence yet,
 * parked at `REVIEW_PENDING` labeled "溯源信息缺失" until someone supplies it, the same
 * REVIEW_PENDING fork F39's `StructuralReviewGate` already uses for confidential/PII
 * material (`application/files/review-gate.ts`), reused here for a different trigger.
 *
 * So this is its own, deliberately separate gate from F41's required-file check: this
 * feature's own materializer (`materialize-generated-source.ts`) treats `provenance.json` as
 * OPTIONAL at write time for the `generated` source specifically, and calls this function
 * afterward to decide the resulting version's readiness -- rather than loosening
 * `SEVEN_SOURCE_FILE_PLAN` itself, which is F41's signed table and not this feature's to edit.
 */
import type { MaterializationSourceType } from "./materialization-events";

export const PROVENANCE_MISSING_REASON = "溯源信息缺失";

export interface ReadyGateResult {
  readonly ready: boolean;
  /** Non-null exactly when `ready` is false -- the label REVIEW_PENDING carries. */
  readonly reason: string | null;
}

/**
 * Only the `generated` source is gated; every other source type has no provenance concept
 * (R6 only applies to AI-produced content) and is unconditionally ready once its required
 * files are written.
 */
export function gateReadyForProvenance(
  sourceType: MaterializationSourceType,
  parts: Readonly<Record<string, Uint8Array>>,
): ReadyGateResult {
  if (sourceType !== "generated") return { ready: true, reason: null };
  const provenance = parts["provenance.json"];
  if (provenance === undefined || provenance.byteLength === 0) {
    return { ready: false, reason: PROVENANCE_MISSING_REASON };
  }
  return { ready: true, reason: null };
}
