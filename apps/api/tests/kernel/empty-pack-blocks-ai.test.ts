import { describe, expect, it } from "vitest";
import { contextPack as CP } from "@repo/contracts";
import { gateDecision, type RunState } from "../../src/domain/context-pack/ai-gate";
import { citableSegmentIds } from "../../src/domain/context-pack/citation-integrity";
import { gateAiCall } from "../../src/application/context-pack/gate-ai-call";
import { RunNotFoundError, type ContextRunStore } from "../../src/application/context-pack/ports";
import type { ContextPack } from "../../src/domain/context-pack/pack-structure";
import type { ContextItem } from "../../src/domain/context-pack/context-item";

/**
 * F12 -- V5 / V6: a pack with nothing in it blocks the AI call, and so does a retrieval failure.
 *
 * The property is not "the empty case returns false". It is that `allowed: true` is reachable
 * from EXACTLY ONE region of the input space -- assembled, non-empty, and with a model it is
 * allowed to use -- and that every other point in that space blocks. So the decision space is
 * enumerated rather than sampled: three independent conditions, all eight combinations, and the
 * assertion is over the whole table. A test that only checked the empty case would pass against
 * an implementation that ignored `localOnly` entirely.
 */

const item = (segmentId: string): ContextItem => ({
  segmentId,
  content: `内容 ${segmentId}`,
  sourceType: "file",
  artifactVersionId: `ver-${segmentId}`,
  anchor: { page: 4 },
  retrievalReasons: ["recall"],
  channels: ["fts"],
  score: 0.6,
  permissionDecisionId: `dec-${segmentId}`,
});

const packWith = (items: ContextItem[]): ContextPack => ({
  packId: "pack-f12-gate",
  runId: "run-f12-gate",
  query: {
    tenantId: "org-f12", principalId: "u-energy", projectIds: ["proj-new"], task: "answer",
    query: "这个项目有什么材料", timeRange: null, allowedSensitivity: ["internal"],
    tokenBudget: 120_000, freshnessRequirement: null, evidencePolicy: "reviewed",
  },
  retrievalPlan: [],
  items,
  claims: [],
  omissions: [],
  tokensUsed: 0,
  pinnedSnapshotId: null,
});

const FULL = packWith([item("seg-a")]);
const EMPTY = packWith([]);

const assembled = (
  pack: ContextPack,
  localOnly: boolean,
  localModelAvailable: boolean,
): RunState => ({ kind: "assembled", pack, localOnly, localModelAvailable });

/* ─────────────────────────── the whole decision space, enumerated ────────────────────── */

describe("`allowed: true` is reachable from exactly one region", () => {
  const CUBE = [false, true];

  it("blocks everywhere except assembled ∧ non-empty ∧ model-available", () => {
    const allowedStates: string[] = [];
    for (const nonEmpty of CUBE) {
      for (const localOnly of CUBE) {
        for (const localModelAvailable of CUBE) {
          const state = assembled(nonEmpty ? FULL : EMPTY, localOnly, localModelAvailable);
          const v = gateDecision(state);
          // The reason is a closed-enum member or null. Asserted for EVERY point, so a branch
          // returning a hand-written string cannot hide in a corner of the table.
          if (v.blockReason !== null) expect(CP.ContextPackReason.options).toContain(v.blockReason);
          if (v.allowed) allowedStates.push(`${nonEmpty}/${localOnly}/${localModelAvailable}`);
        }
      }
    }
    // Exactly the two points where there is evidence to cite and a model allowed to see it.
    expect(allowedStates.sort()).toEqual(["true/false/false", "true/false/true", "true/true/true"].sort());
  });

  it("a retrieval failure blocks with its own reason, never with the empty one", () => {
    // E1 and E3 must stay distinguishable: collapsing them turns "the index is down" into
    // "your project has no material", which is a sentence that makes people go and upload
    // things. `retrieve-candidates.ts` refuses partial results for the same reason.
    expect(gateDecision({ kind: "retrieval-unavailable" }))
      .toEqual({ allowed: false, blockReason: "RETRIEVAL_UNAVAILABLE" });
  });

  it("names the three reasons, one per cause", () => {
    expect(gateDecision(assembled(EMPTY, false, true)))
      .toEqual({ allowed: false, blockReason: "EMPTY_CANDIDATE_SET" });
    expect(gateDecision(assembled(FULL, true, false)))
      .toEqual({ allowed: false, blockReason: "CONFIDENTIAL_REQUIRES_LOCAL_MODEL" });
    expect(gateDecision(assembled(FULL, false, true)))
      .toEqual({ allowed: true, blockReason: null });
  });
});

/* ─────────────────────────── the permissive direction, explicitly ────────────────────── */

describe("a real pack is NOT blocked", () => {
  it("passes an assembled, non-empty, unconstrained run", () => {
    // A gate that blocked everything would satisfy every assertion above about blocking, and
    // would make the product unusable. This is the counter-proof, in the suite.
    expect(gateDecision(assembled(FULL, false, false)).allowed).toBe(true);
    expect(gateDecision(assembled(packWith([item("s1"), item("s2")]), true, true)).allowed).toBe(true);
  });

  it("a pack grows past one item without changing the verdict", () => {
    // Closure, not size: the gate asks "is there any citable evidence", never "how much".
    const many = packWith(["a", "b", "c", "d"].map((s) => item(`seg-${s}`)));
    expect(gateDecision(assembled(many, false, true))).toEqual({ allowed: true, blockReason: null });
  });
});

/* ───────────────────── the gate and the citation check ask the same question ─────────── */

