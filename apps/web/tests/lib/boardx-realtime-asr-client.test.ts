import { beforeEach, describe, expect, it, vi } from "vitest";
import { openBoardxRealtimeAsr } from "@/lib/BoardxRealtimeAsrClient";

class FakeSocket extends EventTarget {
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readyState = 0;
  sent: unknown[] = [];
  binaryType = "";
  constructor(readonly url: string) { super(); }
  send(value: unknown) { this.sent.push(value); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  message(value: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
}

describe("BoardxRealtimeAsrClient", () => {
  let socket: FakeSocket;
  const stopCapture = vi.fn().mockResolvedValue(undefined);
  const capture = { onFrame: vi.fn(), stop: stopCapture, sourceSampleRate: 48_000 };

  beforeEach(() => {
    stopCapture.mockClear();
    capture.onFrame.mockClear();
  });

  it("uses a one-time ticket, sends start, and only publishes BoardX events", async () => {
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    const opening = openBoardxRealtimeAsr("session-1", {
      sessionToken: "jwt",
      issueTicket: vi.fn().mockResolvedValue({
        captureId: "capture-1", ticket: "one-time", expiresAt: "2026-08-12T08:00:00Z",
        websocketPath: "/recording/realtime-asr/sessions/session-1/captures/capture-1/stream",
      }),
      createSocket: (url) => { socket = new FakeSocket(url); queueMicrotask(() => socket.open()); return socket as unknown as WebSocket; },
      capture: async () => capture,
      handlers: { onInterim, onFinal, onState: vi.fn(), onError: vi.fn() },
    });
    const handle = await opening;
    expect(socket!.url).toContain("ticket=one-time");
    expect(socket!.sent[0]).toBe(JSON.stringify({ type: "start" }));

    socket!.message({ type: "interim", captureId: "capture-1", text: "正在" });
    socket!.message({ type: "final", captureId: "capture-1", segmentId: "segment-1", ordinal: 1,
      text: "正在转录", startMs: 0, endMs: 900 });
    expect(onInterim).toHaveBeenCalledWith("正在");
    expect(onFinal).toHaveBeenCalledWith(expect.objectContaining({ segmentId: "segment-1", text: "正在转录" }));

    const stopping = handle.stop();
    expect(stopCapture).toHaveBeenCalled();
    await Promise.resolve();
    expect(socket!.sent).toContain(JSON.stringify({ type: "stop" }));
    socket!.message({ type: "completed", captureId: "capture-1" });
    await stopping;
  });

  it("releases the microphone and socket when the server reports an error", async () => {
    const onError = vi.fn();
    const handlePromise = openBoardxRealtimeAsr("session-1", {
      issueTicket: vi.fn().mockResolvedValue({
        captureId: "capture-1", ticket: "one-time", expiresAt: "2026-08-12T08:00:00Z",
        websocketPath: "/recording/realtime-asr/sessions/session-1/captures/capture-1/stream",
      }),
      createSocket: (url) => { socket = new FakeSocket(url); queueMicrotask(() => socket.open()); return socket as unknown as WebSocket; },
      capture: async () => capture,
      handlers: { onInterim: vi.fn(), onFinal: vi.fn(), onState: vi.fn(), onError },
    });
    await handlePromise;

    socket!.message({ type: "error", captureId: "capture-1", reason: "ASR_PROVIDER_UNAVAILABLE" });
    await vi.waitFor(() => expect(stopCapture).toHaveBeenCalledOnce());
    expect(socket!.readyState).toBe(3);
    expect(onError).toHaveBeenCalledWith("ASR_PROVIDER_UNAVAILABLE");
  });

  it("releases the microphone when the BoardX socket closes unexpectedly", async () => {
    const onError = vi.fn();
    const onState = vi.fn();
    await openBoardxRealtimeAsr("session-1", {
      issueTicket: vi.fn().mockResolvedValue({
        captureId: "capture-1", ticket: "one-time", expiresAt: "2026-08-12T08:00:00Z",
        websocketPath: "/recording/realtime-asr/sessions/session-1/captures/capture-1/stream",
      }),
      createSocket: (url) => { socket = new FakeSocket(url); queueMicrotask(() => socket.open()); return socket as unknown as WebSocket; },
      capture: async () => capture,
      handlers: { onInterim: vi.fn(), onFinal: vi.fn(), onState, onError },
    });

    socket!.close();

    await vi.waitFor(() => expect(stopCapture).toHaveBeenCalledOnce());
    expect(onState).toHaveBeenCalledWith("error");
    expect(onError).toHaveBeenCalledWith("CONNECTION_FAILED");
  });
});
