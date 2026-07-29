import { describe, expect, it } from "vitest";
import { artifact as A, contextPack as CP, omissionReason as OR } from "@repo/contracts";
import {
  MalformedContextPackError,
  PACK_SECTIONS,
  isWellFormedPack,
  packStructureViolations,
  parseContextPack,
  type ContextPack,
} from "../../src/domain/context-pack/pack-structure";
import { mergeAnchors, toContextItemAnchor } from "../../src/domain/context-pack/anchor-mapping";
import type { ContextItem } from "../../src/domain/context-pack/context-item";

/**
 * F09 -- the three-section structure contract. UC-0.2 R1 / R12 V10.
 *
 * "A Context Pack is not an array of strings." The sections are `items[]` (what was put in),
 * `claims[]` (reviewed insight, opposing evidence kept) and `omissions[]` (what was left out
 * and why). This file asserts that the structure is what the contract says, that a schema
 * pass is NOT the same as a well-formed pack, and that the anchor a stored segment carries
 * can actually be turned into one an item can cite.
 */

const QUERY: ContextPack["query"] = {
  tenantId: "org-f09",
  principalId: "u-f09",
  projectIds: ["proj-f09"],
  task: "answer",
  query: "客户对能源改造的原话",
  timeRange: null,
  allowedSensitivity: ["internal"],
  tokenBudget: 120_000,
  freshnessRequirement: null,
  evidencePolicy: "reviewed",
};

const ITEM: ContextItem = {
  segmentId: "seg-f09-1",
  content: "我们最缺的不是预算，是决策的证据链。",
  sourceType: "interview",
  artifactVersionId: "ver-f09-1",
  anchor: { startMs: 191_000 },
  retrievalReasons: ["recall"],
  channels: ["fts"],
  score: 0.82,
  permissionDecisionId: "dec-f09-1",
};

const PACK: ContextPack = {
  packId: "pack-f09-1",
  runId: "run-f09-1",
  query: QUERY,
  retrievalPlan: [{ channel: "fts", weight: 0.4, hitCount: 3 }],
  items: [ITEM],
  claims: [
    {
      statement: "能源组认为证据链比预算更紧缺",
      status: "reviewed",
      supportingSegmentIds: ["seg-f09-1"],
      contradictingSegmentIds: ["seg-f09-9"],
    },
  ],
  omissions: [
    {
      ref: "seg-f09-7",
      reason: "budget",
      compliance: OR.isComplianceOmission("budget"),
      explain: OR.omissionExplain("budget"),
    },
  ],
  tokensUsed: 14_900,
  pinnedSnapshotId: null,
};

describe("the three sections", () => {
  it("a well-formed pack passes both the schema and the structure check", () => {
    // The two-way half. Every refusal below is also produced by a validator that refuses
    // everything, which would be a green gate testing nothing.
    expect(() => parseContextPack(PACK)).not.toThrow();
    expect(isWellFormedPack(PACK)).toBe(true);
    expect(packStructureViolations(PACK)).toEqual([]);
  });

  it("items / claims / omissions are all present, and it is not an array of strings", () => {
    for (const section of PACK_SECTIONS) expect(Array.isArray(PACK[section])).toBe(true);
    // The failure this bundle exists to prevent, stated as an assertion: a pack whose items
    // are strings cannot answer where / why-visible / what-was-dropped.
    expect(CP.ContextPack.safeParse({ ...PACK, items: ["some text"] }).success).toBe(false);
  });

  it("a section that is missing entirely is refused", () => {
    for (const section of PACK_SECTIONS) {
      const short = { ...PACK };
      delete (short as Record<string, unknown>)[section];
      expect(CP.ContextPack.safeParse(short).success).toBe(false);
      expect(packStructureViolations(short as ContextPack).some((v) => v.at === section)).toBe(true);
    }
  });

  it("an EMPTY pack is well-formed -- E1's real empty state is not a malformed one", () => {
    // The counter-proof for the section checks: they must demand presence, not content.
    // A validator that required a non-empty items[] would force assemblers to invent
    // context for a brand-new project, which is exactly what E1 forbids.
    const empty: ContextPack = { ...PACK, items: [], claims: [], omissions: [], tokensUsed: 0 };
    expect(packStructureViolations(empty)).toEqual([]);
  });
});

