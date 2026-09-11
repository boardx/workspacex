import { afterEach, expect, it, vi } from "vitest";
import { materializeRecordingFiles } from "@/lib/live-recording-files";
vi.mock("@/lib/api-client", () => ({ apiUrl: (path: string) => `https://api.example.test${path}`, getStoredSessionToken: () => "test-session" }));
afterEach(() => vi.unstubAllGlobals());
it("submits an explicit recording file request with auth and shared cancellation", async () => {
  const signal = new AbortController().signal;
  const request = vi.fn(async () => new Response(JSON.stringify({ artifacts: [] }), { status: 200 }));
  vi.stubGlobal("fetch", request);
  await materializeRecordingFiles({ sessionId: "session", idempotencyKey: "attempt", notesMarkdown: "Interview notes" }, signal);
  const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.example.test/recording/sessions/session/materialize-files");
  expect(init.signal).toBe(signal); expect(init.headers).toEqual({ Authorization: "Bearer test-session" });
  const form = init.body as FormData;
  expect(JSON.parse(form.get("request") as string)).toEqual({ sessionId: "session", idempotencyKey: "attempt", notesMarkdown: "Interview notes" });
  expect(form.get("audio")).toBeNull();
});
it("does not transmit after cancellation and surfaces server refusal", async () => {
  const request = vi.fn(async () => new Response(null, { status: 403 })); vi.stubGlobal("fetch", request);
  await expect(materializeRecordingFiles({ sessionId: "s", idempotencyKey: "a" }, AbortSignal.abort())).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  await expect(materializeRecordingFiles({ sessionId: "s", idempotencyKey: "a" })).rejects.toThrow("HTTP 403");
});
it("hashes the selected audio and sends it as a real multipart binary field", async () => {
  const { webcrypto, createHash } = await import("node:crypto");
  vi.stubGlobal("crypto", webcrypto);
  const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
  const audio = new Blob([bytes], { type: "audio/webm" });
  // jsdom Blob lacks the browser's arrayBuffer method; retain its real form-data bytes.
  Object.defineProperty(audio, "arrayBuffer", { value: async () => bytes.buffer });
  const request = vi.fn(async () => new Response(JSON.stringify({ artifacts: [] }), { status: 200 })); vi.stubGlobal("fetch", request);
  await materializeRecordingFiles({ sessionId: "s", idempotencyKey: "a", audio });
  const [, init] = request.mock.calls[0] as unknown as [string, RequestInit];
  const form = init.body as FormData;
  expect(JSON.parse(form.get("request") as string).audio).toEqual({ sizeBytes: bytes.length, contentType: "audio/webm",
    sha256: createHash("sha256").update(bytes).digest("hex") });
  expect((form.get("audio") as File).size).toBe(bytes.length);
});
