/**
 * `listSelectableModels` (F50 · **可选范围过滤器，唯一实现，三处复用** — uc-20-2, invariants
 * I-2 I-5).
 *
 * ## Why this is the only place the filter is written
 *
 * `agent`, `skill` and `blueprint-policy` each need "which models may I pick from", and
 * `usecases.md` is explicit that this is ONE server-side implementation reused by all
 * three, not three copies that can drift. `selectable-set-equals-enabled.test.ts` pins the
 * shape of that single implementation: the candidate set is exactly `已启用`, computed here
 * and nowhere else.
 *
 * ## Composite membership reuses `compositeBlock`, it does not re-derive it
 *
 * I-5 additionally requires every member of a composite to be `已启用` before the composite
 * itself is selectable. `compositeBlock` (F48, `./composite.ts`) is the existing, tested
 * answer to "is this chain usable"; calling it here rather than re-checking member statuses
 * inline means a composite cannot be selectable in this list while `compositeBlock` says it
 * is blocked — the two cannot disagree because there is only one function.
 *
 * ⚠ A blocked composite is DROPPED from the result, not down-ranked or shown disabled. The
 * contract: "不置灰，直接不出现" (F50's `user_visible_behavior`). It is also never replaced
 * by "the single model that still works" — dropping it is the whole point (I-5: "不降级为
 * 单模型静默运行").
 */
import type { CompositeMemberState } from "./composite";
import { compositeBlock } from "./composite";
import type { ModelKind, ModelPurpose, ModelShape, ModelStatus } from "./registry";

/** The pool row shape this filter needs — narrower than the full registered row on purpose. */
export interface SelectableCandidateRow {
  readonly modelId: string;
  readonly kind: ModelKind;
  readonly shape: ModelShape;
  readonly status: ModelStatus;
  readonly complianceAttrs: readonly string[];
  /** Only meaningful when `shape === "composite"`; ignored for `"single"`. */
  readonly members: readonly CompositeMemberState[];
}

/**
 * The candidate set for a picker.
 *
 * ⚠ `purpose === "confidential"` narrows to `self-hosted` — **the same判据 `routeModelCall`
 * uses** (`agent-runtime.ts` 判定顺序步骤 2), not a second confidentiality rule invented
 * here. Any other purpose (including `null`) leaves both kinds eligible.
 */
export function selectableModels(
  pool: readonly SelectableCandidateRow[],
  purpose: ModelPurpose | null,
): readonly SelectableCandidateRow[] {
  return pool.filter((row) => {
    if (row.status !== "已启用") return false;
    if (row.shape === "composite" && compositeBlock(row.members) !== null) return false;
    if (purpose === "confidential" && row.kind !== "self-hosted") return false;
    return true;
  });
}
