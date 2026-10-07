import { research } from "@repo/contracts";
import { apiUrl, ApiError, extractReasonCode, getStoredSessionToken } from "./api-client";
import type { GuidedResearchRuntime, GuidedResearchRuntimeCommand } from "./guided-research-api";
import type { z } from "zod";
import { mergeResearchDelta, researchFieldFingerprints } from "./guided-research-delta";
export type ResearchStreamEvent = z.infer<typeof research.GuidedResearchRuntimeStreamEvent>;
export async function streamResearchCommand(input: GuidedResearchRuntimeCommand, onEvent: (event: ResearchStreamEvent) => void, signal?: AbortSignal, baseline?: GuidedResearchRuntime): Promise<GuidedResearchRuntime> {
  const op = research.operations.streamGuidedResearchRuntime;
  const token = getStoredSessionToken();
  if (baseline && baseline.sessionId !== input.sessionId) throw new ApiError(502, "RESEARCH_STATE_SESSION_MISMATCH", null);
  let current = baseline;
  const body = baseline ? { ...input, compactSources: true, knownFields: await researchFieldFingerprints(baseline) } : input;
  const response = await fetch(apiUrl(op.path.replace(":sessionId", encodeURIComponent(input.sessionId))), {
    method: "POST", signal, credentials: "include", headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  });
  if (!response.ok) { const raw: unknown = await response.json().catch(() => null); throw new ApiError(response.status, extractReasonCode(raw), raw); }
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new ApiError(502, "RESEARCH_STREAM_INVALID", null);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      // A snapshot can contain 300 persisted source excerpts (up to 30 KB each).
      if (buffer.length > 32 * 1024 * 1024) throw new ApiError(502, "RESEARCH_STREAM_INVALID", null);
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const event = research.GuidedResearchRuntimeStreamEvent.parse(JSON.parse(data));
        if (event.type === "error") throw new ApiError(409, event.reasonCode, event);
        if (event.type === "patch" || event.type === "result_patch") {
          if (!current) throw new ApiError(502, "RESEARCH_STATE_SNAPSHOT_REQUIRED", null);
          current = mergeResearchDelta(current, event.state);
          onEvent({ type: event.type === "result_patch" ? "result" : "snapshot", state: current });
          if (event.type === "result_patch") return current;
          continue;
        }
        if ((event.type === "snapshot" || event.type === "result" || event.type === "progress") && event.state.sessionId !== input.sessionId) throw new ApiError(502, "RESEARCH_STREAM_INVALID", null);
        if (event.type === "report_delta" && (event.sessionId !== input.sessionId || event.requestId !== input.requestId || event.version !== input.expectedVersion + 1)) continue;
        if (event.type === "snapshot" || event.type === "result") current = event.state;
        if (event.type === "report_delta" && current?.reportStream && current.version === event.version && current.reportStream.requestId === event.requestId && event.sequence === current.reportStream.sequence + 1) {
          current = { ...current, reportStream: { ...current.reportStream, sequence: event.sequence, text: current.reportStream.text + event.delta } };
        }
        onEvent(event);
        if (event.type === "result") return event.state;
      }
      if (chunk.done) throw new ApiError(502, "RESEARCH_STREAM_INTERRUPTED", null);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
