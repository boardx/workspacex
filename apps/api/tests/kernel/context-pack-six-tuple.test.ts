import { describe, expect, it } from "vitest";
import { contextPack as CP } from "@repo/contracts";
import {
  ANCHOR_FIELDS,
  CONTEXT_ITEM_FIELDS,
  IncompleteContextItemError,
  anchorHits,
  assertContextItemComplete,
  emptyContextItemFields,
  isContextItemComplete,
  isEmptyValue,
  type ContextItem,
} from "../../src/domain/context-pack/context-item";

/**
 * F09 -- the six-tuple, field by field. UC-0.2 R6 AC2 / R12 V2.
 *
 * The claim under test is narrow and absolute: an item in `items[]` carries every one of its
 * fields and NOT ONE of them is empty. The reason it deserves its own file is that the
 * failure it prevents is invisible -- an item with a blank `permissionDecisionId` or a blank
 * `anchor` renders in the evidence panel looking exactly like a good one, and every schema
 * check passes on it.
 *
 * Everything here is a pure function. No database, no clock: the assertion is about a shape.
 */

/** A well-formed item. Every negative case below is this, with one thing removed. */
const GOOD: ContextItem = {
  segmentId: "seg-f09-1",
  content: "受访者原话：我们最缺的不是预算，是决策的证据链。",
  sourceType: "interview",
  artifactVersionId: "ver-f09-1",
  anchor: { startMs: 191_000 },
  retrievalReasons: ["recall"],
  channels: ["fts"],
  score: 0.82,
  permissionDecisionId: "dec-f09-1",
};

/** The empty value appropriate to a field's declared type. */
function emptied(field: keyof ContextItem): unknown {
  const v = GOOD[field];
  if (typeof v === "string") return "";
  if (Array.isArray(v)) return [];
  if (typeof v === "number") return Number.NaN;
  return {}; // anchor
}

describe("the field list comes from the contract, not from this test", () => {
  it("covers every field the contract declares on ContextItem", () => {
    // If this test named the eight fields itself, a tenth field added to the contract would
    // be allowed to arrive blank forever while this file kept reporting success. Reading the
    // shape means the loop below grows on its own.
    expect(CONTEXT_ITEM_FIELDS).toEqual(Object.keys(CP.ContextItem.shape));
    expect(CONTEXT_ITEM_FIELDS.length).toBeGreaterThan(0);
  });

  it("contains all eight fields UC-0.2 V10 names -- and one more", () => {
    // V10, feature_list F09 and the domain.md heading all say EIGHT and name these eight.
    // The signed schema has NINE: `channels` was added for V11 ("FTS is a first-class
    // channel"). Asserted rather than smoothed over, so the prose/schema mismatch is visible
    // in a test result and not only in a report nobody re-reads.
    const namedByV10 = [
      "segmentId", "content", "sourceType", "artifactVersionId",
      "anchor", "retrievalReasons", "score", "permissionDecisionId",
    ];
    for (const f of namedByV10) expect(CONTEXT_ITEM_FIELDS).toContain(f);
    expect(CONTEXT_ITEM_FIELDS).toContain("channels");
    expect(CONTEXT_ITEM_FIELDS).toHaveLength(9);
  });
});

describe("a complete item is accepted -- the other direction of every test below", () => {
  it("accepts the well-formed item", () => {
    // First, and not as a formality. "Rejects an empty field" is satisfied in full by a
    // checker that rejects everything, and this project has shipped that gate eight times.
    expect(emptyContextItemFields(GOOD)).toEqual([]);
    expect(isContextItemComplete(GOOD)).toBe(true);
    expect(() => assertContextItemComplete(GOOD)).not.toThrow();
  });

  it("accepts it for every sourceType and every anchor kind the contract allows", () => {
    for (const sourceType of CP.ContextSourceType.options) {
      expect(isContextItemComplete({ ...GOOD, sourceType })).toBe(true);
    }
    for (const field of ANCHOR_FIELDS) {
      const anchor = { [field]: field === "bbox" ? [1, 2, 3, 4] : field.endsWith("Ms") || field === "page" ? 3 : "x-1" };
      expect(isContextItemComplete({ ...GOOD, anchor })).toBe(true);
    }
  });
});

