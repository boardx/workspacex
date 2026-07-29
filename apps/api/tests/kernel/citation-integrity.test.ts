import { describe, expect, it } from "vitest";
import { contextPack as CP, provenance as PV } from "@repo/contracts";
import {
  citableSegmentIds,
  unciteableClaimEvidence,
  verifyCitations,
} from "../../src/domain/context-pack/citation-integrity";
import { verifyCitation } from "../../src/application/context-pack/verify-citation";
import {
  RunNotFoundError,
  type CitationRejectionRecord,
  type ContextRunStore,
} from "../../src/application/context-pack/ports";
import type { ContextPack, Omission } from "../../src/domain/context-pack/pack-structure";
import type { ContextItem } from "../../src/domain/context-pack/context-item";

/**
 * F12 -- I-6 / V1 / AC1: the AI may cite what is in this pack, and nothing else.
 *
 * The property under test is CLOSURE, not size. `toHaveLength(3)` on a pack's citable set
 * would be asserting how many documents retrieval happened to return; what must hold forever
 * is that nothing from outside the set gets in. So the negative cases are all built BY
 * DERIVING them from the pack (its own omissions, its own claims, its own ids mutated) rather
 * than by typing out three invented strings -- a pack that grows an item keeps the test
 * meaningful, and a checker that starts matching loosely fails immediately.
 *
 * Pure functions plus in-memory doubles. There is nothing here a database would make truer.
 */

const item = (segmentId: string): ContextItem => ({
  segmentId,
  content: `内容 ${segmentId}`,
  sourceType: "interview",
  artifactVersionId: `ver-${segmentId}`,
  anchor: { startMs: 191_000 },
  retrievalReasons: ["recall"],
  channels: ["fts"],
  score: 0.7,
  permissionDecisionId: `dec-${segmentId}`,
});

const withheld: Omission = {
  ref: "seg-withheld",
  reason: "unauthorized",
  compliance: true,
  explain: "两层交集鉴权未通过",
};

const PACK: ContextPack = {
  packId: "pack-f12",
  runId: "run-f12",
  query: {
    tenantId: "org-f12",
    principalId: "u-energy",
    projectIds: ["proj-f12"],
    task: "answer",
    query: "证据链",
    timeRange: null,
    allowedSensitivity: ["internal"],
    tokenBudget: 120_000,
    freshnessRequirement: null,
    evidencePolicy: "reviewed",
  },
  retrievalPlan: [],
  items: [item("seg-a"), item("seg-b"), item("seg-c")],
  claims: [
    {
      statement: "能源组认为证据链比预算更紧缺",
      status: "contested",
      supportingSegmentIds: ["seg-a"],
      // Carried through untouched by `retrieveCandidates` (R7 / I-12): opposing evidence is
      // never intersected with what survived ranking. Hence an id here that is not an item.
      contradictingSegmentIds: ["seg-opposing"],
    },
  ],
  omissions: [withheld],
  tokensUsed: 900,
  pinnedSnapshotId: null,
};

const IN_PACK = PACK.items.map((i) => i.segmentId);

/* ─────────────────────────── the permissive direction, first ─────────────────────────── */

describe("citing what IS in the pack passes", () => {
  it("accepts every in-pack id, singly and together", () => {
    // First, and not as a formality: "rejects out-of-pack citations" is satisfied in full by a
    // checker that rejects everything, and a gate that blocks all citation is indistinguishable
    // from a broken product.
    for (const id of IN_PACK) {
      expect(verifyCitations(PACK, [id])).toEqual({ allowed: true, offendingSegmentIds: [] });
    }
    expect(verifyCitations(PACK, IN_PACK)).toEqual({ allowed: true, offendingSegmentIds: [] });
    // Repeating a legitimate citation is not an offence -- a model quoting one segment twice
    // is normal, and counting it as a violation would train callers to ignore the verdict.
    expect(verifyCitations(PACK, ["seg-a", "seg-a", "seg-b"]).allowed).toBe(true);
  });

  it("cites nothing at all -- allowed here, because grounding is the gate's job not this one", () => {
    // Deliberately recorded rather than left implicit: an answer with zero citations is a real
    // problem (无来源结论) and it is NOT this function's problem. `gateAiCall` is what stops a
    // call with no evidence behind it; see `empty-pack-blocks-ai.test.ts`.
    expect(verifyCitations(PACK, [])).toEqual({ allowed: true, offendingSegmentIds: [] });
  });
});

/* ───────────────────────────────── the closed boundary ───────────────────────────────── */

