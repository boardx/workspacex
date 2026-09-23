/**
 * 2026-09-23 本地真栈实测：本地版没下转写模型时，提反馈弹窗点「语音」⇒ 服务端回 `ASR_NOT_CONFIGURED`，
 * 屏上却给了两个「重试」——因为 `useAsrDraft` 只往外交一句话（`error`），调用方分不出
 * 「暂时不可用」和「这个环境根本没开通」。这里钉住：服务端给的闭集原因要原样交出去。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AsrDraftStreamHandle, AsrDraftStreamHandlers } from "@/lib/live-asr-draft";

const { openAsrDraftStream } = vi.hoisted(() => ({ openAsrDraftStream: vi.fn() }));
vi.mock("@/lib/live-asr-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-asr-draft")>()),
  openAsrDraftStream,
}));

import { useAsrDraft } from "@/lib/use-asr-draft";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("WebSocket", class {} as unknown as typeof WebSocket);
  vi.stubGlobal("AudioContext", class {} as unknown as typeof AudioContext);
  Object.defineProperty(window.navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
});
afterEach(() => { vi.unstubAllGlobals(); });

const startWith = async () => {
  let handlers: AsrDraftStreamHandlers | null = null;
  const handle: AsrDraftStreamHandle = { stop: vi.fn(async () => undefined) };
  openAsrDraftStream.mockImplementation(async (h: AsrDraftStreamHandlers) => { handlers = h; return handle; });
  const hook = renderHook(() => useAsrDraft({ onTranscript: () => undefined, getBaseText: () => "", sessionToken: "t" }));
  await act(async () => { hook.result.current.start(); await Promise.resolve(); await Promise.resolve(); });
  return { hook, fire: (reason: string) => act(() => handlers!.onError(reason as never)) };
};

describe("useAsrDraft.errorReason", () => {
  it("服务端说 ASR_NOT_CONFIGURED ⇒ errorReason 原样交出（调用方才知道不该给「重试」）", async () => {
    const { hook, fire } = await startWith();
    fire("ASR_NOT_CONFIGURED");
    // ⭐ 反证锚点：去掉 `setErrorReason(reason)` ⇒ 这条红——状态栏又只能靠一句话猜。
    expect(hook.result.current.errorReason).toBe("ASR_NOT_CONFIGURED");
    expect(hook.result.current.error).toContain("尚未配置语音转写服务");
  });

  it("重新开始录音 ⇒ 上一次的原因被清掉，不带到下一轮", async () => {
    const { hook, fire } = await startWith();
    fire("ASR_PROVIDER_UNAVAILABLE");
    expect(hook.result.current.errorReason).toBe("ASR_PROVIDER_UNAVAILABLE");
    await act(async () => { hook.result.current.start(); await Promise.resolve(); });
    expect(hook.result.current.errorReason).toBeNull();
  });
});
