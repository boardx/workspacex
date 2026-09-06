import { research } from "@repo/contracts";
import { apiUrl, ApiError, extractReasonCode, getStoredSessionToken } from "./api-client";
import type { GuidedResearchRuntime, GuidedResearchRuntimeCommand } from "./guided-research-api";
import type { z } from "zod";
export type ResearchStreamEvent = z.infer<typeof research.GuidedResearchRuntimeStreamEvent>;
export async function streamResearchCommand(input: GuidedResearchRuntimeCommand, onEvent: (event: ResearchStreamEvent) => void, signal?: AbortSignal): Promise<GuidedResearchRuntime> {
  const op = research.operations.streamGuidedResearchRuntime;
  const token = getStoredSessionToken();
  const response = await fetch(apiUrl(op.path.replace(":sessionId", encodeURIComponent(input.sessionId))), {
    method: "POST", signal, credentials: "include", headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input),
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
        if ((event.type === "snapshot" || event.type === "result") && event.state.sessionId !== input.sessionId) throw new ApiError(502, "RESEARCH_STREAM_INVALID", null);
        if (event.type === "report_delta" && (event.sessionId !== input.sessionId || event.requestId !== input.requestId || event.version !== input.expectedVersion + 1)) continue;
        onEvent(event);
        if (event.type === "result") return event.state;
      }
      if (chunk.done) throw new ApiError(502, "RESEARCH_STREAM_INTERRUPTED", null);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
