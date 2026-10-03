import { afterEach, expect, it, vi } from "vitest";
import { streamInterviewMarkdownReport } from "@/lib/interview-markdown-api";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const source = { interviewId: "itv-stream", revisionId: "rev-stream", version: 2, documents: [], states: [], execution: null, review: null };
it("delivers fragmented UTF-8 model deltas before the final saved source", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100");
  const encoder = new TextEncoder(); let controller!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal("fetch", async () => new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } })));
  const events: string[] = [];
  const request = streamInterviewMarkdownReport("itv-stream", { expectedVersion: 1, expectedDocumentVersion: 0 }, event => { events.push(event.type); });
  await vi.waitFor(() => expect(controller).toBeDefined());
  const delta = encoder.encode(JSON.stringify({ type: "delta", delta: "研究内容" }) + "\n");
  controller.enqueue(delta.slice(0, delta.length - 4)); controller.enqueue(delta.slice(delta.length - 4));
  await vi.waitFor(() => expect(events).toEqual(["delta"]));
  controller.enqueue(encoder.encode(JSON.stringify({ type: "completed", source }))); controller.close();
  expect(await request).toEqual(source);
  expect(events).toEqual(["delta", "completed"]);
});
it("does not treat a closed partial stream as a saved report", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100");
  vi.stubGlobal("fetch", async () => new Response('{"type":"delta","delta":"未完成正文"}\n'));
  await expect(streamInterviewMarkdownReport("itv-stream", { expectedVersion: 1, expectedDocumentVersion: 0 }, () => {})).rejects.toThrow("REPORT_STREAM_INTERRUPTED");
});
it("rejects a final source for a different interview", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100");
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ type: "completed", source: { ...source, interviewId: "other" } })));
  await expect(streamInterviewMarkdownReport("itv-stream", { expectedVersion: 1, expectedDocumentVersion: 0 }, () => {})).rejects.toThrow("REPORT_SOURCE_MISMATCH");
});