describe("the citable set is exactly items[].segmentId -- closed, and derived", () => {
  it("is read off the items, so it follows the pack instead of a hardcoded list", () => {
    expect([...citableSegmentIds(PACK)].sort()).toEqual([...IN_PACK].sort());
    // Add an item: the set grows on its own. This is the assertion `toHaveLength(3)` would
    // have blocked -- a legitimate, reviewed addition must not fail a test about closure.
    const grown = { ...PACK, items: [...PACK.items, item("seg-d")] };
    expect(citableSegmentIds(grown).has("seg-d")).toBe(true);
    expect(verifyCitations(grown, ["seg-d"]).allowed).toBe(true);
    // Remove one: it stops being citable immediately.
    const shrunk = { ...PACK, items: PACK.items.slice(1) };
    expect(citableSegmentIds(shrunk).has("seg-a")).toBe(false);
    expect(verifyCitations(shrunk, ["seg-a"]).allowed).toBe(false);
  });

  it("everything the pack mentions but did not SHOW is out of pack", () => {
    // Built from the pack itself: discard refs and claim evidence are the ids a model can most
    // plausibly pick up from the material it was handed, which makes them the ids most likely
    // to be cited by mistake -- and the ones a "close enough" matcher would wave through.
    const mentionedButNotShown = [
      ...PACK.omissions.map((o) => o.ref),
      ...PACK.claims.flatMap((c) => [...c.supportingSegmentIds, ...c.contradictingSegmentIds]),
    ].filter((id) => !IN_PACK.includes(id));
    expect(mentionedButNotShown.length).toBeGreaterThan(0); // the fixture must actually pose the question

    const v = verifyCitations(PACK, mentionedButNotShown);
    expect(v.allowed).toBe(false);
    expect([...v.offendingSegmentIds].sort()).toEqual([...mentionedButNotShown].sort());
  });

  it("an id from a DIFFERENT pack is out of pack, however real it is elsewhere", () => {
    const otherPack: ContextPack = { ...PACK, packId: "pack-other", runId: "run-other", items: [item("seg-z")] };
    expect(verifyCitations(otherPack, ["seg-z"]).allowed).toBe(true); // real over there
    expect(verifyCitations(PACK, ["seg-z"])).toEqual({ allowed: false, offendingSegmentIds: ["seg-z"] });
  });

  it("near-misses of a real id are rejected -- no trimming, no case folding, no prefixes", () => {
    // The failure this prevents: a model produces a string that RESEMBLES an id. Accept it and
    // the citation resolves to a segment that was never disclosed to this requester, rendered
    // with a working "back to source" link. Every one of these passes under a "helpful"
    // normalisation, and each normalisation is a one-line change somebody will propose.
    const nearMisses = [" seg-a", "seg-a ", "\tseg-a", "SEG-A", "Seg-A", "seg-a\n", "seg-", "seg-ab", "seg", ""];
    const v = verifyCitations(PACK, nearMisses);
    expect(v.allowed).toBe(false);
    expect(v.offendingSegmentIds).toEqual(nearMisses); // every single one, none excused
  });

  it("one bad citation among good ones fails the whole verdict", () => {
    const v = verifyCitations(PACK, ["seg-a", "seg-ghost", "seg-b", "seg-ghost", "seg-phantom"]);
    expect(v.allowed).toBe(false);
    // Deduplicated, in first-appearance order: the same record twice cannot be compared, and
    // comparing refusals across runs is what recording them is for.
    expect(v.offendingSegmentIds).toEqual(["seg-ghost", "seg-phantom"]);
  });

  it("an empty pack makes every citation an offence", () => {
    const empty = { ...PACK, items: [] };
    expect(citableSegmentIds(empty).size).toBe(0);
    expect(verifyCitations(empty, IN_PACK)).toEqual({ allowed: false, offendingSegmentIds: IN_PACK });
  });
});

/* ──────────────────────────── the verdict matches the contract ───────────────────────── */

describe("the verdict is the contract's `out`, and the contract refuses drift", () => {
  const out = CP.operations.verifyCitation.out;

  it("both verdicts parse", () => {
    expect(out.safeParse(verifyCitations(PACK, ["seg-a"])).success).toBe(true);
    expect(out.safeParse(verifyCitations(PACK, ["seg-ghost"])).success).toBe(true);
  });

  it("an extra key is refused -- `.strict()`, the return direction of B-8", () => {
    // Without this, a server that returned `{ allowed: false, offendingSegmentIds: [...],
    // warning: "..." }` would validate, the generated front-end type would not know the field
    // exists, and nothing anywhere would fail.
    expect(out.safeParse({ allowed: true, offendingSegmentIds: [], warnings: [] }).success).toBe(false);
    expect(out.safeParse({ allowed: true }).success).toBe(false);
    expect(out.safeParse({ allowed: "yes", offendingSegmentIds: [] }).success).toBe(false);
  });
});

/* ─────────────────────────── the use case: refuse AND record ─────────────────────────── */

class InMemoryRuns implements ContextRunStore {
  constructor(private readonly packs: Record<string, ContextPack>) {}
  async gateState(): Promise<undefined> {
    return undefined; // not what this file is about; see empty-pack-blocks-ai.test.ts
  }
  async pack(runId: string): Promise<ContextPack | undefined> {
    return this.packs[runId];
  }
}

class Recorder {
  readonly records: CitationRejectionRecord[] = [];
  constructor(private readonly failWith?: Error) {}
  async record(r: CitationRejectionRecord): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.records.push(r);
  }
}