describe("each field, emptied on its own, is rejected BY NAME", () => {
  // `it.each` over the contract's own field list: nine cases today, ten the day the contract
  // gains a field. Asserting the NAME is what distinguishes this from a blanket refusal --
  // a checker that rejects everything cannot say which field it was.
  it.each(CONTEXT_ITEM_FIELDS)("rejects an item whose %s is empty", (field) => {
    const item = { ...GOOD, [field]: emptied(field) } as ContextItem;
    expect(emptyContextItemFields(item)).toEqual([field]);
    expect(isContextItemComplete(item)).toBe(false);
    expect(() => assertContextItemComplete(item)).toThrow(IncompleteContextItemError);
    expect(() => assertContextItemComplete(item)).toThrow(new RegExp(field));
  });

  it.each(CONTEXT_ITEM_FIELDS)("rejects an item whose %s is absent altogether", (field) => {
    const item = { ...GOOD };
    delete (item as Record<string, unknown>)[field];
    expect(emptyContextItemFields(item)).toEqual([field]);
  });

  it("reports ALL the empty fields, not the first one", () => {
    // One at a time reads as five unrelated bugs; the real shape is usually a builder that
    // dropped a whole group.
    const item = { ...GOOD, content: "", permissionDecisionId: "", score: Number.NaN };
    expect([...emptyContextItemFields(item)].sort()).toEqual(["content", "permissionDecisionId", "score"]);
  });
});

describe("whitespace is empty, and zero is not", () => {
  it("rejects content that is only whitespace", () => {
    // `"   "` is truthy. A `if (!item.content)` check passes it, and the item then occupies
    // budget and citation slots while carrying no evidence at all.
    for (const blank of ["", " ", "\t", "\n  \n", "　"]) {
      expect(emptyContextItemFields({ ...GOOD, content: blank })).toEqual(["content"]);
    }
  });

  it("accepts score 0 -- a real score, not a missing one", () => {
    // The counter-proof for the whitespace rule above: the obvious implementation of
    // "empty" is falsiness, and falsiness throws away legitimate values.
    expect(emptyContextItemFields({ ...GOOD, score: 0 })).toEqual([]);
    expect(emptyContextItemFields({ ...GOOD, score: -0.5 })).toEqual([]);
  });

  it("accepts an anchor at startMs 0 -- the first frame of a recording", () => {
    expect(emptyContextItemFields({ ...GOOD, anchor: { startMs: 0 } })).toEqual([]);
    expect(emptyContextItemFields({ ...GOOD, anchor: { page: 0 } })).toEqual([]);
  });

  it("rejects a score of NaN", () => {
    // Survives `z.number()`, prints as a number, and cannot be ordered -- so a pack ranked
    // by it is in an arbitrary order that looks deliberate.
    expect(emptyContextItemFields({ ...GOOD, score: Number.NaN })).toEqual(["score"]);
    expect(isEmptyValue(Number.POSITIVE_INFINITY)).toBe(true);
  });

  it("rejects an array of empty strings", () => {
    // `retrievalReasons: [""]` has length 1. Counting elements is not the same as having any.
    expect(emptyContextItemFields({ ...GOOD, retrievalReasons: [""] as never })).toEqual(["retrievalReasons"]);
  });
});

describe("I-1's anchor half: at least one locator, and it has to locate", () => {
  it("any single anchor field is enough", () => {
    for (const field of ANCHOR_FIELDS) {
      const value = field === "bbox" ? [10, 20, 300, 80] : field === "page" ? 7 : field.endsWith("Ms") ? 12_000 : "id-1";
      expect(anchorHits({ [field]: value })).toEqual([field]);
      expect(emptyContextItemFields({ ...GOOD, anchor: { [field]: value } })).toEqual([]);
    }
  });

  it("an empty anchor object is rejected", () => {
    expect(anchorHits({})).toEqual([]);
    expect(emptyContextItemFields({ ...GOOD, anchor: {} })).toEqual(["anchor"]);
  });

  it("an anchor whose only field is a blank string is rejected", () => {
    // `{ messageId: "" }` satisfies "at least one field is present" and locates nothing. The
    // presence check and the emptiness check are not the same check.
    expect(emptyContextItemFields({ ...GOOD, anchor: { messageId: "" } })).toEqual(["anchor"]);
    expect(emptyContextItemFields({ ...GOOD, anchor: { surveyQuestionId: "  " } })).toEqual(["anchor"]);
  });

  it("an anchor whose only field is an empty bbox is rejected", () => {
    expect(emptyContextItemFields({ ...GOOD, anchor: { bbox: [] } })).toEqual(["anchor"]);
  });

  it("one good field beside a blank one still locates", () => {
    expect(anchorHits({ messageId: "", page: 4 })).toEqual(["page"]);
    expect(emptyContextItemFields({ ...GOOD, anchor: { messageId: "", page: 4 } })).toEqual([]);
  });
});
