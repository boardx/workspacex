import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openAsrDraftStream } from "@/lib/live-asr-draft";
import type { CaptureHandle } from "@/lib/live-recording";

vi.mock("@/lib/api-client", () => ({
  apiWebSocketUrl: () => "ws://localhost/asr-test",
  getStoredSessionToken: () => null,
  waitForSocketOpen: async () => undefined,
}));
class FakeSocket extends EventTarget {
  static OPEN = 1;
  static current: FakeSocket;
  readyState = 1;
  binaryType = "";
  sent: unknown[] = [];
  constructor() { super(); FakeSocket.current = this; }
  send(value: unknown) { this.sent.push(value); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event("close")); }
  frame(value: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
}
beforeEach(() => vi.stubGlobal("WebSocket", FakeSocket));
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const stop = vi.fn(async () => undefined);
  const capture: CaptureHandle = { sourceSampleRate: 16000, onFrame: vi.fn(), stop };
  const handlers = { onPartial: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onFinished: vi.fn() };
  return { stop, capture, handlers };
}

it.each(["finished", "error", "close", "malformed"])("releases capture on server %s before UI discards its handle", async (kind) => {
  const f = fixture();
  await openAsrDraftStream(f.handlers, { sessionToken: "test", capture: async () => f.capture });
  if (kind === "close") FakeSocket.current.close();
  else FakeSocket.current.frame(kind === "finished" ? { type: "asr.finished" }
    : kind === "error" ? { type: "asr.error", reason: "ASR_PROVIDER_UNAVAILABLE" } : {});
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(FakeSocket.current.readyState).toBe(3));
  expect(f.handlers.onFinished.mock.calls.length + f.handlers.onError.mock.calls.length).toBe(1);
});

it("deduplicates stop and preserves final transcription while waiting for terminal ACK", async () => {
  const f = fixture();
  const handle = await openAsrDraftStream(f.handlers, { sessionToken: "test", capture: async () => f.capture });
  const first = handle.stop();
  expect(handle.stop()).toBe(first);
  await vi.waitFor(() => expect(FakeSocket.current.sent).toContain(JSON.stringify({ type: "asr.finish" })));
  FakeSocket.current.frame({ type: "asr.final", text: "test" });
  expect(f.handlers.onFinal).toHaveBeenCalledWith("test");
  FakeSocket.current.frame({ type: "asr.finished" });
  await first;
  expect(f.stop).toHaveBeenCalledTimes(1);
  expect(f.handlers.onFinished).toHaveBeenCalledTimes(1);
});

it("releases a capture that resolves after the server has already terminated", async () => {
  const f = fixture();
  let acquired!: (value: CaptureHandle) => void;
  const pending = openAsrDraftStream(f.handlers, { sessionToken: "test", capture: () => new Promise((resolve) => { acquired = resolve; }) });
  const rejected = expect(pending).rejects.toThrow("closed_during_capture_start");
  await vi.waitFor(() => expect(acquired).toBeTypeOf("function"));
  FakeSocket.current.frame({ type: "asr.finished" });
  acquired(f.capture);
  await rejected;
  expect(f.stop).toHaveBeenCalledTimes(1);
  expect(FakeSocket.current.sent).toEqual([]);
});

it("preserves capture startup errors without a later generic callback", async () => {
  const f = fixture();
  const error = new Error("permission-denied");
  await expect(openAsrDraftStream(f.handlers, { sessionToken: "test", capture: async () => { throw error; } })).rejects.toBe(error);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.handlers.onError).not.toHaveBeenCalled();
  expect(f.handlers.onFinished).not.toHaveBeenCalled();
  expect(FakeSocket.current.readyState).toBe(3);
});

it("closes and reports one terminal error if capture cleanup rejects", async () => {
  const f = fixture();
  f.stop.mockRejectedValue(new Error("capture cleanup failed"));
  const handle = await openAsrDraftStream(f.handlers, { sessionToken: "test", capture: async () => f.capture });
  await expect(handle.stop()).resolves.toBeUndefined();
  expect(FakeSocket.current.readyState).toBe(3);
  expect(f.handlers.onError).toHaveBeenCalledTimes(1);
  expect(f.handlers.onError).toHaveBeenCalledWith("ASR_PROVIDER_UNAVAILABLE");
});
