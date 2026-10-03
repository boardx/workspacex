import { research as C } from "@repo/contracts";
import { ApiError } from "./api-client";
import type { z } from "zod";

type Runtime = z.infer<typeof C.GuidedResearchRuntime>;
export type RuntimePatch = z.infer<typeof C.GuidedResearchRuntimePatch>;
export async function researchFieldFingerprints(state: Runtime) {
  const pairs = await Promise.all(C.GuidedResearchRuntimeKnownFields.keySchema.options.map(async (key) => {
    const bytes = new TextEncoder().encode(JSON.stringify(state[key]) ?? "undefined");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [key, Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")] as const;
  }));
  return C.GuidedResearchRuntimeKnownFields.parse(Object.fromEntries(pairs));
}

export function mergeResearchDelta(current: Runtime, patch: RuntimePatch): Runtime {
  if (patch.sessionId !== current.sessionId) throw new ApiError(502, "RESEARCH_STATE_SESSION_MISMATCH", null);
  if (patch.version < current.version || (patch.version === current.version && patch.revision < current.revision)) return current;
  const next = { ...current, ...patch.changes, version: patch.version, revision: patch.revision };
  for (const key of patch.removed) delete next[key];
  // Validate the reconstructed snapshot, not merely individual patch fields.
  return C.GuidedResearchRuntime.parse(next);
}
