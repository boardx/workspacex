/**
 * From a STORED anchor to a CITED anchor -- and the hole in the middle.
 *
 * ## Two Anchors, one word
 *
 * The `artifact` bundle stores `{ kind, locator }` where `kind` is one of six
 * (`page` / `bbox` / `timecode` / `message-id` / `question-no` / `image-region`) and
 * `locator` is a string interpreted according to `kind` (migration 0006, `artifact.Anchor`).
 *
 * The `context-pack` bundle carries `{ page?, bbox?, startMs?, endMs?, messageId?,
 * surveyQuestionId? }` -- six optional fields, of which I-1 demands at least one
 * (`contextPack.Anchor`).
 *
 * Both were signed. Neither references the other. They are the same fact -- "how do I get
 * back to the original" -- declared twice in two different shapes, which is the failure mode
 * this project has now hit eight times. The difference is that here the two shapes do not
 * even cover the same ground, so the drift is not hypothetical:
 *
 *   page         -> page              ✔
 *   bbox         -> bbox              ✔
 *   timecode     -> startMs           ✔ (one-sided: see below)
 *   message-id   -> messageId         ✔
 *   question-no  -> surveyQuestionId  ✔
 *   image-region -> (nothing)         ✘  no field in contextPack.Anchor can hold it
 *
 * ## Why `image-region` matters rather than being a curiosity
 *
 * `photo` is one of the eight `ContextSourceType` values. A photo's segments are anchored by
 * image region -- that is what an image region IS for. Under I-1 an item with no anchor
 * field may not enter `items[]` at all. So, with the contract exactly as signed, **every
 * photo-derived segment is structurally excluded from every Context Pack**, and it is
 * excluded quietly: it lands in `omissions[]` and reads as "low relevance" rather than "the
 * schema cannot express where this came from".
 *
 * This function does NOT paper over that. Inventing a field (`imageRegion?`) would be a
 * second request/response contract written by an implementer, which is the thing F04 refused
 * to do for `saveDraft` and the thing that is refused here. It returns
 * `{ mapped: false, kind }` and the caller decides; the test asserts the gap exists, so it
 * cannot be forgotten, and the F09 report asks for the contract to be re-signed.
 *
 * ## `endMs` is unreachable, which is the same defect facing the other way
 *
 * `contextPack.Anchor` has both `startMs` and `endMs`, but `artifact.AnchorKind` has a single
 * `timecode` -- a point, not a span. Nothing that can be stored can ever populate `endMs`.
 * An audio-span segment (`SegmentKind` has `audio-span`) therefore cites only where it
 * starts. Less damaging than the photo hole, same root cause.
 */
import { artifact as A } from "@repo/contracts";
import type { z } from "zod";
import type { ContextItemAnchor } from "./context-item";

type StoredAnchorKind = z.infer<typeof A.AnchorKind>;

export interface StoredAnchor {
  readonly kind: StoredAnchorKind;
  readonly locator: string;
}

export type AnchorMapping =
  | { readonly mapped: true; readonly anchor: ContextItemAnchor }
  /**
   * The stored anchor is valid and the citation contract has nowhere to put it.
   *
   * Deliberately not merged with "the locator was malformed": one is bad data, the other is
   * a contract gap, and collapsing them into a single failure is how the contract gap gets
   * triaged as a data-quality ticket forever.
   */
  | { readonly mapped: false; readonly kind: StoredAnchorKind; readonly why: "no-field-in-contract" | "unparsable-locator" };

/** `HH:MM:SS(.mmm)` or a bare millisecond count. Returns null if it is neither. */
function timecodeToMs(locator: string): number | null {
  const m = /^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(locator.trim());
  if (m) {
    const [, h, min, s, frac] = m;
    const ms = Number(`${frac ?? ""}`.padEnd(3, "0") || "0");
    return Number(h) * 3_600_000 + Number(min) * 60_000 + Number(s) * 1000 + ms;
  }
  const bare = Number(locator.trim());
  return Number.isInteger(bare) && bare >= 0 ? bare : null;
}

/** `x1,y1,x2,y2`. All four required: three numbers do not describe a box. */
function bboxToNumbers(locator: string): number[] | null {
  const parts = locator.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

/**
 * Map one stored anchor into the citation shape.
 *
 * Exhaustive over `AnchorKind` by construction: the switch has no `default`, so a seventh
 * anchor kind added to the contract is a compile error here rather than a silent
 * `{ mapped: false }` in production.
 */
export function toContextItemAnchor(stored: StoredAnchor): AnchorMapping {
  const { kind, locator } = stored;
  switch (kind) {
    case "page": {
      const page = Number(locator.trim());
      return Number.isInteger(page)
        ? { mapped: true, anchor: { page } }
        : { mapped: false, kind, why: "unparsable-locator" };
    }
    case "bbox": {
      const bbox = bboxToNumbers(locator);
      return bbox === null
        ? { mapped: false, kind, why: "unparsable-locator" }
        : { mapped: true, anchor: { bbox } };
    }
    case "timecode": {
      const startMs = timecodeToMs(locator);
      return startMs === null
        ? { mapped: false, kind, why: "unparsable-locator" }
        : { mapped: true, anchor: { startMs } };
    }
    case "message-id":
      return locator.trim() === ""
        ? { mapped: false, kind, why: "unparsable-locator" }
        : { mapped: true, anchor: { messageId: locator } };
    case "question-no":
      return locator.trim() === ""
        ? { mapped: false, kind, why: "unparsable-locator" }
        : { mapped: true, anchor: { surveyQuestionId: locator } };
    case "image-region":
      // See the header. Not a bug in this function -- a hole in the signed contract.
      return { mapped: false, kind, why: "no-field-in-contract" };
  }
}

/**
 * Merge a segment's anchors into the single `anchor` an item carries.
 *
 * A segment may have several (F04 allows it, and deleting all but one is legal). The item
 * shape has room for one of each field, so several anchors of DIFFERENT kinds combine, and
 * two of the same kind means the first wins -- stated here rather than left to the reader,
 * because "which page did it cite" must not depend on row order in a way nobody wrote down.
 *
 * Returns `null` when nothing could be mapped: that is I-1's `ANCHOR_MISSING`, and the
 * caller must keep the segment out of `items[]`.
 */
export function mergeAnchors(stored: readonly StoredAnchor[]): {
  readonly anchor: ContextItemAnchor | null;
  readonly unmapped: readonly AnchorMapping[];
} {
  const anchor: Record<string, unknown> = {};
  const unmapped: AnchorMapping[] = [];
  for (const s of stored) {
    const m = toContextItemAnchor(s);
    if (!m.mapped) {
      unmapped.push(m);
      continue;
    }
    for (const [k, v] of Object.entries(m.anchor)) {
      if (v !== undefined && anchor[k] === undefined) anchor[k] = v;
    }
  }
  return {
    anchor: Object.keys(anchor).length === 0 ? null : (anchor as ContextItemAnchor),
    unmapped,
  };
}
