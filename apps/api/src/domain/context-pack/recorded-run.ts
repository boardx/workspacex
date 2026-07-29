/**
 * What a run leaves behind so that it can be REPLAYED -- and, deliberately, what it does not.
 *
 * ## The distinction the whole feature rests on
 *
 * There are two things you can store when a Context Pack is assembled:
 *
 *   (a) the PACK          -- items[], claims[], omissions[]
 *   (b) the INPUTS        -- the candidate set, the decisions, the threshold, the budget
 *
 * Storing (a) and handing it back on request satisfies every assertion anybody writes about
 * replay: `replay(runId).items` deep-equals the original items, byte for byte, forever. It
 * is also not a replay. It proves the database can hold a JSON document. If the assembler
 * became nondeterministic tomorrow -- a `Map` iteration order leaking into the ranking, a
 * `Date.now()` in a tie-break -- (a) would keep returning the same green.
 *
 * So this file records (b), and replay RE-RUNS the deterministic half of assembly over it.
 * `context_packs` has no column that can hold an item, which is asserted mechanically against
 * `information_schema` in `context-pack-pinned-replay.test.ts`: the answer is not merely
 * "not read from storage", it is **not storable**.
 *
 * ## Which half of assembly is deterministic, stated honestly
 *
 * Steps ①-⑥ of `AssembleContextPack` (permission/tenant filtering, query planning, five-way
 * recall, RRF, rerank, diversity) are NOT reproducible from a runId and never will be: the
 * index moves, permissions change, and a reranker is a model. Replaying THOSE would answer a
 * different question ("what would this query return now") and would break I-7 outright --
 * upstream changes would rewrite a pinned pack.
 *
 * Steps ⑦-⑧ (threshold → dedup → budget → item construction → closure/structure checks) are
 * pure, and they are the steps that decide **what the model actually saw**. Those are what
 * replay recomputes, over a frozen candidate set. That is the reading of I-5 this
 * implementation takes, and it is written down here rather than assumed, because the other
 * reading ("re-run retrieval") is the one a reader is likely to expect.
 *
 * ## Why the permission decision id is RECORDED and not re-derived
 *
 * I-11 says every item's `permissionDecisionId` points at a judgement that was really made.
 * Re-authorizing at replay time would produce a NEW decision id -- so the replayed pack would
 * cite a judgement that did not exist when the conclusion was reached, and an auditor
 * following the id would land on the wrong record. Worse, a permission revoked since would
 * make the historical pack shrink, which is exactly "上游变化改写了它" (I-7).
 */
import type { z } from "zod";
import { contextPack as CP } from "@repo/contracts";
import type { ContextItem, ContextItemAnchor } from "./context-item";
import type { ClaimRef, Omission } from "./pack-structure";
import { relevanceOf, type ScreenableCandidate } from "./screening";

export type QueryContext = z.infer<typeof CP.QueryContext>;
export type RetrievalChannelPlan = z.infer<typeof CP.RetrievalChannelPlan>;
export type FilterAction = z.infer<typeof CP.FilterAction>;
export type RetrievalChannel = z.infer<typeof CP.RetrievalChannel>;
export type ContextSourceType = z.infer<typeof CP.ContextSourceType>;

/**
 * One candidate, exactly as it stood when the run happened.
 *
 * It carries BOTH the item-side facts and the screening-side facts, because the screening
 * decision and the item it produces have to come from the same frozen row. Two stores would
 * be two things to keep in step, and the failure mode is an item whose `score` says one thing
 * while the omission next to it explains a decision taken on another number.
 */
export interface RecordedCandidate {
  readonly segmentId: string;
  readonly content: string;
  readonly sourceType: ContextSourceType;
  readonly artifactVersionId: string;
  readonly anchor: ContextItemAnchor;
  readonly retrievalReasons: readonly FilterAction[];
  readonly channels: readonly RetrievalChannel[];
  readonly score: number;
  /** I-11. Recorded, never re-derived -- see the header. */
  readonly permissionDecisionId: string;
  /** The [0,1] figure the threshold acted on, with the provenance `Relevance` demands. */
  readonly relevance: number;
  readonly relevanceProvenance: string;
  readonly tokens: number;
  readonly fingerprint: string;
  /** A4: exempt from the threshold; a budget overflow is an error, not a discard. */
  readonly manual?: boolean;
  /**
   * Was this material marked confidential AT ASSEMBLY TIME (D-U1 / I-10)?
   *
   * ⚠ Recorded, and NOT the whole answer. `resolvePackModelConstraint` unions this with the
   * current classification, so that material reclassified after the run still confines it.
   * Recorded-only would let a leak survive a reclassification; current-only would let a
   * deleted index row quietly downgrade a historical run. See
   * `application/context-pack/resolve-pack-model-constraint.ts`.
   */
  readonly confidential: boolean;
}

