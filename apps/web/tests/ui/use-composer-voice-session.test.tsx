/**
 * 2026-09-02 composer 重设计——composer 级语音会话状态机 `useComposerVoiceSession`。
 * 用一个可手动推进的假 `useAsrDraft` 结果驱动：暂停 → 继续接在后面 → 完成 → 撤销；
 * 丢弃还原；静音提示与自动暂停按真实 level 计时。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseAsrDraftResult } from "@/lib/use-asr-draft";
import {
  SILENCE_AUTO_PAUSE_AFTER_SECONDS,
  SILENCE_HINT_AFTER_SECONDS,
  useComposerVoiceSession,
} from "@/lib/use-composer-voice-session";

function makeSpeech(over: Partial<UseAsrDraftResult> = {}): UseAsrDraftResult {
  return {
    status: "idle", listening: false, connecting: false, stopping: false, error: null,
    start: vi.fn(), stop: vi.fn(), cancel: vi.fn(),
    elapsedSeconds: 0, level: 0.5, baseText: "", committedText: "", partialText: "",
    ...over,
  };
}

function withStatus(s: UseAsrDraftResult, status: UseAsrDraftResult["status"], extra: Partial<UseAsrDraftResult> = {}): UseAsrDraftResult {
  return { ...s, ...extra, status, listening: status === "listening", connecting: status === "connecting", stopping: status === "stopping" };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("useComposerVoiceSession", () => {
  it("暂停 → 已暂停（累计秒数与字数）→ 继续 → 完成 → 撤销还原到会话开始前", () => {
    let draft = "前文";
    const opts = { setDraft: (t: string) => { draft = t; }, getDraft: () => draft };
    let speech = makeSpeech();
    const { result, rerender } = renderHook(() => useComposerVoiceSession(speech, opts));

    act(() => result.current.start());
    expect(speech.start).toHaveBeenCalledTimes(1);
    speech = withStatus(speech, "listening", { baseText: "前文", committedText: "第一段", elapsedSeconds: 7 });
    draft = "前文 第一段";
    rerender();
    expect(result.current.phase).toBe("listening");
    expect(result.current.transcribedChars).toBe(3);

    act(() => result.current.pause());
    expect(speech.stop).toHaveBeenCalledTimes(1);
    speech = withStatus(speech, "stopping"); rerender();
    speech = withStatus(speech, "idle"); rerender();
    expect(result.current.phase).toBe("paused");
    expect(result.current.totalSeconds).toBe(7);
    expect(result.current.transcribedChars).toBe(3);

    // 继续：不重置还原点，再录一段接在后面。
    act(() => result.current.start());
    speech = withStatus(speech, "listening", { baseText: "前文 第一段", committedText: "第二段", elapsedSeconds: 3 });
    draft = "前文 第一段 第二段";
    rerender();
    expect(result.current.totalSeconds).toBe(10);
    expect(result.current.transcribedChars).toBe(6);

    act(() => result.current.finish());
    speech = withStatus(speech, "stopping"); rerender();
    speech = withStatus(speech, "idle"); rerender();
    expect(result.current.phase).toBe("done");
    expect(result.current.transcribedChars).toBe(6);

    act(() => result.current.undo());
    expect(draft).toBe("前文");
    expect(result.current.phase).toBe("idle");
  });

  it("暂停态「丢弃」⇒ 输入框还原到会话开始前，回到 idle；listening 态「丢弃」⇒ 底层 cancel()", () => {
    let draft = "原文";
    const opts = { setDraft: (t: string) => { draft = t; }, getDraft: () => draft };
    let speech = makeSpeech();
    const { result, rerender } = renderHook(() => useComposerVoiceSession(speech, opts));
    act(() => result.current.start());
    speech = withStatus(speech, "listening", { baseText: "原文", committedText: "转录" }); draft = "原文 转录"; rerender();
    act(() => result.current.pause());
    speech = withStatus(speech, "idle"); rerender();
    expect(result.current.phase).toBe("paused");
    act(() => result.current.discard());
    expect(draft).toBe("原文");
    expect(result.current.phase).toBe("idle");

    act(() => result.current.start());
    speech = withStatus(speech, "listening"); rerender();
    act(() => result.current.discard());
    expect(speech.cancel).toHaveBeenCalledTimes(1);
  });

  it("静音：level 低于阈值连续 8 秒 ⇒ silenceHint；再 5 秒且开着自动暂停 ⇒ 自动 pause()", () => {
    const opts = { setDraft: vi.fn(), getDraft: () => "" };
    let speech = makeSpeech({ level: 0 });
    const { result, rerender } = renderHook(() => useComposerVoiceSession(speech, opts));
    act(() => result.current.start());
    speech = withStatus(speech, "listening", { level: 0 }); rerender();
    act(() => { vi.advanceTimersByTime(SILENCE_HINT_AFTER_SECONDS * 1_000 + 50); });
    expect(result.current.silenceHint).toBe(true);
    expect(speech.stop).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(SILENCE_AUTO_PAUSE_AFTER_SECONDS * 1_000 + 50); });
    expect(speech.stop).toHaveBeenCalledTimes(1);
  });

  it("中途报错但已有 committedText/partialText ⇒ 收敛为 done，不再展示错误", () => {
    let draft = "前文";
    const opts = { setDraft: (t: string) => { draft = t; }, getDraft: () => draft };
    let speech = makeSpeech();
    const { result, rerender } = renderHook(() => useComposerVoiceSession(speech, opts));

    act(() => result.current.start());
    speech = withStatus(speech, "listening", { baseText: "前文", committedText: "已经转录的内容", elapsedSeconds: 4 });
    draft = "前文 已经转录的内容";
    rerender();
    expect(result.current.phase).toBe("listening");

    // 上游中途报错（比如连接抖动）——底层直接跳到 error，不经过 idle。
    speech = withStatus(speech, "error", { committedText: "已经转录的内容" });
    rerender();
    expect(result.current.phase).toBe("done");
    expect(result.current.transcribedChars).toBeGreaterThan(0);
  });

  it("中途报错且 committedText/partialText 均为空（哪怕草稿被手动改过）⇒ 仍如实报错", () => {
    // 2026-09-03 同作者诊断评论（PR #2626）反证的 bug：草稿差异不能代表"ASR 真的
    // 转出过内容"——这里模拟"录音期间用户手动编辑了输入框，但 ASR 上游从头到尾
    // 没有确认过任何一段转录就报错"，phase 必须仍然是 error，不能被误判成 done。
    let draft = "前文";
    const opts = { setDraft: (t: string) => { draft = t; }, getDraft: () => draft };
    let speech = makeSpeech();
    const { result, rerender } = renderHook(() => useComposerVoiceSession(speech, opts));

    act(() => result.current.start());
    speech = withStatus(speech, "listening", { baseText: "前文" });
    rerender();
    expect(result.current.phase).toBe("listening");

    // 用户在录音期间手动编辑了草稿（不是 ASR 转录写回的）。
    draft = "前文 手动打的字";

    speech = withStatus(speech, "error", { committedText: "", partialText: "" });
    rerender();
    expect(result.current.phase).toBe("error");
  });

  it("有声音就重置静音计时；关掉自动暂停则只提示不暂停", () => {
    const opts = { setDraft: vi.fn(), getDraft: () => "" };
    let speech = makeSpeech({ level: 0 });
    const { result, rerender } = renderHook(() => useComposerVoiceSession(speech, opts));
    act(() => result.current.setAutoPause(false));
    act(() => result.current.start());
    speech = withStatus(speech, "listening", { level: 0 }); rerender();
    act(() => { vi.advanceTimersByTime(5_000); });
    speech = { ...speech, level: 0.6 }; rerender();
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(result.current.silenceHint).toBe(false);
    speech = { ...speech, level: 0 }; rerender();
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current.silenceHint).toBe(true);
    expect(speech.stop).not.toHaveBeenCalled();
  });
});
