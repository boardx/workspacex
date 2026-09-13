/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAsrDraft } from "@/lib/use-asr-draft";
import { openAsrDraftStream, type AsrDraftStreamHandle, type AsrDraftStreamHandlers } from "@/lib/live-asr-draft";
vi.mock("@/lib/live-asr-draft", () => ({ openAsrDraftStream: vi.fn() }));
beforeEach(() => {
  vi.stubGlobal("WebSocket", class {});
  vi.stubGlobal("AudioContext", class {});
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

it.each(["unmount", "cancel", "stop"])("releases a late capture after connecting %s and ignores its callbacks", async (action) => {
  let resolve!: (handle: AsrDraftStreamHandle) => void;
  let handlers!: AsrDraftStreamHandlers;
  vi.mocked(openAsrDraftStream).mockImplementation((value) => {
    handlers = value;
    return new Promise((done) => { resolve = done; });
  });
  const onTranscript = vi.fn();
  const hook = renderHook(() => useAsrDraft({ onTranscript, getBaseText: () => "base", sessionToken: "test" }));
  act(() => hook.result.current.start());
  expect(hook.result.current.status).toBe("connecting");
  if (action === "unmount") hook.unmount();
  else act(() => hook.result.current[action as "cancel" | "stop"]());
  onTranscript.mockClear();
  const stop = vi.fn(async () => undefined);
  await act(async () => { resolve({ stop }); });
  act(() => { handlers.onPartial("late"); handlers.onFinal("late"); handlers.onError("ASR_PROVIDER_UNAVAILABLE"); handlers.onFinished(); });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(onTranscript).not.toHaveBeenCalled();
  if (action !== "unmount") expect(hook.result.current.status).toBe("idle");
});

it("an old cancelled connection cannot stop or overwrite a newer session", async () => {
  const pending: Array<{ handlers: AsrDraftStreamHandlers; resolve: (handle: AsrDraftStreamHandle) => void }> = [];
  vi.mocked(openAsrDraftStream).mockImplementation((handlers) => new Promise((resolve) => pending.push({ handlers, resolve })));
  const transcript = vi.fn();
  const hook = renderHook(() => useAsrDraft({ onTranscript: transcript, getBaseText: () => "", sessionToken: "test" }));
  act(() => hook.result.current.start());
  act(() => hook.result.current.cancel());
  act(() => hook.result.current.start());
  const oldStop = vi.fn(async () => undefined);
  const newStop = vi.fn(async () => undefined);
  await act(async () => { pending[1]!.resolve({ stop: newStop }); });
  act(() => pending[1]!.handlers.onFinal("current"));
  transcript.mockClear();
  await act(async () => { pending[0]!.resolve({ stop: oldStop }); });
  act(() => {
    pending[0]!.handlers.onFinal("stale");
    pending[0]!.handlers.onError("ASR_PROVIDER_UNAVAILABLE");
    pending[0]!.handlers.onFinished();
  });
  expect(oldStop).toHaveBeenCalledTimes(1);
  expect(newStop).not.toHaveBeenCalled();
  expect(hook.result.current.status).toBe("listening");
  expect(hook.result.current.committedText).toBe("current");
  expect(transcript).not.toHaveBeenCalled();
  hook.unmount();
  expect(newStop).toHaveBeenCalledTimes(1);
});
