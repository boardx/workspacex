import { describe, expect, it, vi } from "vitest";
import { openBoardxRealtimeAsr } from "@/lib/BoardxRealtimeAsrClient";

class ProtocolSocket extends EventTarget {
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readyState = 0;
  binaryType = "";
  readonly sent: unknown[] = [];
  send(frame: unknown) { this.sent.push(frame); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  receive(frame: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) })); }
}

describe("personal realtime transcription smoke", () => {
  it("runs ticket -> BoardX WS -> interim/final -> stop/completed without provider shapes", async () => {
    const socket = new ProtocolSocket();
    let publishAudio: ((frame: ArrayBuffer) => void) | undefined;
    const states: string[] = [];
    const interim: string[] = [];
    const finals: string[] = [];
    const opening = openBoardxRealtimeAsr("session-smoke", {
      sessionToken: "user-jwt",
      issueTicket: vi.fn().mockResolvedValue({ captureId: "capture-smoke", ticket: "ticket-smoke",
        expiresAt: "2026-08-12T08:00:00Z", websocketPath: "/recording/realtime-asr/sessions/session-smoke/captures/capture-smoke/stream" }),
      createSocket: () => { queueMicrotask(() => socket.open()); return socket as unknown as WebSocket; },
      capture: async () => ({ sourceSampleRate: 48_000, onFrame: (listener) => { publishAudio = listener; }, stop: vi.fn().mockResolvedValue(undefined) }),
      handlers: { onState: (state) => states.push(state), onInterim: (text) => interim.push(text),
        onFinal: (event) => finals.push(event.text), onError: vi.fn() },
    });
    const handle = await opening;
    socket.receive({ type: "ready", captureId: "capture-smoke" });
    publishAudio?.(new ArrayBuffer(320));
    socket.receive({ type: "interim", captureId: "capture-smoke", text: "实时" });
    socket.receive({ type: "final", captureId: "capture-smoke", segmentId: "segment-smoke", ordinal: 1,
      text: "实时转录", startMs: 0, endMs: 500 });
    expect(states).toEqual(["connecting", "recording"]);
    expect(interim).toEqual(["实时"]);
    expect(finals).toEqual(["实时转录"]);
    expect(socket.sent).toContainEqual(expect.any(ArrayBuffer));

    const stopping = handle.stop();
    await Promise.resolve();
    socket.receive({ type: "stopping", captureId: "capture-smoke" });
    socket.receive({ type: "completed", captureId: "capture-smoke" });
    await stopping;
    expect(socket.sent).toContain(JSON.stringify({ type: "stop" }));
    expect(states.at(-1)).toBe("idle");
  });
});