/** Everything one run needs in order to be replayed. Frozen at assembly. */
export interface RecordedRun {
  readonly runId: string;
  readonly packId: string;
  readonly orgId: string;
  readonly query: QueryContext;
  readonly retrievalPlan: readonly RetrievalChannelPlan[];
  /** In RANKED ORDER. The order is data: it is what the model saw, and it feeds the budget cut. */
  readonly candidates: readonly RecordedCandidate[];
  /**
   * Candidates a permission decision withheld, already shaped as `unauthorized` omissions.
   *
   * Separate from `candidates` because they never reached screening -- but they ARE part of
   * the candidate set for I-2's closure check, and leaving them out would make that check
   * pass over a smaller universe than the one that existed.
   */
  readonly withheld: readonly Omission[];
  /** ADR-021: candidates with no usable anchor. Disjoint from `candidates`, checked below. */
  readonly unanchorable: readonly string[];
  readonly claims: readonly ClaimRef[];
  /** The threshold THIS run applied. Read back, never recomputed (O-36 / F11's `ports.ts`). */
  readonly thresholdUsed: number;
}

/** Every id that entered the pipeline -- the universe I-2's closure is checked against. */
export function recordedCandidateIds(run: RecordedRun): readonly string[] {
  return [
    ...run.candidates.map((c) => c.segmentId),
    ...run.withheld.map((o) => o.ref),
    ...run.unanchorable,
  ];
}

export class MalformedRecordedRunError extends Error {}

/**
 * Refuse a recording that cannot produce a well-formed pack, at the moment it is RECORDED.
 *
 * Checked on the way in rather than only on the way out: a run recorded with an id in both
 * `candidates` and `unanchorable` would replay into a pack where one segment is both an item
 * and an omission -- `finalizePack` would throw on it, forever, and the run would be
 * permanently unreplayable with the error surfacing at audit time, i.e. at the worst moment.
 */
export function assertRecordable(run: RecordedRun): void {
  const ids = new Set(run.candidates.map((c) => c.segmentId));
  const overlapping = [
    ...run.unanchorable.filter((id) => ids.has(id)),
    ...run.withheld.map((o) => o.ref).filter((id) => ids.has(id)),
  ];
  if (overlapping.length > 0) {
    throw new MalformedRecordedRunError(
      `these ids are recorded both as screenable candidates and as already-discarded: ` +
        `${overlapping.join(", ")} -- a replay would make each of them an item AND an omission`,
    );
  }
  const dupes = run.candidates.map((c) => c.segmentId).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupes.length > 0) {
    throw new MalformedRecordedRunError(
      `duplicate candidate ids in the recording: ${dupes.join(", ")} -- the pack would cite one segment twice`,
    );
  }
}

/** The screening view of a recorded candidate. Nothing added, nothing invented. */
export function toScreenable(c: RecordedCandidate): ScreenableCandidate {
  return {
    segmentId: c.segmentId,
    relevance: relevanceOf(c.relevance, c.relevanceProvenance),
    tokens: c.tokens,
    fingerprint: c.fingerprint,
    ...(c.manual === true ? { manual: true } : {}),
  };
}

/**
 * The item view. Eight of the nine fields come straight off the recording; none is computed.
 *
 * Deliberately NOT `{ ...c }`: `RecordedCandidate` carries screening fields (`tokens`,
 * `fingerprint`, `relevance`, `confidential`) that are not part of `ContextItem`, and
 * `ContextItem` is `.strict()`. A spread would put them on the wire the day the strict parse
 * is relaxed, and `confidential` in particular is a fact about the material that the contract
 * has deliberately not given the client (see `KNOWN_CONTRACT_GAPS.G7`).
 */
export function toContextItem(c: RecordedCandidate): ContextItem {
  return {
    segmentId: c.segmentId,
    content: c.content,
    sourceType: c.sourceType,
    artifactVersionId: c.artifactVersionId,
    anchor: c.anchor,
    retrievalReasons: [...c.retrievalReasons],
    channels: [...c.channels],
    score: c.score,
    permissionDecisionId: c.permissionDecisionId,
  };
}
