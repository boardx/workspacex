/**
 * `GateAiCall` (F12) -- the前置闸门 every AI call has to pass, per runId.
 *
 * Thin on purpose: the decision is `domain/context-pack/ai-gate`, and all this layer adds is
 * "which run" and the contract's `RUN_NOT_FOUND`. Putting any part of the decision here would
 * put it out of reach of the pure-function assertions that make V5/V6 checkable.
 *
 * ⚠ An unknown run THROWS rather than returning `{ allowed: false, blockReason: null }`. The
 * latter would be a block with no reason, which renders as one of the seven UI states with
 * nothing in it, and would also make "the id was wrong" indistinguishable from "the pack was
 * empty" -- the exact collapse `RetrievalUnavailableError` was written to avoid on the other
 * side.
 */
import { gateDecision, type GateVerdict } from "../../domain/context-pack/ai-gate";
import { RunNotFoundError, type ContextRunStore } from "./ports";

export interface GateAiCallDeps {
  readonly runs: ContextRunStore;
}

export async function gateAiCall(
  deps: GateAiCallDeps,
  input: { readonly runId: string },
): Promise<GateVerdict> {
  const state = await deps.runs.gateState(input.runId);
  if (state === undefined) throw new RunNotFoundError(input.runId);
  return gateDecision(state);
}
