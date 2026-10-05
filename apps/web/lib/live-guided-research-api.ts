import { research } from "@repo/contracts";
import { ApiError, apiRequest, getStoredSessionToken } from "./api-client";
import { writeResearchMemory } from "./guided-research-memory";
import { streamResearchCommand, type ResearchStreamEvent } from "./guided-research-stream";
import { mergeResearchDelta, researchFieldFingerprints, type RuntimePatch } from "./guided-research-delta";
import { ResearchRuntimeHydrationError } from "./guided-research-hydration";
export { ResearchRuntimeHydrationError } from "./guided-research-hydration";
import type { z } from "zod";

export type GuidedResearchSession = z.infer<typeof research.GuidedResearchSession>;
export type GuidedResearchWorkflowProjection = z.infer<typeof research.GuidedResearchWorkflowProjection>;
export type GuidedResearchNodeCommand = z.infer<typeof research.GuidedResearchNodeCommand>;
export type GuidedResearchDirection = z.infer<typeof research.GuidedResearchDirection>;
export type GuidedResearchOutlineSection = z.infer<typeof research.GuidedResearchOutlineSection>;
export type GuidedResearchBrief = z.infer<typeof research.GuidedResearchBrief>;
export type GuidedResearchTask = z.infer<typeof research.GuidedResearchTask>;
export type GuidedResearchSource = z.infer<typeof research.GuidedResearchSource>;
export type GuidedResearchReport = z.infer<typeof research.GuidedResearchReport>;
export type CreateGuidedResearchSessionInput = z.infer<typeof research.operations.createGuidedResearchSession.in>;
export type GuidedResearchSkillDraft = z.infer<typeof research.GuidedResearchSkillDraft>;
export type GuidedResearchSkillTurnResponse = z.infer<typeof research.GuidedResearchSkillTurnResponse>;

export async function runGuidedResearchSkillTurn(input: z.infer<typeof research.operations.runGuidedResearchSkillTurn.in>): Promise<GuidedResearchSkillTurnResponse> {
  const validated = research.operations.runGuidedResearchSkillTurn.in.parse(input);
  const raw = await apiRequest<unknown>(research.operations.runGuidedResearchSkillTurn.path, {
    method: research.operations.runGuidedResearchSkillTurn.method,
    body: validated,
  });
  return research.operations.runGuidedResearchSkillTurn.out.parse(raw);
}

export async function listGuidedResearchSessions(): Promise<{ items: GuidedResearchSession[] }> {
  const raw = await apiRequest<unknown>(research.operations.listGuidedResearchSessions.path);
  return research.operations.listGuidedResearchSessions.out.parse(raw);
}

export async function createGuidedResearchSession(
  input: CreateGuidedResearchSessionInput,
): Promise<GuidedResearchSession> {
  const validated = research.operations.createGuidedResearchSession.in.parse(input);
  const raw = await apiRequest<unknown>(research.operations.createGuidedResearchSession.path, {
    method: "POST",
    body: validated,
  });
  return research.operations.createGuidedResearchSession.out.parse(raw);
}

export async function getGuidedResearchSession(sessionId: string): Promise<GuidedResearchSession> {
  const input = research.operations.getGuidedResearchSession.in.parse({ sessionId });
  const path = research.operations.getGuidedResearchSession.path.replace(":sessionId", encodeURIComponent(input.sessionId));
  const raw = await apiRequest<unknown>(path);
  return research.operations.getGuidedResearchSession.out.parse(raw);
}

export async function getGuidedResearchWorkflow(sessionId: string): Promise<GuidedResearchWorkflowProjection> {
  const input = research.operations.getGuidedResearchWorkflow.in.parse({ sessionId });
  const path = research.operations.getGuidedResearchWorkflow.path.replace(":sessionId", encodeURIComponent(input.sessionId));
  const raw = await apiRequest<unknown>(path);
  return research.operations.getGuidedResearchWorkflow.out.parse(raw);
}

export async function executeGuidedResearchNodeCommand(
  sessionId: string,
  command: Omit<GuidedResearchNodeCommand, "sessionId">,
): Promise<GuidedResearchWorkflowProjection> {
  const validated = research.operations.executeGuidedResearchNode.in.parse({ ...command, sessionId });
  const path = research.operations.executeGuidedResearchNode.path
    .replace(":sessionId", encodeURIComponent(validated.sessionId))
    .replace(":node", encodeURIComponent(validated.node));
  const raw = await apiRequest<unknown>(path, {
    method: research.operations.executeGuidedResearchNode.method,
    body: validated,
  });
  return research.operations.executeGuidedResearchNode.out.parse(raw);
}