describe("no ungrounded generation: allowed ⇒ there is something citable", () => {
  it("every allowed state has a non-empty citable set, and every empty pack blocks", () => {
    // This is the load-bearing link between the two halves of F12. If the gate ever allows a
    // call whose citable set is empty, then every citation that call produces is an offence --
    // i.e. the model can only answer by fabricating, which is precisely 无上下文直接生成.
    for (const pack of [FULL, EMPTY, packWith([item("x")])]) {
      const v = gateDecision(assembled(pack, false, true));
      expect(v.allowed).toBe(citableSegmentIds(pack).size > 0);
    }
  });
});

/* ───────────────────────────────────── fail-closed ───────────────────────────────────── */

describe("an unmodelled state does not become permission", () => {
  it("throws rather than returning a verdict", () => {
    // Fail-closed in the only direction that cannot be misread: a thrown error is never
    // mistaken for `allowed: true`, whereas a silent `{ allowed: false, blockReason: null }`
    // renders as a blocked UI with no explanation and hides that a state exists nobody modelled.
    expect(() => gateDecision({ kind: "half-assembled" } as unknown as RunState))
      .toThrow(/unmodelled run state/);
  });
});

/* ────────────────────────── the verdict matches the contract ─────────────────────────── */

describe("the verdict is the contract's `out`, and the contract refuses drift", () => {
  const out = CP.operations.gateAiCall.out;

  it("both verdicts parse", () => {
    expect(out.safeParse(gateDecision(assembled(FULL, false, true))).success).toBe(true);
    expect(out.safeParse(gateDecision(assembled(EMPTY, false, true))).success).toBe(true);
    expect(out.safeParse(gateDecision({ kind: "retrieval-unavailable" })).success).toBe(true);
  });

  it("an extra key is refused, and so is a block reason from outside the enum", () => {
    expect(out.safeParse({ allowed: false, blockReason: "EMPTY_CANDIDATE_SET", retryAfter: 5 }).success).toBe(false);
    expect(out.safeParse({ allowed: false, blockReason: "NO_MATERIAL" }).success).toBe(false);
    expect(out.safeParse({ allowed: false }).success).toBe(false);
  });
});

/* ───────────────────────────────── the use case, per runId ───────────────────────────── */

class Runs implements ContextRunStore {
  constructor(private readonly states: Record<string, RunState>) {}
  async gateState(runId: string): Promise<RunState | undefined> {
    return this.states[runId];
  }
  async pack(runId: string): Promise<ContextPack | undefined> {
    const s = this.states[runId];
    return s?.kind === "assembled" ? (s.pack as ContextPack) : undefined;
  }
}

describe("GateAiCall", () => {
  const runs = new Runs({
    "run-full": assembled(FULL, false, true),
    "run-empty": assembled(EMPTY, false, true),
    "run-down": { kind: "retrieval-unavailable" },
  });

  it("gates each run on its own state", async () => {
    expect(await gateAiCall({ runs }, { runId: "run-full" })).toEqual({ allowed: true, blockReason: null });
    expect(await gateAiCall({ runs }, { runId: "run-empty" }))
      .toEqual({ allowed: false, blockReason: "EMPTY_CANDIDATE_SET" });
    expect(await gateAiCall({ runs }, { runId: "run-down" }))
      .toEqual({ allowed: false, blockReason: "RETRIEVAL_UNAVAILABLE" });
  });

  it("an unknown run throws RUN_NOT_FOUND instead of blocking with no reason", async () => {
    await expect(gateAiCall({ runs }, { runId: "run-nope" })).rejects.toBeInstanceOf(RunNotFoundError);
  });
});

/* ───────────────────────────────── contract gaps, asserted ───────────────────────────── */

describe("⚠ signed-contract gaps -- asserted so they cannot be forgotten", () => {
  it("`RETRIEVAL_UNAVAILABLE` is a blockReason the ContextPack shape cannot represent", () => {
    // `gateAiCall` takes only a runId, so producing this reason requires the store to remember
    // a run whose assembly FAILED -- and `ContextPack` has no field for a failed run (no
    // status, no reason, and every section is required). As signed, a failed run leaves nothing
    // behind and its runId can only answer RUN_NOT_FOUND, which reads as "bad id" and invites
    // exactly the retry-without-context the reason exists to forbid.
    expect(CP.operations.gateAiCall.out.shape.blockReason.unwrap().options)
      .toContain("RETRIEVAL_UNAVAILABLE");
    const packFields = Object.keys(CP.ContextPack.shape);
    expect(packFields).not.toContain("status");
    expect(packFields).not.toContain("failureReason");
    // ⇒ the failed run lives in `RunState`, a type in the port layer, until the contract has a
    // place for it. F13 owns the persistence and inherits this.
  });

  it("`EMPTY_CANDIDATE_SET` is also what gets said when everything was WITHHELD", () => {
    // Two different facts, one code. "This project has no material" and "there is material and
    // you may not see it" produce the same block, and the second reads to the requester as the
    // first. There is no honest alternative inside the closed enum -- `unauthorized` is an
    // omission reason, not a block reason -- so the lossy answer is given and registered here
    // rather than a new code being invented.
    const withheldOnly = { ...EMPTY, omissions: [
      { ref: "seg-secret", reason: "unauthorized" as const, compliance: true, explain: "两层交集鉴权未通过" },
    ] };
    expect(gateDecision(assembled(withheldOnly, false, true)))
      .toEqual({ allowed: false, blockReason: "EMPTY_CANDIDATE_SET" });
    // The distinguishing information exists in the pack -- it is the reason this is a contract
    // gap and not an unknowable. Nothing in `gateAiCall.out` can carry it.
    expect(withheldOnly.omissions.some((o) => o.compliance)).toBe(true);
    expect(Object.keys(CP.operations.gateAiCall.out.shape).sort()).toEqual(["allowed", "blockReason"]);
  });
});
