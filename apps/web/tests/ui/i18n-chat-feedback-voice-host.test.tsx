import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
const request = vi.hoisted(() => vi.fn());
const voice = vi.hoisted(() => ({ phase: "idle" as import("@/lib/use-composer-voice-session").ComposerVoicePhase, totalSeconds: 7, transcribedChars: 4, silentSeconds: 12, silenceHint: false, autoPause: true, deviceMenuRequest: 0, setAutoPause: vi.fn(), start: vi.fn(), pause: vi.fn(), finish: vi.fn(), discard: vi.fn(), undo: vi.fn(), dismiss: vi.fn(), requestDeviceMenu: vi.fn() }));
vi.mock("@/lib/api-client", async load => ({ ...(await load<typeof import("@/lib/api-client")>()), apiRequest: request }));
vi.mock("@/lib/use-composer-voice-session", async load => ({ ...(await load<typeof import("@/lib/use-composer-voice-session")>()), useComposerVoiceSession: () => voice }));
vi.mock("@/lib/use-asr-draft", () => ({ useAsrDraft: () => ({ status: "denied", errorReason: null, listening: false, connecting: false, stopping: false, error: "调用方原始错误 {reason}", start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), elapsedSeconds: 0, level: 0, baseText: "", committedText: "", partialText: "" }), appendTranscript: (base: string, addition: string) => addition === "" ? base : base === "" ? addition : `${base} ${addition}` }));
vi.mock("@/lib/use-audio-input-devices", () => ({ useAudioInputDevices: () => ({ devices: [], selectedDeviceId: null, select: vi.fn() }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/chat/raw-thread", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
function app() { return <I18nProvider initialLocale="en"><Driver /><FeedbackDialog target={{ kind: "product" }} targetLabel={null} onClose={vi.fn()} /></I18nProvider>; }
beforeEach(() => { voice.phase = "idle"; voice.silenceHint = false; request.mockReset(); for (const callback of [voice.start, voice.pause, voice.finish, voice.discard, voice.undo, voice.dismiss, voice.requestDeviceMenu]) callback.mockClear(); });
afterEach(cleanup);

it.each([
  { phase: "connecting" as const, id: "feedback-voice-connecting", en: "Connecting to speech recognition", actionId: "feedback-voice-cancel", callback: voice.discard },
  { phase: "listening" as const, id: "feedback-voice-listening", en: "Listening", actionId: "feedback-voice-stop", callback: voice.finish },
  { phase: "listening" as const, silent: true, id: "feedback-voice-listening", en: "No sound detected for 12 seconds", actionId: "feedback-voice-switch-device", callback: voice.requestDeviceMenu },
  { phase: "paused" as const, id: "feedback-voice-paused", en: "Paused", actionId: "feedback-voice-resume", callback: voice.start },
  { phase: "stopping" as const, id: "feedback-voice-stopping", en: "Stopping recording" },
  { phase: "error" as const, id: "feedback-voice-error", en: "Microphone access has not been granted", actionId: "feedback-voice-retry", callback: voice.start },
])("translates actual feedback host $phase / $en while retaining draft, status DOM and explicit actions", ({ phase, id, en, silent, actionId, callback }) => {
  voice.phase = phase; voice.silenceHint = silent ?? false; render(app());
  const input = screen.getByTestId("feedback-detail-input"); fireEvent.change(input, { target: { value: "原始转录草稿 {locale}" } }); const bar = screen.getByTestId(id); expect(bar).toHaveTextContent(en);
  const action = actionId ? screen.getByTestId(actionId) : null; act(() => changeLocale()); expect(screen.getByTestId(id)).toBe(bar); expect(screen.getByTestId("feedback-detail-input")).toBe(input); expect(input).toHaveValue("原始转录草稿 {locale}"); expect(request).not.toHaveBeenCalled();
  for (const fn of [voice.start, voice.finish, voice.pause, voice.discard, voice.requestDeviceMenu]) expect(fn).not.toHaveBeenCalled();
  if (action && actionId && callback) { expect(screen.getByTestId(actionId)).toBe(action); fireEvent.click(action); expect(callback).toHaveBeenCalledTimes(1); }
});

it("translates the actual pending structuring status without restarting the transcript POST on locale", async () => {
  let finish!: (value: { kind: "缺陷"; title: string; detail: string; structured: null }) => void;
  request.mockImplementation(() => new Promise(done => { finish = done; })); render(app());
  const raw = "用户已有转录原文 {text}"; fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: raw } }); fireEvent.click(screen.getByTestId("feedback-proceed-review"));
  const bar = screen.getByTestId("feedback-voice-stopping"); expect(bar).toHaveTextContent("AI is organizing"); act(() => changeLocale()); expect(screen.getByTestId("feedback-voice-stopping")).toBe(bar); expect(screen.getByTestId("feedback-detail-input")).toHaveValue(raw); expect(request).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledWith("/feedback/structure-draft", { method: "POST", body: { transcript: raw } });
  await act(async () => { finish({ kind: "缺陷", title: "模型原始标题", detail: raw, structured: null }); }); expect(request).toHaveBeenCalledTimes(1); expect(screen.getByTestId("feedback-detail-input")).toHaveValue(raw);
});
