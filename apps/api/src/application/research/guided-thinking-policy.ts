import type { ModelCallPort } from "../agent-run/ports";

/** Grounded, structured research is checked with schema, quotes and independent
 * quality reviews. Hidden thinking must not delay its first visible body or
 * silently return on streamed retries. User-requested thinking-off applies to
 * planning, source screening, evidence, writing and review alike. */
export function withGuidedThinkingPolicy(model: ModelCallPort): ModelCallPort {
  return {
    complete: (input) => model.complete({ ...input, thinkingMode: "off" }),
    ...(model.completeStream ? { completeStream: (input, emit) => model.completeStream!({ ...input, thinkingMode: "off" }, emit) } : {}),
  };
}