describe("passing the schema is NOT the same as being well-formed", () => {
  const blank: ContextItem = {
    segmentId: "", content: "", sourceType: "file", artifactVersionId: "",
    anchor: {}, retrievalReasons: [], channels: [], score: 0, permissionDecisionId: "",
  };

  it("zod accepts an item in which nothing is filled in", () => {
    // This is the whole argument for F09 existing as more than a type export. V10 says "the
    // JSON validates"; V2 says "no field is empty". Only one of those is expressible in zod,
    // and the item below satisfies the first while being worthless.
    expect(CP.ContextItem.safeParse(blank).success).toBe(true);
    expect(CP.ContextPack.safeParse({ ...PACK, items: [blank] }).success).toBe(true);
  });

  it("the structure check refuses it, naming every blank field", () => {
    const at = packStructureViolations({ ...PACK, items: [blank] }).map((v) => v.at);
    expect(at).toEqual([
      "items[0].segmentId",
      "items[0].content",
      "items[0].artifactVersionId",
      "items[0].anchor",
      "items[0].retrievalReasons",
      "items[0].channels",
      "items[0].permissionDecisionId",
    ]);
    // `sourceType` and `score` are absent from that list on purpose: "file" is a real source
    // type and 0 is a real score. The check finds blanks, not falsiness.
    expect(at).not.toContain("items[0].sourceType");
    expect(at).not.toContain("items[0].score");
  });

  it("parseContextPack runs both, in that order", () => {
    expect(() => parseContextPack({ ...PACK, items: [blank] })).toThrow(MalformedContextPackError);
    // Shape errors still come from zod, so a wrong TYPE does not reach the emptiness walk.
    expect(() => parseContextPack({ ...PACK, tokensUsed: "14.9k" })).toThrow(/tokensUsed|number/i);
  });
});

describe("claims: opposing evidence has a place to live and cannot be dropped from the shape", () => {
  it("requires contradictingSegmentIds to be present", () => {
    const claim = { ...PACK.claims[0]! };
    delete (claim as Record<string, unknown>).contradictingSegmentIds;
    expect(CP.ClaimRef.safeParse(claim).success).toBe(false);
    expect(packStructureViolations({ ...PACK, claims: [claim as never] }).map((v) => v.at)).toContain(
      "claims[0].contradictingSegmentIds",
    );
  });

  it("but an EMPTY contradictingSegmentIds is legal -- most claims have no opposition", () => {
    // The counter-proof. If empty were refused, an assembler would stop emitting claims that
    // nobody disputes, and R7's "opposing evidence is never filtered out" would have quietly
    // become "claims without opposition are never emitted".
    const claim = { ...PACK.claims[0]!, supportingSegmentIds: [], contradictingSegmentIds: [] };
    expect(packStructureViolations({ ...PACK, claims: [claim] })).toEqual([]);
  });

  it("rejects a claim that states nothing", () => {
    const claim = { ...PACK.claims[0]!, statement: "   " };
    expect(packStructureViolations({ ...PACK, claims: [claim] }).map((v) => v.at)).toEqual(["claims[0].statement"]);
  });

  it("every claim status the contract names is accepted", () => {
    for (const status of CP.ClaimStatus.options) {
      expect(packStructureViolations({ ...PACK, claims: [{ ...PACK.claims[0]!, status }] })).toEqual([]);
    }
  });
});

