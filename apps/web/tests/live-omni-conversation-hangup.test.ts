/**
 * uiux-r4：挂断后线程为空的根因之一——客户端 `stop()` 以前发完 session.stop 立刻关连接，
 * 服务端收尾时落库的最后一句（turn.persisted）永远到不了界面。这里用假 WebSocket 证明：
 * stop() 等到 session.closed 才返回，期间的 turn.persisted 照常回调；以及麦克风电平。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { openOmniConversation, pcm16Level } from "@/lib/live-omni-conversation";

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: unknown[] = [];
  private listeners = new Map<string, Array<(e: { data?: unknown }) => void>>();
  constructor() { FakeSocket.last = this; setTimeout(() => { this.readyState = 1; this.emit("open", {}); }, 0); }
  addEventListener(type: string, fn: (e: { data?: unknown }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  emit(type: string, e: { data?: unknown }) { for (const fn of this.listeners.get(type) ?? []) fn(e); }
  send(data: unknown) {
    this.sent.push(data);
    if (typeof data === "string" && JSON.parse(data).type === "session.stop") {
      // 服务端：先落最后一句，再回 session.closed
      setTimeout(() => {
        this.emit("message", { data: JSON.stringify({ type: "turn.persisted", role: "user", messageId: "m-last" }) });
        this.emit("message", { data: JSON.stringify({ type: "session.closed" }) });
      }, 10);
    }
  }
  close() { this.readyState = 3; }
}

afterEach(() => vi.unstubAllGlobals());

function handlers() {
  return {
    onReady: vi.fn(), onUserSpeech: vi.fn(), onUserTranscript: vi.fn(), onAssistantTranscript: vi.fn(),
    onAssistantAudio: vi.fn(), onError: vi.fn(), onClosed: vi.fn(), onTurnPersisted: vi.fn(), onInputLevel: vi.fn(),
  };
}

describe("openOmniConversation — hangup settles before closing", () => {
  it("stop() waits for session.closed and still delivers the turn persisted during hangup", async () => {
    vi.stubGlobal("WebSocket", FakeSocket as unknown as typeof WebSocket);
    const h = handlers();
    let frameListener: ((f: Int16Array) => void) | null = null;
    const handle = await openOmniConversation({ threadId: "t-1", agentId: null }, h, {
      sessionToken: "tok",
      capture: async () => ({ onFrame: (l) => { frameListener = l; }, stop: async () => {}, sourceSampleRate: 16000 }),
    });
    frameListener!(new Int16Array([16384, -16384, 16384, -16384]));
    expect(h.onInputLevel).toHaveBeenLastCalledWith(1);
    await handle.stop();
    expect(h.onTurnPersisted).toHaveBeenCalledWith("user", "m-last");
    expect(h.onTurnPersisted.mock.invocationCallOrder[0]!).toBeLessThan(h.onClosed.mock.invocationCallOrder[0]!);
    expect(FakeSocket.last!.sent.some((d) => typeof d === "string" && d.includes("session.stop"))).toBe(true);
  });

  it("pcm16Level: silence is 0, loud is capped at 1", () => {
    expect(pcm16Level(new Int16Array(160))).toBe(0);
    expect(pcm16Level(new Int16Array([32767, -32768]))).toBe(1);
    expect(pcm16Level(new Int16Array([800, -800]))).toBeGreaterThan(0);
  });
});
