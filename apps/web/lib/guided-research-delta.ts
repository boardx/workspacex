import { research as C } from "@repo/contracts";
import { ApiError } from "./api-client";
import type { z } from "zod";

import type { GuidedResearchRuntime as Runtime } from "./guided-research-api";
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
  const { reportSavedChapterCount, ...snapshot } = current;
  const next = { ...snapshot, ...patch.changes, version: patch.version, revision: patch.revision };
  for (const key of patch.removed) delete next[key];
  if (patch.research?.sources) next.sources = patch.research.sources.map((source) => {
    const previous = current.sources.find((item) => item.id === source.id);
    const merged = { ...previous, ...source, content: previous?.content ?? source.presentation?.summary ?? source.title };
    const metadataKeys = C.GuidedResearchRuntimePatch.shape.research.unwrap().shape.sources.unwrap().element.keyof().options;
    for (const key of metadataKeys) if (!Object.hasOwn(source, key)) delete merged[key];
    return merged;
  });
  // Validate the reconstructed snapshot, not merely individual patch fields.
  const parsed = C.GuidedResearchRuntime.parse(next);
  const count = Object.hasOwn(patch.changes, "reportCheckpoint") || patch.removed.includes("reportCheckpoint")
    ? parsed.reportCheckpoint?.chapters.length ?? 0 : reportSavedChapterCount;
  return { ...parsed, ...(count === undefined ? {} : { reportSavedChapterCount: count }) };
}