describe("omissions: the reason is the closed seven, and compliance is derived from it", () => {
  const omission = (over: Partial<ContextPack["omissions"][number]>) => ({ ...PACK.omissions[0]!, ...over });

  it("accepts every one of the seven, with the compliance flag the single source gives", () => {
    for (const reason of OR.OMISSION_REASON_KEYS) {
      const om = omission({ reason, compliance: OR.isComplianceOmission(reason), explain: OR.omissionExplain(reason) });
      expect(packStructureViolations({ ...PACK, omissions: [om] })).toEqual([]);
    }
    expect(OR.OMISSION_REASON_KEYS).toHaveLength(7);
  });

  it("rejects a reason outside the seven", () => {
    // D-U4 / I-3. An eighth category has to go through an ADR, not through a deploy.
    expect(CP.Omission.safeParse(omission({ reason: "too-boring" as never })).success).toBe(false);
    expect(packStructureViolations({ ...PACK, omissions: [omission({ reason: "too-boring" as never })] }).map((v) => v.at))
      .toEqual(["omissions[0].reason"]);
  });

  it("rejects a compliance flag that disagrees with the reason", () => {
    // `withdrawn` with `compliance: false` is a compliance discard that a "show first 5"
    // fold is then free to hide -- exactly what I-4 forbids, and nothing else would notice,
    // because the record is otherwise perfectly well-formed.
    const lying = omission({ reason: "withdrawn", compliance: false, explain: OR.omissionExplain("withdrawn") });
    expect(CP.Omission.safeParse(lying).success).toBe(true);
    const v = packStructureViolations({ ...PACK, omissions: [lying] });
    expect(v.map((x) => x.at)).toEqual(["omissions[0].compliance"]);
    expect(v[0]!.problem).toMatch(/derived from the reason/);
  });

  it("all three compliance reasons are flagged as such, and the other four are not", () => {
    // The other direction: a checker that just demanded `compliance === true` would pass the
    // test above and be wrong for four of the seven.
    for (const reason of OR.OMISSION_REASON_KEYS) {
      const wrong = omission({ reason, compliance: !OR.isComplianceOmission(reason) });
      expect(packStructureViolations({ ...PACK, omissions: [wrong] }).map((x) => x.at)).toEqual([
        "omissions[0].compliance",
      ]);
    }
    expect([...OR.COMPLIANCE_REASONS].sort()).toEqual(["expired", "unauthorized", "withdrawn"]);
  });

  it("rejects an omission that names nothing or explains nothing", () => {
    expect(packStructureViolations({ ...PACK, omissions: [omission({ ref: "" })] }).map((v) => v.at))
      .toEqual(["omissions[0].ref"]);
    expect(packStructureViolations({ ...PACK, omissions: [omission({ explain: " " })] }).map((v) => v.at))
      .toEqual(["omissions[0].explain"]);
  });
});

describe("packId / runId", () => {
  it("refuses a blank runId -- a pack that cannot be named cannot be replayed", () => {
    expect(packStructureViolations({ ...PACK, runId: "" }).map((v) => v.at)).toEqual(["runId"]);
    expect(packStructureViolations({ ...PACK, packId: "  " }).map((v) => v.at)).toEqual(["packId"]);
  });
});

