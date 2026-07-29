/**
 * Ports F12 needs: reading a run back, and recording a refused citation.
 *
 * Defined here, implemented by `infrastructure`. **F12 ships no PostgreSQL implementation** --
 * `ContextPackStore` persistence is F13's (`context_packs`), and building a table now would be
 * guessing at the shape F13 has to live with. What F12 owns is the SHAPE of the question the
 * gate and the citation check ask of a run.
 */
import type { RunState } from "../../domain/context-pack/ai-gate";
import type { ContextPack } from "../../domain/context-pack/pack-structure";

/** `RUN_NOT_FOUND` -- the contract's code, carried rather than re-invented at the edge. */
export class RunNotFoundError extends Error {
  readonly reason = "RUN_NOT_FOUND" as const;
  constructor(readonly runId: string) {
    super(`no context-pack run "${runId}"`);
  }
}

export interface ContextRunStore {
  /**
   * The run's gate-relevant state, or undefined if there is no such run.
   *
   * Returns a `RunState` rather than a `ContextPack` because a run whose retrieval failed has
   * no pack and still has to be answerable -- see the note on `RunState`.
   */
  gateState(runId: string): Promise<RunState | undefined>;
  /** The assembled pack, for citation checking. Undefined for unknown AND for failed runs. */
  pack(runId: string): Promise<ContextPack | undefined>;
}

/**
 * One refused citation, as recorded.
 *
 * ⚠ **Contract gap, deliberately not papered over.** V1 says 引用包外证据被拒**并记录**, and
 * there is nowhere in the signed contract to record it:
 *
 *   - `provenance.ProvenanceEventType` is a closed enum (new members require an ADR, same
 *     ruling as the omission reasons) and none of its 17 members means "the model cited
 *     evidence that was not in its pack". The nearest, `unauthorized-attempt`, is the security
 *     channel: a hallucinating model would flood it and bury the real intrusion attempts it
 *     exists to surface. Writing it there is a lie that costs something.
 *   - `ProvenanceEvent.target.kind` has no member that can name a run or a segment, so even
 *     with an event type the record could not say what it was about.
 *
 * So this port is F12-local and its records do not yet reach the one audit surface (coherence
 * X-2 says there must be exactly one). That is a gap, not a design: asserted in
 * `tests/kernel/citation-integrity.test.ts` so that it turns red when the contract gains a
 * home for it. Inventing an event type here would have closed the gap on paper and left the
 * audit trail wrong.
 */
export interface CitationRejectionRecord {
  readonly runId: string;
  readonly citedSegmentIds: readonly string[];
  readonly offendingSegmentIds: readonly string[];
}

export interface CitationRejectionRecorder {
  /**
   * Persist a refusal. **May throw** -- and callers must let it: see `verify-citation.ts`.
   */
  record(record: CitationRejectionRecord): Promise<void>;
}

export const CONTEXT_RUN_STORE = Symbol("ContextRunStore");
export const CITATION_REJECTION_RECORDER = Symbol("CitationRejectionRecorder");
