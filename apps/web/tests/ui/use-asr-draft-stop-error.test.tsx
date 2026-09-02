/**
 * 2026-09-02 devapp 实测：实时转录点「停止」后界面落到"语音识别暂时不可用 + 重试"。
 * 根因之一在客户端：服务端收尾阶段发来的 `asr.error` 被当成整段失败。
 * 这里钉住：停止**之后**到达的错误 ⇒ 正常收尾（idle、已落定文本保留、无 error）；
 * 停止**之前**的错误 ⇒ 仍如实报 error。
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openAsrDraftStream = vi.fn();
vi.mock("@/lib/live-asr-draft", () => ({
  openAsrDraftStream: (...args: unknown[]) => openAsrDraftStream(...args),
  LiveRecordingError: class LiveRecordingError extends Error { kind = "unknown"; },
}));
vi.mock("@/lib/live-recording", () => ({
  LiveRecordingError: class LiveRecordingError extends Error { kind = "unknown"; },
}));

import { useAsrDraft } from "@/lib/use-asr-draft";

type Handlers = {
  onPartial: (t: string) => void; onFinal: (t: string) => void;
  onError: (r: string) => void; onFinished: () => void; onLevel?: (l: number) => void;
};

function supportCapture() {
  Object.defineProperty(window, "AudioContext", { value: function AudioContext() {}, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: () => Promise.resolve() }, configurable: true });
}

beforeEach(() => { openAsrDraftStream.mockReset(); supportCapture(); });

describe("useAsrDraft：停止后到达的错误不算失败", () => {
  it("stop() 之后收到 asr.error ⇒ status=idle、committedText 保留、error 为 null", async () => {
    let handlers!: Handlers;
    const stop = vi.fn(() => Promise.resolve());
    openAsrDraftStream.mockImplementation((h: Handlers) => { handlers = h; return Promise.resolve({ stop }); });
    let draft = "";
    const { result } = renderHook(() => useAsrDraft({
      onTranscript: (t) => { draft = t; }, getBaseText: () => draft, sessionToken: "tok",
    }));
    await act(async () => { result.current.start(); await Promise.resolve(); });
    expect(result.current.status).toBe("listening");
    act(() => handlers.onFinal("已经说完的话"));
    expect(draft).toBe("已经说完的话");

    act(() => result.current.stop());
    expect(result.current.status).toBe("stopping");
    act(() => handlers.onError("ASR_PROVIDER_UNAVAILABLE"));
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.committedText).toBe("已经说完的话");
    expect(draft).toBe("已经说完的话");
  });

  it("对照：录音进行中收到 asr.error ⇒ 仍如实报 error", async () => {
    let handlers!: Handlers;
    openAsrDraftStream.mockImplementation((h: Handlers) => { handlers = h; return Promise.resolve({ stop: vi.fn(() => Promise.resolve()) }); });
    const { result } = renderHook(() => useAsrDraft({ onTranscript: vi.fn(), getBaseText: () => "", sessionToken: "tok" }));
    await act(async () => { result.current.start(); await Promise.resolve(); });
    act(() => handlers.onError("ASR_PROVIDER_UNAVAILABLE"));
    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("暂时不可用");
  });
});