describe("from a STORED anchor to a CITED anchor -- and the hole in the contract", () => {
  /**
   * A locator that is VALID for each stored kind.
   *
   * Needed because the two failure kinds must not be confused: feeding `"1"` to a bbox makes
   * it unmappable for a DATA reason, which would hide the fact that bbox maps perfectly well
   * and would make the contract-gap assertion below pass for the wrong reason.
   */
  const VALID: Record<(typeof A.AnchorKind.options)[number], string> = {
    page: "12",
    bbox: "10,20,300,80",
    timecode: "00:14:07.500",
    "message-id": "msg-91f3",
    "question-no": "Q7",
    "image-region": "img-2#40,40,120,120",
  };

  it("five of the six stored anchor kinds map onto a citable field", () => {
    expect(toContextItemAnchor({ kind: "page", locator: "12" })).toEqual({ mapped: true, anchor: { page: 12 } });
    expect(toContextItemAnchor({ kind: "bbox", locator: "10,20,300,80" }))
      .toEqual({ mapped: true, anchor: { bbox: [10, 20, 300, 80] } });
    expect(toContextItemAnchor({ kind: "timecode", locator: "00:14:07.500" }))
      .toEqual({ mapped: true, anchor: { startMs: 847_500 } });
    expect(toContextItemAnchor({ kind: "message-id", locator: "msg-91f3" }))
      .toEqual({ mapped: true, anchor: { messageId: "msg-91f3" } });
    expect(toContextItemAnchor({ kind: "question-no", locator: "Q7" }))
      .toEqual({ mapped: true, anchor: { surveyQuestionId: "Q7" } });
  });

  it("⚠ `image-region` maps onto NOTHING -- a signed-contract gap, asserted so it cannot be forgotten", () => {
    // `contextPack.Anchor` has page / bbox / startMs / endMs / messageId / surveyQuestionId.
    // None of them can hold an image region, and `photo` is one of the eight source types.
    // With the contract exactly as signed, every photo-derived segment is structurally
    // barred from every Context Pack by I-1 -- quietly, as a discard.
    //
    // Asserted rather than fixed: inventing an `imageRegion?` field here would be an
    // implementer writing a second request contract (the thing F04 refused to do for
    // saveDraft). Change the assertion when the contract is re-signed.
    expect(toContextItemAnchor({ kind: "image-region", locator: "img-2#40,40,120,120" }))
      .toEqual({ mapped: false, kind: "image-region", why: "no-field-in-contract" });

    // Every kind gets a locator that is valid FOR IT, so nothing here fails for a data
    // reason -- the only thing left is the contract gap.
    const unmappable = A.AnchorKind.options.filter((kind) => {
      const m = toContextItemAnchor({ kind, locator: VALID[kind] });
      return !m.mapped && m.why === "no-field-in-contract";
    });
    expect(unmappable).toEqual(["image-region"]);
    // ...and no kind is unmappable for any OTHER reason, which is the counter-proof: with a
    // sloppy fixture this whole assertion passes while five kinds are quietly broken.
    const badData = A.AnchorKind.options.filter((kind) => {
      const m = toContextItemAnchor({ kind, locator: VALID[kind] });
      return !m.mapped && m.why === "unparsable-locator";
    });
    expect(badData).toEqual([]);
  });

  it("⚠ `endMs` can never be populated from anything storable", () => {
    // The same defect facing the other way: the citation shape has a span, the storage shape
    // has only a point (`timecode`). An audio-span segment cites where it starts and not
    // where it ends.
    const reachable = new Set(
      A.AnchorKind.options.flatMap((kind) => {
        const m = toContextItemAnchor({ kind, locator: VALID[kind] });
        return m.mapped ? Object.keys(m.anchor) : [];
      }),
    );
    expect(reachable.has("endMs")).toBe(false);
    expect([...reachable].sort()).toEqual(["bbox", "messageId", "page", "startMs", "surveyQuestionId"]);
  });

  it("a malformed locator is reported as bad DATA, not as a contract gap", () => {
    // Collapsing the two would let the contract hole be triaged as a data-quality ticket
    // forever.
    expect(toContextItemAnchor({ kind: "page", locator: "twelve" }))
      .toEqual({ mapped: false, kind: "page", why: "unparsable-locator" });
    expect(toContextItemAnchor({ kind: "bbox", locator: "10,20,300" }))
      .toEqual({ mapped: false, kind: "bbox", why: "unparsable-locator" });
    expect(toContextItemAnchor({ kind: "message-id", locator: "  " }))
      .toEqual({ mapped: false, kind: "message-id", why: "unparsable-locator" });
  });

  it("several anchors on one segment merge into the single anchor an item carries", () => {
    const merged = mergeAnchors([
      { kind: "page", locator: "3" },
      { kind: "bbox", locator: "1,2,3,4" },
      { kind: "image-region", locator: "img-1#0,0,10,10" },
    ]);
    expect(merged.anchor).toEqual({ page: 3, bbox: [1, 2, 3, 4] });
    expect(merged.unmapped.map((u) => (u.mapped ? null : u.kind))).toEqual(["image-region"]);
  });

  it("a segment whose only anchor is an image region yields no anchor at all", () => {
    const merged = mergeAnchors([{ kind: "image-region", locator: "img-1#0,0,10,10" }]);
    expect(merged.anchor).toBeNull();
  });

  it("the first anchor of a kind wins, and that is written down rather than left to row order", () => {
    expect(mergeAnchors([{ kind: "page", locator: "3" }, { kind: "page", locator: "9" }]).anchor)
      .toEqual({ page: 3 });
  });
});