async function checkpointRequest(
  operation: typeof research.operations.confirmResearchBrief
    | typeof research.operations.generateResearchDirections
    | typeof research.operations.confirmResearchDirections
    | typeof research.operations.generateResearchOutline
    | typeof research.operations.confirmResearchOutline
    | typeof research.operations.finishGuidedResearchCollection
    | typeof research.operations.completeGuidedResearchSession,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<GuidedResearchSession> {
  const path = operation.path.replace(":sessionId", encodeURIComponent(sessionId));
  const raw = await apiRequest<unknown>(path, { method: operation.method, body });
  return operation.out.parse(raw);
}

export const confirmResearchBrief = (
  sessionId: string,
  input: Omit<z.infer<typeof research.operations.confirmResearchBrief.in>, "sessionId">,
) => checkpointRequest(research.operations.confirmResearchBrief, sessionId, input);
export const generateResearchDirections = (sessionId: string) =>
  checkpointRequest(research.operations.generateResearchDirections, sessionId, {});
export const confirmResearchDirections = (
  sessionId: string,
  input: Omit<z.infer<typeof research.operations.confirmResearchDirections.in>, "sessionId">,
) => checkpointRequest(research.operations.confirmResearchDirections, sessionId, input);
export const generateResearchOutline = (sessionId: string) =>
  checkpointRequest(research.operations.generateResearchOutline, sessionId, {});
export const confirmResearchOutline = (
  sessionId: string,
  input: Omit<z.infer<typeof research.operations.confirmResearchOutline.in>, "sessionId">,
) => checkpointRequest(research.operations.confirmResearchOutline, sessionId, input);
export const finishGuidedResearchCollection = (
  sessionId: string,
  input: Omit<z.infer<typeof research.operations.finishGuidedResearchCollection.in>, "sessionId">,
) => checkpointRequest(research.operations.finishGuidedResearchCollection, sessionId, input);
export const completeGuidedResearchSession = (sessionId: string) =>
  checkpointRequest(research.operations.completeGuidedResearchSession, sessionId, {});

export type GuidedResearchRuntime = z.infer<typeof research.GuidedResearchRuntime> & {
  /** Display projection only; the durable checkpoint remains server-owned. */
  reportSavedChapterCount?: number;
};
export type GuidedResearchRuntimeCommand = z.infer<typeof research.GuidedResearchRuntimeCommand>;
export type GuidedResearchRuntimeDraft = z.infer<typeof research.GuidedResearchRuntimeDraft>;
export async function getResearchRuntime(sessionId: string, signal?: AbortSignal): Promise<GuidedResearchRuntime> {
  const op = research.operations.getGuidedResearchRuntime;
  return research.GuidedResearchRuntime.parse(await apiRequest(op.path.replace(":sessionId", encodeURIComponent(sessionId)), { method: op.method, signal }));
}
export async function executeResearchRuntime(input: GuidedResearchRuntimeCommand, onEvent?: (event: ResearchStreamEvent) => void, signal?: AbortSignal, baseline?: GuidedResearchRuntime): Promise<GuidedResearchRuntime> {
  if (baseline && baseline.sessionId !== input.sessionId) throw new Error("Research baseline belongs to another session");
  if (onEvent) return streamResearchCommand(input, onEvent, signal, baseline);
  const op = research.operations.executeGuidedResearchRuntime;
  const body = baseline ? { ...input, knownFields: await researchFieldFingerprints(baseline) } : input;
  const result = op.out.parse(await apiRequest(op.path.replace(":sessionId", encodeURIComponent(input.sessionId)), { method: op.method, body }));
  if ("type" in result && result.type === "patch") {
    if (result.sessionId !== input.sessionId) throw new ApiError(502, "RESEARCH_STATE_SESSION_MISMATCH", null);
    const merged = baseline ? mergeResearchDelta(baseline, result) : undefined;
    // A stage response omits bodies. Refresh when the operation produced message
    // history, archived visible report content, or entered actual source research.
    // Otherwise ordinary plan edits can keep their complete local baseline.
    const hadReportContent = Boolean(baseline?.report || baseline?.reportDraft || baseline?.reportCheckpoint?.chapters.length || baseline?.reportStream?.text);
    const reportCleared = hadReportContent && merged && !merged.report && !merged.reportDraft && !merged.reportCheckpoint?.chapters.length && !merged.reportStream?.text;
    const planNeedsHydration = input.node === "outline" && merged && (
      (input.action === "message" && !merged.errorCode) || reportCleared ||
      (merged.currentNode === "research" && input.action !== "save_chapters"));
    if (merged && (merged === baseline || !planNeedsHydration)) return merged;
    try {
      const hydrated = await getResearchRuntime(input.sessionId, signal);
      signal?.throwIfAborted();
      if (hydrated.sessionId !== input.sessionId) throw new ApiError(502, "RESEARCH_STATE_SESSION_MISMATCH", null);
      if (hydrated.version < result.version || (hydrated.version === result.version && hydrated.revision < result.revision)) {
        throw new ApiError(502, "RESEARCH_GRAPH_VERSION_CONFLICT", null);
      }
      return hydrated;
    } catch (error) {
      if (merged) throw new ResearchRuntimeHydrationError(merged, error);
      throw error;
    }
  }
  return research.GuidedResearchRuntime.parse(result);
}

export type ResearchRuntimeProgress = z.infer<typeof research.GuidedResearchRuntimeProgress>;
export async function getResearchRuntimeProgress(sessionId: string, stream?: GuidedResearchRuntime["reportStream"], sourceCursor?: string, baseline?: GuidedResearchRuntime): Promise<ResearchRuntimeProgress | RuntimePatch> {
  const op = research.operations.getGuidedResearchRuntimeProgress;
  const digest = stream ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stream.text)))).map((byte) => byte.toString(16).padStart(2, "0")).join("") : "";
  const query = new URLSearchParams(stream ? { requestId: stream.requestId, offset: String(stream.text.length), digest } : {});
  if (sourceCursor) query.set("sourceCursor", sourceCursor);
  if (baseline) {
    if (baseline.sessionId !== sessionId) throw new Error("Research baseline belongs to another session");
    query.set("knownFields", JSON.stringify(await researchFieldFingerprints(baseline)));
  }
  return op.out.parse(await apiRequest(`${op.path.replace(":sessionId", encodeURIComponent(sessionId))}?${query}`));
}
export function mergeResearchProgress(current: GuidedResearchRuntime, update: ResearchRuntimeProgress | RuntimePatch): GuidedResearchRuntime {
  if ("type" in update) return mergeResearchDelta(current, update);
  if (current.sessionId !== update.sessionId || update.version < current.version || (update.version === current.version && !current.busy && update.busy)) return current;
  // Polling and SSE may race. Reject the whole stale projection, not only its
  // text delta, so durable metadata such as saved chapter count cannot rewind.
  if (update.version === current.version && (update.revision < current.revision
    || (update.stream && current.reportStream && update.stream.requestId === current.reportStream.requestId
      && update.stream.sequence < current.reportStream.sequence))) return current;
  const { stream, research: researchUpdate, ...metadata } = update;
  const isNewReportAttempt = update.busy && update.currentNode === "report"
    && (update.version > current.version || Boolean(stream && current.reportStream && stream.requestId !== current.reportStream.requestId));
  let reportStream = current.reportStream;
  if (stream) {
    const previous = reportStream?.requestId === stream.requestId ? reportStream : null;
    if (!previous || stream.sequence >= previous.sequence) {
      if (stream.offset === 0 || previous?.text.length === stream.offset) {
        reportStream = { requestId: stream.requestId, sequence: stream.sequence, status: stream.status,
          text: (stream.offset === 0 ? "" : previous!.text) + stream.delta };
      }
    }
  } else reportStream = null;
  return {
    ...current,
    ...metadata,
    ...(researchUpdate ? { tasks: researchUpdate.tasks,
      sources: researchUpdate.sources?.map((source) => ({
        ...current.sources.find((previous) => previous.id === source.id),
        ...source,
        // Only a display fallback for newly discovered metadata. Evidence bodies
        // remain server-owned and are reloaded once execution reaches terminal state.
        content: current.sources.find((previous) => previous.id === source.id)?.content ?? source.presentation?.summary ?? source.title,
      })) ?? current.sources } : {}),
    ...(update.busy && update.currentNode === "report"
      ? { report: null, reportDraft: null, ...(isNewReportAttempt ? { reportCheckpoint: null, reportSavedChapterCount: update.reportSavedChapterCount } : {}) }
      : {}),
    reportStream,
  };
}

export async function updateGuidedResearchMetadata(sessionId: string, input: { title: string; tags: string[] }): Promise<GuidedResearchSession> {
  const op = research.operations.updateGuidedResearchMetadata;
  const { sessionId: id, ...body } = op.in.parse({ ...input, sessionId });
  const scope = getStoredSessionToken();
  const session = op.out.parse(await apiRequest(op.path.replace(":sessionId", encodeURIComponent(id)), { method: op.method, body }));
  writeResearchMemory(id, { name: session.title }, scope);
  return session;
}

export async function deleteGuidedResearchSession(sessionId: string): Promise<{ archived: true }> {
  const op = research.operations.deleteGuidedResearchSession;
  const input = op.in.parse({ sessionId });
  return op.out.parse(await apiRequest(op.path.replace(":sessionId", encodeURIComponent(input.sessionId)), { method: op.method }));
}
