import { assertCurrentRunLease } from "./run-lease";
import type { ModelDeltaMetadata } from "./ports";
/**
 * Phase 14 F01 (`kernel-gateway` 契约束 UC-1 `forwardRun`) -- the ONE place `execute-run.ts`
 * asks a `ModelCallPort` for an answer.
 *
 * ## What this replaces
 *
 * `execute-run.ts` used to pick between THREE shapes of "get an answer" inline:
 * `executeToolLoop` (#725, already retired by #741), the `useLazySkillLoading` pseudo-loop
 * (design-delta `skill-lazy-loading`, retired by this feature), and a plain `completeStream`/
 * `complete()` fallback. R4 E3 requires all three physically gone from `execute-run.ts`'s own
 * source -- this function is the single call site that took their place, extracted into its
 * own file so `execute-run.ts` itself contains no branching on `deps.model`'s shape at all.
 *
 * ## Why this is a normalization, not a fourth branch
 *
 * `completeWithProgress`/`completeStream`/`complete` are already documented on `ModelCallPort`
 * itself as three OBSERVATIONAL shapes of the exact same one call (see that interface's own
 * doc comments) -- a provider implements whichever one its transport actually supports, never
 * more than one. This function picks the richest shape a given port actually offers and calls
 * it; it does not decide what to send, retry anything, or run more than one call. The priority
 * order (`completeWithProgress` > `completeStream` > `complete`) is exactly the priority
 * `execute-run.ts` already enforced before this feature (see `#742`/`#654`阶段2a's own history
 * in `ModelCallPort`'s doc comments) -- this is that same dispatch, unchanged, just no longer
 * inline in the gateway file itself.
 */
import type {
  ModelCallCompletion, ModelCallInput, ModelCallPort, ModelCallProgressEvent,
} from "./ports";

export async function invokeKernel(
  model: ModelCallPort,
  input: ModelCallInput,
  onProgress: (event: ModelCallProgressEvent) => Promise<void>,
  onDelta: (delta: string, metadata?: ModelDeltaMetadata) => Promise<void>,
): Promise<ModelCallCompletion> {
  await assertCurrentRunLease();
  // `supportsProgress`, when the port implements it (today: only `RoutingModelCallPort`),
  // narrows the gate to the run's OWN pinned provider -- see that method's doc comment for
  // why a router-shaped port must not take this branch for a provider that only streams
  // tokens (it would silently discard real streaming deltas). A port that doesn't implement
  // `supportsProgress` (every single-provider port and test fake) keeps presence-alone as
  // the gate, since presence alone is already accurate for those.
  const completeWithProgress = model.completeWithProgress?.bind(model);
  const wantsProgress = completeWithProgress !== undefined
    && (model.supportsProgress ? model.supportsProgress(input.modelProvider) : true);
  if (wantsProgress && completeWithProgress) {
    return completeWithProgress(input, onProgress, onDelta);
  }
  if (model.completeStream) {
    return model.completeStream(input, onDelta);
  }
  return model.complete(input);
}
