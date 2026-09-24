import { beforeEach, describe, expect, it, vi } from "vitest";
import { openBoardxRealtimeAsr } from "@/lib/BoardxRealtimeAsrClient";

class FakeSocket extends EventTarget {
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readyState = 0;
  bufferedAmount = 0;
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
    stopCapture.mockReset().mockResolvedValue(undefined);
    capture.onFrame.mockClear();
  });

  async function openForStop() {
    return openBoardxRealtimeAsr("session-1", {
      issueTicket: async () => ({ captureId: "capture-1", ticket: "ticket", expiresAt: "2026-08-12T08:00:00Z", websocketPath: "/stream" }),
      createSocket: (url) => { socket = new FakeSocket(url); queueMicrotask(() => { socket.open(); queueMicrotask(() => socket.message({ type: "ready", captureId: "capture-1" })); }); return socket as unknown as WebSocket; },
      capture: async () => capture,
      finishTimeoutMs: 50,
      handlers: { onInterim: vi.fn(), onFinal: vi.fn(), onState: vi.fn(), onError: vi.fn() },
    });
  }

  it("does not start microphone capture until the ASR provider is ready", async () => {
    const captureFactory = vi.fn(async () => capture);
    const opening = openBoardxRealtimeAsr("session-1", {
      issueTicket: async () => ({ captureId: "capture-1", ticket: "ticket", expiresAt: "2026-08-12T08:00:00Z", websocketPath: "/stream" }),
      createSocket: (url) => { socket = new FakeSocket(url); queueMicrotask(() => socket.open()); return socket as unknown as WebSocket; },
      capture: captureFactory,
      handlers: { onInterim: vi.fn(), onFinal: vi.fn(), onState: vi.fn(), onError: vi.fn() },
    });

    await vi.waitFor(() => expect(socket.sent).toContain(JSON.stringify({ type: "start" })));
    expect(captureFactory).not.toHaveBeenCalled();

    socket.message({ type: "ready", captureId: "capture-1" });
    await opening;
    expect(captureFactory).toHaveBeenCalledOnce();
  });

  it.each([
    { terminal: { type: "error", captureId: "capture-1", reason: "ASR_PROVIDER_UNAVAILABLE" }, expected: "ASR_PROVIDER_UNAVAILABLE" },
    { terminal: { type: "completed", captureId: "capture-1" }, expected: "completed before capture" },
    { terminal: null, expected: "CONNECTION_FAILED" },
  ])("stops a delayed microphone when the connection terminates during startup", async ({ terminal, expected }) => {
    let resolveCapture!: (value: typeof capture) => void;
    let currentSocket: FakeSocket | undefined;
    const captureFactory = vi.fn(() => new Promise<typeof capture>((resolve) => { resolveCapture = resolve; }));
    const onState = vi.fn();
    const opening = openBoardxRealtimeAsr("session-1", {
      issueTicket: async () => ({ captureId: "capture-1", ticket: "ticket", expiresAt: "2026-08-12T08:00:00Z", websocketPath: "/stream" }),
      createSocket: (url) => { currentSocket = socket = new FakeSocket(url); queueMicrotask(() => currentSocket?.open()); return currentSocket as unknown as WebSocket; },
      capture: captureFactory,
      handlers: { onInterim: vi.fn(), onFinal: vi.fn(), onState, onError: vi.fn() },
    });
    await vi.waitFor(() => expect(currentSocket?.sent).toContain(JSON.stringify({ type: "start" })));
    currentSocket?.message({ type: "ready", captureId: "capture-1" });
    await vi.waitFor(() => expect(captureFactory).toHaveBeenCalledOnce());
    if (terminal) currentSocket?.message(terminal); else currentSocket?.close();

    resolveCapture(capture);

    await expect(opening).rejects.toThrow(expected);
    expect(stopCapture).toHaveBeenCalledOnce();
    expect(onState).not.toHaveBeenCalledWith("recording");
  });

  it("preserves the startup terminal error when delayed microphone cleanup rejects", async () => {
    let resolveCapture!: (value: typeof capture) => void;
    let currentSocket: FakeSocket | undefined;
    const rejectingStop = vi.fn().mockRejectedValue(new Error("audio context closed"));
    const captureFactory = vi.fn(() => new Promise<typeof capture>((resolve) => { resolveCapture = resolve; }));
    const opening = openBoardxRealtimeAsr("session-1", {
      issueTicket: async () => ({ captureId: "capture-1", ticket: "ticket", expiresAt: "2026-08-12T08:00:00Z", websocketPath: "/stream" }),
      createSocket: (url) => { currentSocket = socket = new FakeSocket(url); queueMicrotask(() => currentSocket?.open()); return currentSocket as unknown as WebSocket; },
      capture: captureFactory,
      handlers: { onInterim: vi.fn(), onFinal: vi.fn(), onState: vi.fn(), onError: vi.fn() },
    });
    await vi.waitFor(() => expect(currentSocket?.sent).toContain(JSON.stringify({ type: "start" })));
    currentSocket?.message({ type: "ready", captureId: "capture-1" });
    await vi.waitFor(() => expect(captureFactory).toHaveBeenCalledOnce());
    currentSocket?.message({ type: "error", captureId: "capture-1", reason: "ASR_PROVIDER_UNAVAILABLE" });

    resolveCapture({ ...capture, stop: rejectingStop });

    await expect(opening).rejects.toThrow("ASR_PROVIDER_UNAVAILABLE");
    expect(rejectingStop).toHaveBeenCalledOnce();
  });

  it("accepts completion received before stop and does not send a second stop", async () => {
    const handle = await openForStop();
    socket.message({ type: "completed", captureId: "capture-1" });
    socket.close();
    await expect(handle.stop()).resolves.toBeUndefined();
    expect(socket.sent).not.toContain(JSON.stringify({ type: "stop" }));
    expect(stopCapture).toHaveBeenCalledOnce();
  });

  it("duplicate stops wait for the same server completion", async () => {
    const handle = await openForStop();
    const first = handle.stop();
    const second = handle.stop();
    expect(second).toBe(first);
    await Promise.resolve();
    socket.message({ type: "completed", captureId: "capture-1" });
    await Promise.all([first, second]);
    expect(stopCapture).toHaveBeenCalledOnce();
  });

  it("bounds an unresponsive stop and closes its resources", async () => {
    const handle = await openForStop();
    await expect(handle.stop()).rejects.toThrow("FINISH_TIMEOUT");
    expect(socket.readyState).toBe(3);
    expect(stopCapture).toHaveBeenCalledOnce();
  });

  it("does not convert an interrupted stop into success", async () => {
    const handle = await openForStop();
    const stopping = handle.stop();
    const rejected = expect(stopping).rejects.toThrow();
    socket.close();
    await rejected;
    expect(stopCapture).toHaveBeenCalledOnce();
  });

  it("closes the socket even when microphone shutdown rejects", async () => {
    const handle = await openForStop();
    stopCapture.mockRejectedValueOnce(new Error("audio context closed"));
    await expect(handle.stop()).rejects.toThrow("audio context closed");
    expect(socket.readyState).toBe(3);
    expect(stopCapture).toHaveBeenCalledOnce();
  });

  it("retains provider failure received before stop", async () => {
    const handle = await openForStop();
    socket.message({ type: "error", captureId: "capture-1", reason: "ASR_PROVIDER_UNAVAILABLE" });
    await expect(handle.stop()).rejects.toThrow("ASR_PROVIDER_UNAVAILABLE");
    expect(socket.readyState).toBe(3);
  });

  it("uses a one-time ticket, sends start, and only publishes BoardX events", async () => {
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    const onLevel = vi.fn();
    let frameListener: ((frame: ArrayBuffer) => void) | undefined;
    const selectedCapture = {
      sourceSampleRate: 48_000,
      stop: stopCapture,
      onFrame: vi.fn((listener: (frame: ArrayBuffer) => void) => { frameListener = listener; }),
    };
    const captureFactory = vi.fn(async () => selectedCapture);
    const opening = openBoardxRealtimeAsr("session-1", {
      sessionToken: "jwt",
      deviceId: "mic-external",
      issueTicket: vi.fn().mockResolvedValue({
        captureId: "capture-1", ticket: "one-time", expiresAt: "2026-08-12T08:00:00Z",
        websocketPath: "/recording/realtime-asr/sessions/session-1/captures/capture-1/stream",
      }),
      createSocket: (url) => { socket = new FakeSocket(url); queueMicrotask(() => { socket.open(); queueMicrotask(() => socket.message({ type: "ready", captureId: "capture-1" })); }); return socket as unknown as WebSocket; },
      capture: captureFactory,
      handlers: { onInterim, onFinal, onLevel, onState: vi.fn(), onError: vi.fn() },
    });
    await vi.waitFor(() => expect(socket!.sent).toContain(JSON.stringify({ type: "start" })));
    const handle = await opening;
    expect(captureFactory).toHaveBeenCalledWith({ deviceId: "mic-external" });
    expect(socket!.url).toContain("ticket=one-time");
    expect(socket!.sent[0]).toBe(JSON.stringify({ type: "start" }));

    socket!.message({ type: "interim", captureId: "capture-1", text: "正在" });
    socket!.message({ type: "final", captureId: "capture-1", segmentId: "segment-1", ordinal: 1,
      text: "正在转录", startMs: 0, endMs: 900 });
    expect(onInterim).toHaveBeenCalledWith("正在");
    expect(onFinal).toHaveBeenCalledWith(expect.objectContaining({ segmentId: "segment-1", text: "正在转录" }));

    const samples = new Int16Array([0x4000, -0x4000]);
    frameListener?.(samples.buffer);
    expect(onLevel).toHaveBeenCalledWith(1);
    expect(socket!.sent).toContain(samples.buffer);

    const stopping = handle.stop();
    expect(stopCapture).toHaveBeenCalled();
    await Promise.resolve();
    expect(socket!.sent).toContain(JSON.stringify({ type: "stop" }));
    socket!.message({ type: "completed", captureId: "capture-1" });
    await stopping;
  });

  it("fails fast instead of queueing more than one second of audio", async () => {
    const onError = vi.fn();
    let frameListener: ((frame: ArrayBuffer) => void) | undefined;
    const opening = openBoardxRealtimeAsr("session-1", {
      issueTicket: async () => ({ captureId: "capture-1", ticket: "ticket", expiresAt: "2026-08-12T08:00:00Z", websocketPath: "/stream" }),
      createSocket: (url) => { socket = new FakeSocket(url); queueMicrotask(() => { socket.open(); queueMicrotask(() => socket.message({ type: "ready", captureId: "capture-1" })); }); return socket as unknown as WebSocket; },
      capture: async () => ({
        sourceSampleRate: 48_000,
        stop: stopCapture,
        onFrame: (listener) => { frameListener = listener; },
      }),
      handlers: { onInterim: vi.fn(), onFinal: vi.fn(), onState: vi.fn(), onError },
    });
    await vi.waitFor(() => expect(socket.sent).toContain(JSON.stringify({ type: "start" })));
    await opening;
    socket.bufferedAmount = 32_001;

    const frame = new Uint8Array(2_560).buffer;
    frameListener?.(frame);

    expect(socket.sent).not.toContain(frame);
    expect(onError).toHaveBeenCalledWith("AUDIO_BACKPRESSURE");
    expect(socket.readyState).toBe(3);
  });

  it("clears the live level after capture flushes a nonzero tail frame during stop", async () => {
    const onLevel = vi.fn();
    let frameListener: ((frame: ArrayBuffer) => void) | undefined;
    const tail = new Int16Array([0x4000, -0x4000]).buffer;
    const selectedCapture = {
      sourceSampleRate: 48_000,
      onFrame: vi.fn((listener: (frame: ArrayBuffer) => void) => { frameListener = listener; }),
      stop: vi.fn(async () => { frameListener?.(tail); }),
    };
    const handle = await openBoardxRealtimeAsr("session-1", {
      issueTicket: async () => ({ captureId: "capture-1", ticket: "ticket", expiresAt: "2026-08-12T08:00:00Z", websocketPath: "/stream" }),
      createSocket: (url) => { socket = new FakeSocket(url); queueMicrotask(() => { socket.open(); queueMicrotask(() => socket.message({ type: "ready", captureId: "capture-1" })); }); return socket as unknown as WebSocket; },
      capture: async () => selectedCapture,
      handlers: { onInterim: vi.fn(), onFinal: vi.fn(), onLevel, onState: vi.fn(), onError: vi.fn() },
    });

    const stopping = handle.stop();
    await vi.waitFor(() => expect(onLevel).toHaveBeenCalledWith(1));
    socket.message({ type: "completed", captureId: "capture-1" });
    await stopping;

    expect(onLevel).toHaveBeenLastCalledWith(0);
  });

  it("releases the microphone and socket when the server reports an error", async () => {
    const onError = vi.fn();
    const handlePromise = openBoardxRealtimeAsr("session-1", {
      issueTicket: vi.fn().mockResolvedValue({
        captureId: "capture-1", ticket: "one-time", expiresAt: "2026-08-12T08:00:00Z",
        websocketPath: "/recording/realtime-asr/sessions/session-1/captures/capture-1/stream",
      }),
      createSocket: (url) => { socket = new FakeSocket(url); queueMicrotask(() => { socket.open(); queueMicrotask(() => socket.message({ type: "ready", captureId: "capture-1" })); }); return socket as unknown as WebSocket; },
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
      createSocket: (url) => { socket = new FakeSocket(url); queueMicrotask(() => { socket.open(); queueMicrotask(() => socket.message({ type: "ready", captureId: "capture-1" })); }); return socket as unknown as WebSocket; },
      capture: async () => capture,
      handlers: { onInterim: vi.fn(), onFinal: vi.fn(), onState, onError },
    });

    socket!.close();

    await vi.waitFor(() => expect(stopCapture).toHaveBeenCalledOnce());
    expect(onState).toHaveBeenCalledWith("error");
    expect(onError).toHaveBeenCalledWith("CONNECTION_FAILED");
  });

  it("releases the capture reserved by a ticket when the WebSocket handshake fails", async () => {
    const cleanupCapture = vi.fn().mockResolvedValue(undefined);

    await expect(openBoardxRealtimeAsr("session-1", {
      sessionToken: "jwt",
      issueTicket: vi.fn().mockResolvedValue({
        captureId: "capture-1", ticket: "one-time", expiresAt: "2026-08-12T08:00:00Z",
        websocketPath: "/recording/realtime-asr/sessions/session-1/captures/capture-1/stream",
      }),
      createSocket: (url) => {
        socket = new FakeSocket(url);
        queueMicrotask(() => socket.dispatchEvent(new Event("error")));
        return socket as unknown as WebSocket;
      },
      cleanupCapture,
      handlers: { onInterim: vi.fn(), onFinal: vi.fn(), onState: vi.fn(), onError: vi.fn() },
    })).rejects.toThrow("personal_realtime_asr_handshake_failed");

    expect(cleanupCapture).toHaveBeenCalledOnce();
    expect(cleanupCapture).toHaveBeenCalledWith("session-1", "jwt");
    expect(socket!.readyState).toBe(3);
  });

  it("does not stop another active capture when ticket issuance is rejected", async () => {
    const cleanupCapture = vi.fn().mockResolvedValue(undefined);

    await expect(openBoardxRealtimeAsr("session-1", {
      sessionToken: "jwt",
      issueTicket: vi.fn().mockRejectedValue(new Error("CAPTURE_ALREADY_ACTIVE")),
      createSocket: vi.fn(),
      cleanupCapture,
      handlers: { onInterim: vi.fn(), onFinal: vi.fn(), onState: vi.fn(), onError: vi.fn() },
    })).rejects.toThrow("CAPTURE_ALREADY_ACTIVE");

    expect(cleanupCapture).not.toHaveBeenCalled();
  });

  it("releases the reserved capture when microphone startup fails", async () => {
    const cleanupCapture = vi.fn().mockResolvedValue(undefined);

    await expect(openBoardxRealtimeAsr("session-1", {
      sessionToken: "jwt",
      issueTicket: vi.fn().mockResolvedValue({
        captureId: "capture-1", ticket: "one-time", expiresAt: "2026-08-12T08:00:00Z",
        websocketPath: "/recording/sessions/session-1/asr-stream?captureId=capture-1",
      }),
      createSocket: (url) => { socket = new FakeSocket(url); queueMicrotask(() => { socket.open(); queueMicrotask(() => socket.message({ type: "ready", captureId: "capture-1" })); }); return socket as unknown as WebSocket; },
      capture: vi.fn().mockRejectedValue(new Error("microphone denied")),
      cleanupCapture,
      handlers: { onInterim: vi.fn(), onFinal: vi.fn(), onState: vi.fn(), onError: vi.fn() },
    })).rejects.toThrow("microphone denied");

    expect(cleanupCapture).toHaveBeenCalledOnce();
    expect(socket!.readyState).toBe(3);
  });

  it("preserves the handshake error when capture cleanup also fails", async () => {
    const cleanupCapture = vi.fn().mockRejectedValue(new Error("cleanup failed"));

    await expect(openBoardxRealtimeAsr("session-1", {
      issueTicket: vi.fn().mockResolvedValue({
        captureId: "capture-1", ticket: "one-time", expiresAt: "2026-08-12T08:00:00Z",
        websocketPath: "/recording/sessions/session-1/asr-stream?captureId=capture-1",
      }),
      createSocket: (url) => {
        socket = new FakeSocket(url);
        queueMicrotask(() => socket.dispatchEvent(new Event("error")));
        return socket as unknown as WebSocket;
      },
      cleanupCapture,
      handlers: { onInterim: vi.fn(), onFinal: vi.fn(), onState: vi.fn(), onError: vi.fn() },
    })).rejects.toThrow("personal_realtime_asr_handshake_failed");

    expect(cleanupCapture).toHaveBeenCalledOnce();
  });
});