const runs = new InMemoryRuns({ "run-f12": PACK });

describe("VerifyCitation -- 被拒并记录 is one sentence with two verbs", () => {
  it("records the refusal, with what was cited and what offended", async () => {
    const rejections = new Recorder();
    const v = await verifyCitation({ runs, rejections }, {
      runId: "run-f12",
      citedSegmentIds: ["seg-a", "seg-ghost"],
    });

    expect(v).toEqual({ allowed: false, offendingSegmentIds: ["seg-ghost"] });
    expect(rejections.records).toEqual([
      { runId: "run-f12", citedSegmentIds: ["seg-a", "seg-ghost"], offendingSegmentIds: ["seg-ghost"] },
    ]);
  });

  it("records NOTHING when the citation is clean", async () => {
    // The other half. A recorder that logged every verification would drown the signal, and
    // "how often does the model fabricate citations" would go back to being unanswerable.
    const rejections = new Recorder();
    const v = await verifyCitation({ runs, rejections }, { runId: "run-f12", citedSegmentIds: ["seg-a"] });
    expect(v.allowed).toBe(true);
    expect(rejections.records).toEqual([]);
  });

  it("a recorder that fails takes the whole call down -- an unrecorded refusal is not a refusal", async () => {
    const rejections = new Recorder(new Error("audit sink unavailable"));
    await expect(
      verifyCitation({ runs, rejections }, { runId: "run-f12", citedSegmentIds: ["seg-ghost"] }),
    ).rejects.toThrow(/audit sink unavailable/);
  });

  it("an unknown run is RUN_NOT_FOUND, not an empty pack that rejects everything", async () => {
    // Collapsing them would answer "nothing you cited is in the pack" for a runId that does not
    // exist -- true-sounding, and it hides a wiring bug behind a plausible refusal.
    const rejections = new Recorder();
    await expect(
      verifyCitation({ runs, rejections }, { runId: "run-nope", citedSegmentIds: ["seg-a"] }),
    ).rejects.toBeInstanceOf(RunNotFoundError);
    expect(rejections.records).toEqual([]);
  });
});

/* ───────────────────────────────── contract gaps, asserted ───────────────────────────── */

describe("⚠ signed-contract gaps -- asserted so they cannot be forgotten", () => {
  it("`CITATION_OUT_OF_PACK` describes a condition the `out` already carries", () => {
    // The contract models one condition twice: `err` says throw, `out` says return
    // `{ allowed, offendingSegmentIds }`. Under the `err` reading those two fields are dead --
    // `allowed` could only ever be true. Implemented as the value; the code is left unused.
    expect(CP.operations.verifyCitation.err).toContain("CITATION_OUT_OF_PACK");
    expect(CP.ContextPackReason.options).toContain("CITATION_OUT_OF_PACK");
    // The evidence that the `err` reading would have destroyed something: a populated
    // `offendingSegmentIds` is reachable, and it is the only place the person is told WHICH
    // citations were fabricated.
    expect(verifyCitations(PACK, ["seg-ghost"]).offendingSegmentIds).toEqual(["seg-ghost"]);
  });

  it("there is nowhere in `provenance` to record a refused citation", () => {
    // V1 requires 记录. The audit contract is a closed enum (new members need an ADR) and has
    // no member for it; `unauthorized-attempt` is the security channel and a hallucinating
    // model would bury the intrusion attempts it exists to surface.
    const types = PV.ProvenanceEventType.options as readonly string[];
    expect(types.some((t) => /citation/i.test(t))).toBe(false);
    // ...and even with an event type, the record could not say what it was about: `target.kind`
    // cannot name a run or a segment.
    const targetKinds = PV.ProvenanceEvent.shape.target.shape.kind.options as readonly string[];
    expect(targetKinds).not.toContain("segment");
    expect(targetKinds).not.toContain("context-pack");
    // ⇒ F12 records through its own port. When the contract gains a home for this, the three
    // assertions above turn red and the port collapses into `provenance`.
  });

  it("a claim's opposing evidence can be un-citable -- R7 and I-6 pull opposite ways", () => {
    // `retrieve-candidates.ts` copies `contradictingSegmentIds` through untouched, on purpose:
    // narrowing it to what survived ranking is how opposing evidence disappears (I-12). I-6
    // then bars the model from citing exactly that. Both rules are signed; together they hand
    // the model a claim it cannot substantiate.
    expect(unciteableClaimEvidence(PACK)).toEqual(["seg-opposing"]);
    expect(verifyCitations(PACK, ["seg-opposing"]).allowed).toBe(false);
    // Not a fixture artefact -- when every claim's evidence IS in items, the set is empty, so
    // this measures the pack rather than always reporting a problem.
    const consistent: ContextPack = {
      ...PACK,
      claims: [{ ...PACK.claims[0]!, contradictingSegmentIds: ["seg-b"] }],
    };
    expect(unciteableClaimEvidence(consistent)).toEqual([]);
  });
});
