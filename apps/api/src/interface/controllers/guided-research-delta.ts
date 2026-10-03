import { createHash } from "node:crypto";
import { research as C } from "@repo/contracts";
import type { z } from "zod";
import type { ResearchRuntime } from "../../application/research/guided-runtime-ports";

export function fieldFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value) ?? "undefined").digest("hex");
}

export function runtimeDelta(state: ResearchRuntime, known: z.infer<typeof C.GuidedResearchRuntimeKnownFields>) {
  const changes: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const key of C.GuidedResearchRuntimeKnownFields.keySchema.options) {
    const value = state[key];
    if (known[key] === fieldFingerprint(value)) continue;
    if (value === undefined) {
      if (known[key]) removed.push(key);
    } else changes[key] = value;
  }
  return C.GuidedResearchRuntimePatch.parse({ type: "patch", sessionId: state.sessionId,
    version: state.version, revision: state.revision, changes, removed });
}

export function rememberRuntimeDelta(known: z.infer<typeof C.GuidedResearchRuntimeKnownFields>, patch: z.infer<typeof C.GuidedResearchRuntimePatch>) {
  for (const key of C.GuidedResearchRuntimeKnownFields.keySchema.options) {
    if (Object.hasOwn(patch.changes, key)) known[key] = fieldFingerprint(patch.changes[key]);
    else if (patch.removed.includes(key)) known[key] = fieldFingerprint(undefined);
  }
}
