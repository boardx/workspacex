/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAsrDraft } from "@/lib/use-asr-draft";
import { openAsrDraftStream, type AsrDraftStreamHandlers } from "@/lib/live-asr-draft";
vi.mock("@/lib/live-asr-draft", () => ({ openAsrDraftStream: vi.fn() }));
let streams: AsrDraftStreamHandlers[];
beforeEach(() => {
  vi.useFakeTimers(); streams = [];
  vi.stubGlobal("WebSocket", class {}); vi.stubGlobal("AudioContext", class {});
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.mocked(openAsrDraftStream).mockImplementation(async (handlers) => {
    streams.push(handlers); return { stop: async () => handlers.onFinished() };
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
const mount = () => renderHook(() => useAsrDraft({ sessionToken: "test", getBaseText: () => "原文", onTranscript: () => undefined, autoReconnect: true }));

it("recovers confirmed text but not interim or stale events after a temporary outage", async () => {
  const hook = mount();
  await act(async () => hook.result.current.start());
  act(() => { streams[0]!.onFinal("已确认？"); streams[0]!.onPartial("未确认"); streams[0]!.onError("ASR_PROVIDER_UNAVAILABLE"); });
  expect(hook.result.current.connecting).toBe(true);
  expect(hook.result.current.partialText).toBe("");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  act(() => { streams[0]!.onFinal("过期"); streams[0]!.onFinished(); streams[1]!.onFinal("恢复"); });
  expect(hook.result.current.status).toBe("listening");
  expect(hook.result.current.baseText).toBe("原文");
  expect(hook.result.current.committedText).toBe("已确认？ 恢复");
});

it.each(["stop", "cancel", "unmount"])("cancels scheduled recovery on %s", async (action) => {
  const hook = mount(); await act(async () => hook.result.current.start());
  act(() => streams[0]!.onError("ASR_PROVIDER_UNAVAILABLE"));
  if (action === "unmount") hook.unmount();
  else act(() => hook.result.current[action as "stop" | "cancel"]());
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(streams).toHaveLength(1);
  if (action !== "unmount") expect(hook.result.current.status).toBe("idle");
});

it("exhausts five retries and keeps confirmed text for manual recovery", async () => {
  const hook = mount(); await act(async () => hook.result.current.start());
  act(() => streams[0]!.onFinal("保留"));
  for (const delay of [1000, 2000, 4000, 8000, 8000]) {
    act(() => streams.at(-1)!.onError("ASR_PROVIDER_UNAVAILABLE"));
    await act(async () => vi.advanceTimersByTimeAsync(delay));
  }
  act(() => streams.at(-1)!.onError("ASR_PROVIDER_UNAVAILABLE"));
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(streams).toHaveLength(6);
  expect(hook.result.current.status).toBe("error");
  expect(hook.result.current.committedText).toBe("保留");
});

it("does not automatically retry configuration failures", async () => {
  const hook = mount(); await act(async () => hook.result.current.start());
  act(() => streams[0]!.onError("ASR_NOT_CONFIGURED"));
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(hook.result.current.errorReason).toBe("ASR_NOT_CONFIGURED");
  expect(streams).toHaveLength(1);
});

it("waits offline without consuming retries, then resumes when online", async () => {
  const hook = mount(); await act(async () => hook.result.current.start());
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  act(() => streams[0]!.onError("ASR_PROVIDER_UNAVAILABLE"));
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(streams).toHaveLength(1);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  act(() => window.dispatchEvent(new Event("online")));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(hook.result.current.status).toBe("listening");
  expect(streams).toHaveLength(2);
});

it("manual retry preserves the original baseline and confirmed transcript", async () => {
  const hook = mount(); await act(async () => hook.result.current.start());
  act(() => { streams[0]!.onFinal("已有？"); streams[0]!.onError("ASR_PROVIDER_UNAVAILABLE"); });
  act(() => hook.result.current.stop());
  await act(async () => hook.result.current.retry?.());
  act(() => streams[1]!.onFinal("补充"));
  expect(hook.result.current.baseText).toBe("原文");
  expect(hook.result.current.committedText).toBe("已有？ 补充");
});
