/**
 * "Eight fields, six-tuple, not one of them empty" (UC-0.2 R6 AC2 / R12 V2+V10, domain I-1).
 *
 * ## Why this exists at all, when the contract already has a zod schema
 *
 * `CP.ContextItem.parse()` accepts this:
 *
 *   { segmentId: "", content: "", artifactVersionId: "", anchor: {},
 *     retrievalReasons: [], channels: [], score: 0, permissionDecisionId: "", ... }
 *
 * Every field is present and every field is of the declared type, so the schema is
 * satisfied -- and the item is worthless. It cites nothing, it locates nothing, and its
 * `permissionDecisionId` answers "why were you allowed to see this" with silence.
 *
 * That is strictly worse than a missing item. A missing item is visible as missing; this one
 * renders in the evidence panel, counts towards the budget, and passes every check anybody
 * thought to write. V10 ("the JSON validates") and V2 ("no field is empty") are therefore
 * two different assertions, and only one of them is expressible in zod.
 *
 * ## Why the field list is read off the contract instead of written here
 *
 * The obvious implementation is `if (!item.segmentId) ... if (!item.content) ...`. It is
 * also the ninth instance of one fact in two places: the contract says which fields a
 * ContextItem has, and a hand-written list says it again. When the contract gains a tenth
 * field, the hand-written list keeps passing while the new field is allowed to be blank --
 * and the check that was supposed to catch exactly that reports success.
 *
 * So the required-field set is `Object.keys(CP.ContextItem.shape)`. A field added to the
 * contract is non-empty-checked the moment it is added, with no edit here.
 *
 * ## A note on the count
 *
 * UC-0.2 R12 V10, `feature_list.json` F09 and the `domain.md` heading all say EIGHT fields
 * and then name eight. The signed `ContextItem` schema (and the `domain.md` table under that
 * heading) has NINE -- `channels` was added for V11 "FTS is a first-class channel". This file
 * checks all nine, because the schema is the authority and an unchecked field is precisely
 * the one that ends up blank. See the F09 report: the prose count needs a correction.
 */
import { contextPack as CP } from "@repo/contracts";
import type { z } from "zod";

/** Derived, never restated (ADR-020). */
export type ContextItem = z.infer<typeof CP.ContextItem>;
/**
 * The Context Pack's view of an anchor: which kind of locator was hit.
 *
 * Deliberately NOT named `Anchor`: the contract has two of them -- `artifact.Anchor` is a
 * stored row (`{ id, segmentId, kind, locator }`) and `contextPack.Anchor` is this
 * optional-field bag. Two shapes, one word, and the mapping between them is lossy
 * (`anchor-mapping.ts`). Giving them different local names is the cheapest way to stop a
 * future reader assuming they are interchangeable.
 */
export type ContextItemAnchor = z.infer<typeof CP.Anchor>;

/** Every field a ContextItem must carry, straight from the contract. */
export const CONTEXT_ITEM_FIELDS = Object.keys(CP.ContextItem.shape) as (keyof ContextItem)[];

/** Every locator an anchor may use, straight from the contract. */
export const ANCHOR_FIELDS = Object.keys(CP.Anchor.shape) as (keyof ContextItemAnchor)[];

/**
 * Is one value empty?
 *
 * ⚠ Not `!value`. Falsiness is wrong here in two directions that both matter:
 *
 *   - `score: 0` is a real relevance score (an item pinned manually, or one that only the
 *     graph channel reached). Treating it as empty would reject a legitimate item.
 *   - `startMs: 0` is the first frame of a recording -- the most ordinary anchor there is.
 *
 * and wrong in a third that matters more: `content: "   "` is truthy, and an item whose
 * content is three spaces is exactly the "looks complete, cites nothing" failure above.
 *
 * `NaN` counts as empty: it survives `z.number()`, prints as a number, and sorts
 * unpredictably -- a score that cannot be compared is not a score.
 */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0 || value.every((v) => isEmptyValue(v));
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "object") return Object.values(value).every((v) => isEmptyValue(v));
  return false;
}

/**
 * I-1's anchor half: at least one locator, and the one present must actually locate.
 *
 * `{}` and `{ messageId: "" }` are the same amount of use to a person trying to get back to
 * the original, so they get the same answer. Kept separate from the generic emptiness walk
 * only so the failure can say `anchor` rather than naming an arbitrary sub-field.
 */
export function anchorHits(anchor: ContextItemAnchor | undefined): readonly string[] {
  if (anchor === undefined || anchor === null) return [];
  return ANCHOR_FIELDS.filter((f) => !isEmptyValue(anchor[f]));
}

/**
 * The names of the fields that are empty. Empty array = the item is complete.
 *
 * Returns the names rather than a boolean because "an item was rejected" is not actionable
 * and, worse, is satisfied by a checker that rejects everything. The tests assert on WHICH
 * field was named, which a blanket refusal cannot fake.
 */
export function emptyContextItemFields(item: Partial<ContextItem>): readonly string[] {
  const empty: string[] = [];
  for (const field of CONTEXT_ITEM_FIELDS) {
    if (field === "anchor") {
      if (anchorHits(item.anchor).length === 0) empty.push("anchor");
      continue;
    }
    if (isEmptyValue(item[field])) empty.push(field);
  }
  return empty;
}

export function isContextItemComplete(item: Partial<ContextItem>): boolean {
  return emptyContextItemFields(item).length === 0;
}

/**
 * The reason code an incomplete item is refused with.
 *
 * `ANCHOR_MISSING` is the only failure the contract names for this (it is in
 * `ContextPackReason`), and it only covers the anchor. There is no code for "content was
 * blank" or "permissionDecisionId was blank", so those are refused with a thrown error
 * carrying the field names, and NOT with an invented reason code -- inventing one would be a
 * second failure enum next to the signed one. Flagged in the F09 report.
 */
export const ANCHOR_MISSING: z.infer<typeof CP.ContextPackReason> = "ANCHOR_MISSING";

export class IncompleteContextItemError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(
      `context item is missing ${fields.join(", ")} -- I-1 requires every field of ContextItem ` +
        `to be non-empty (an item with a blank field renders as complete evidence and is not)`,
    );
  }
}

/** Throws unless the item is complete. Use where an incomplete item must not proceed. */
export function assertContextItemComplete(item: Partial<ContextItem>): asserts item is ContextItem {
  const empty = emptyContextItemFields(item);
  if (empty.length > 0) throw new IncompleteContextItemError(empty);
}
