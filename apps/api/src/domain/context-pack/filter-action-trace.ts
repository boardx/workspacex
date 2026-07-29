/**
 * Where each of the five filter actions left its trace (R3 / F11).
 *
 * ## The thing this file exists to stop being invisible
 *
 * F11's acceptance says the five actions are traced "逐条留痕于 `items[].retrievalReasons`".
 * Four of them can be. `exclude` cannot: an excluded candidate is, by definition, NOT an item, so
 * there is no `retrievalReasons` array for its trace to live in. Registered as
 * `KNOWN_CONTRACT_GAPS.G1`.
 *
 * The two bad ways out are worth naming, because both look fine in review:
 *   ① tag some surviving item with `exclude` -- a lie, and the lie is invisible downstream;
 *   ② trace four actions and call it done -- the acceptance sentence quietly becomes false and
 *      nothing turns red.
 *
 * What this file does instead: state, per action, WHICH section carries its trace
 * (`filter-action.ts`'s `tracedIn`, the single source), and project the pack accordingly. Then
 * "all five actions are traceable" is a property that can fail.
 *
 * ## Why `exclude` reads off `withdrawn`
 *
 * R3's exclude is "已撤销条目永久排除". A revoked candidate becomes an omission with reason
 * `withdrawn` (`retrieve-candidates.ts`), and that row IS the trace of the exclusion. This is a
 * projection of two existing facts, not a new one: nothing is stored twice, and if the retrieval
 * side stopped emitting those rows, this trace would go empty and the assertion would fail --
 * which is the correct behaviour, because then the exclusion really would be untraceable.
 */
import { contextPack as CP, filterAction as FA } from "@repo/contracts";
import type { z } from "zod";
import type { ContextItem } from "./context-item";
import type { Omission } from "./pack-structure";

export type FilterAction = z.infer<typeof CP.FilterAction>;

/**
 * The omission reasons that constitute the trace of an omission-traced action.
 *
 * Only `exclude` has an entry, because only `exclude` is omission-traced. Written as a map rather
 * than an `if` so that adding a second omission-traced action (an ADR-sized change) has an
 * obvious place to go instead of growing a branch.
 */
const OMISSION_TRACE_OF: Partial<Record<FilterAction, readonly string[]>> = {
  exclude: ["withdrawn"],
};

export interface FilterActionTrace {
  readonly action: FilterAction;
  readonly tracedIn: FA.FilterActionTraceSite;
  /** The refs carrying this trace. */
  readonly refs: readonly string[];
}

export function filterActionTraces(pack: {
  readonly items: readonly ContextItem[];
  readonly omissions: readonly Omission[];
}): readonly FilterActionTrace[] {
  return (FA.FILTER_ACTION_KEYS as readonly FilterAction[]).map((action) => {
    const tracedIn = FA.filterActionTracedIn(action);
    if (tracedIn === "items") {
      return {
        action,
        tracedIn,
        refs: pack.items.filter((i) => i.retrievalReasons.includes(action)).map((i) => i.segmentId),
      };
    }
    const reasons = OMISSION_TRACE_OF[action] ?? [];
    return {
      action,
      tracedIn,
      refs: pack.omissions.filter((o) => reasons.includes(o.reason)).map((o) => o.ref),
    };
  });
}

/** Actions with no trace anywhere in this pack. */
export function untracedActions(pack: {
  readonly items: readonly ContextItem[];
  readonly omissions: readonly Omission[];
}): readonly FilterAction[] {
  return filterActionTraces(pack).filter((t) => t.refs.length === 0).map((t) => t.action);
}

/**
 * G1 made mechanical: an item must never carry an omission-traced action.
 *
 * This is the assertion that stops resolution ① above. An item tagged `exclude` claims to have
 * been excluded and to be in the pack at the same time.
 */
export function itemsCarryingOmissionTracedAction(
  items: readonly ContextItem[],
): readonly { segmentId: string; action: FilterAction }[] {
  const forbidden = new Set(FA.OMISSION_TRACED_ACTIONS as readonly string[]);
  const out: { segmentId: string; action: FilterAction }[] = [];
  for (const i of items) {
    for (const a of i.retrievalReasons) {
      if (forbidden.has(a)) out.push({ segmentId: i.segmentId, action: a });
    }
  }
  return out;
}
