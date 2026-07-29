/**
 * V5 / V6 -- the gate an AI call has to get through, and the reason it is a gate and not a flag.
 *
 * ## The property
 *
 * `allowed: true` requires a run that assembled successfully AND has at least one citable item
 * AND, if this run is confined to a local model, a local model to run on. Everything else
 * blocks. Not "degrades to a shorter context", not "proceeds with a warning" -- blocks, because
 * every degradation available here produces the same artefact: a conclusion with no evidence
 * under it, which is indistinguishable from a well-sourced one by the time anyone reads it.
 *
 * `usecases.md` says it twice, in the imperative: 不得生成伪上下文 (E1) and
 * 不得降级为「无上下文直接生成」 (E3/V6).
 *
 * ## Why an empty pack blocks even though it is not an error
 *
 * E1 is a *successful* assembly of a project that has no material. The pack is honest and the
 * empty state is real -- and an AI call on it would be answering from the model's own weights
 * while the interface says "上下文包" above it. The block is not about failure, it is about
 * there being nothing to be faithful to.
 *
 * ## Why the confidential branch does not decide anything
 *
 * D-U1 (含机密整轮本地，不分流) is `identity`'s judgement, and coherence X-5 says this bundle
 * delegates rather than re-deriving it. So `localOnly` arrives as an input. Re-computing it here
 * would fork "product promise" from "org policy", and those two differ in whether they can be
 * switched off at all.
 *
 * ## Fail-closed
 *
 * An unrecognised run state throws. Throwing is the closed direction: a caller cannot mistake a
 * thrown error for permission to proceed, whereas a default `{ allowed: false }` on a state
 * nobody modelled would let the system quietly run in a shape its author never considered.
 */
import { contextPack as CP } from "@repo/contracts";
import type { z } from "zod";
import { citableSegmentIds, type CitablePack } from "./citation-integrity";

export type BlockReason = z.infer<typeof CP.ContextPackReason>;
/** Derived from the contract's `out`. */
export type GateVerdict = z.infer<typeof CP.operations.gateAiCall.out>;

/**
 * What is known about a run at gate time.
 *
 * ⚠ **A failed assembly is a state, not the absence of one.** `RETRIEVAL_UNAVAILABLE` is listed
 * as a `blockReason` of `gateAiCall`, whose only input is a `runId` -- and if a failed assembly
 * left nothing behind, that runId would resolve to `RUN_NOT_FOUND` and the reason could never be
 * produced. The two are not interchangeable: `RUN_NOT_FOUND` says "no such run, check the id"
 * and `RETRIEVAL_UNAVAILABLE` says "your run exists and the index is down, do not generate
 * without it". So the store has to remember failures. Recorded as a contract gap: `ContextPack`
 * has no field in which a failed run can be represented, so this state lives only in the port's
 * type. See `tests/kernel/empty-pack-blocks-ai.test.ts`.
 */
export type RunState =
  | {
      readonly kind: "assembled";
      readonly pack: CitablePack;
      /** From `identity.resolveModelConstraint` (X-5). Not decided here. */
      readonly localOnly: boolean;
      /** Whether a self-hosted model is actually available to serve this run. */
      readonly localModelAvailable: boolean;
    }
  | { readonly kind: "retrieval-unavailable" };

const BLOCK = (blockReason: BlockReason): GateVerdict => ({ allowed: false, blockReason });

export function gateDecision(state: RunState): GateVerdict {
  switch (state.kind) {
    case "retrieval-unavailable":
      return BLOCK("RETRIEVAL_UNAVAILABLE");
    case "assembled": {
      // Confidential before empty: both block, and when a run is confined to local models the
      // actionable fact is the missing model, not the empty result it produced.
      if (state.localOnly && !state.localModelAvailable) {
        return BLOCK("CONFIDENTIAL_REQUIRES_LOCAL_MODEL");
      }
      // The citable set, not `items.length`, so that this stays the same question the citation
      // check asks. If those two ever disagree, a call is allowed through with nothing it may
      // legally cite -- which is the ungrounded generation this gate exists to prevent.
      if (citableSegmentIds(state.pack).size === 0) return BLOCK("EMPTY_CANDIDATE_SET");
      return { allowed: true, blockReason: null };
    }
    default: {
      const never: never = state;
      throw new Error(
        `unmodelled run state ${JSON.stringify(never)} -- refusing to gate an AI call on a ` +
          `state nobody decided the semantics of`,
      );
    }
  }
}
