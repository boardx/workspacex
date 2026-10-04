import type { GuidedResearchRuntime } from "./live-guided-research-api";

/** The command was acknowledged; only its omitted content remains unavailable. */
export class ResearchRuntimeHydrationError extends Error {
  constructor(readonly snapshot: GuidedResearchRuntime, readonly originalError: unknown) {
    super("Research content hydration failed");
    this.name = "ResearchRuntimeHydrationError";
  }
}
