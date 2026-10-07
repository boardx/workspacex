import { createHash } from "node:crypto";
import { research as C } from "@repo/contracts";
import type { z } from "zod";
import { runtimeProgress } from "./guided-research-progress";
import type { ResearchRuntime } from "../../application/research/guided-runtime-ports";

export function fieldFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value) ?? "undefined").digest("hex");
}

export function runtimeDelta(state: ResearchRuntime, known: z.infer<typeof C.GuidedResearchRuntimeKnownFields>, omitted: ReadonlySet<string> = new Set()) {
  const changes: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const key of C.GuidedResearchRuntimeKnownFields.keySchema.options) {
    if (omitted.has(key)) continue;
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

// Research polling keeps source bodies server-owned; commands/refresh hydrate
// their full values. Other changed state (including terminal reports) still syncs.
export function runtimePollingDelta(state: ResearchRuntime, known: z.infer<typeof C.GuidedResearchRuntimeKnownFields>, requestId?: string, offset = 0, digest?: string, sourceCursor?: string) {
  if (state.currentNode !== "research") return runtimeDelta(state, known);
  const patch = runtimeDelta(state, known, new Set(["sources"]));
  const research = runtimeProgress(state, requestId, offset, digest, sourceCursor).research!;
  return C.GuidedResearchRuntimePatch.parse({ ...patch,
    ...(sourceCursor !== research.cursor ? { research: { cursor: research.cursor, sources: research.sources } } : {}),
  });
}

/** Ordinary plan commands publish stage artifacts and small authoritative controls.
 * Large retained downstream values stay in the client's baseline; only actual
 * resets are sent. GET remains the complete hydration/recovery authority. */
export function runtimePlanStagePatch(state: ResearchRuntime) {
  const stage = new Set<string>(["directions", "outline", "researchPlan", "currentNode", "availableNodes", "generatedNodes",
    "busy", "leaseUntil", "errorCode", "completed", "progress", "proposal", "planRevision", "controlStatus", "sourcePolicy", "executionGoal", "activity",
    "coverage", "claimEvidence", "conflicts", "qualityScore", "publicationReadiness"]);
  const privateHistory = new Set<string>(["brief", "messages", "modelCalls"]);
  const changes: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const key of C.GuidedResearchRuntimeKnownFields.keySchema.options) {
    if (privateHistory.has(key)) continue;
    const value = state[key];
    if (value === undefined) removed.push(key);
    else if (stage.has(key) || value === null || value === false || (Array.isArray(value) && value.length === 0)) changes[key] = value;
  }
  return C.GuidedResearchRuntimePatch.parse({ type: "patch", sessionId: state.sessionId,
    version: state.version, revision: state.revision, changes, removed });
}

/** Only identical whole sources can be shared with an immutable history snapshot.
 * Differing text, document hashes or metadata always retain their complete copy. */
export function compactPreviousSources<T extends { sources: ResearchRuntime["sources"]; reportPrevious?: ResearchRuntime["reportPrevious"] }>(state: T) {
  const previous = state.reportPrevious;
  if (!previous?.sources.length) return state;
  const sources = new Map(state.sources.map(source => [source.id, source]));
  if (sources.size !== state.sources.length || new Set(previous.sources.map(source => source.id)).size !== previous.sources.length) return state;
  const shared = new Set(previous.sources.filter(source => sources.has(source.id) && fieldFingerprint(source) === fieldFingerprint(sources.get(source.id))).map(source => source.id));
  if (!shared.size) return state;
  return { ...state, reportPrevious: { ...previous, sources: previous.sources.filter(source => !shared.has(source.id)) }, previousSourceIds: previous.sources.map(source => source.id) };
}

export function compactRuntimePatch(state: ResearchRuntime, known: z.infer<typeof C.GuidedResearchRuntimeKnownFields>, patch: z.infer<typeof C.GuidedResearchRuntimePatch>) {
  // Metadata does not prove that full source bodies are in the client baseline.
  if (!patch.changes.reportPrevious || (known.sources !== fieldFingerprint(state.sources) && !Object.hasOwn(patch.changes, "sources"))) return patch;
  const projected = compactPreviousSources({ sources: state.sources, reportPrevious: patch.changes.reportPrevious });
  return "previousSourceIds" in projected ? C.GuidedResearchRuntimePatch.parse({ ...patch,
    changes: { ...patch.changes, reportPrevious: projected.reportPrevious }, previousSourceIds: projected.previousSourceIds }) : patch;
}
