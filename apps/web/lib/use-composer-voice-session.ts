"use client";

import * as React from "react";
import type { UseAsrDraftResult } from "@/lib/use-asr-draft";

/**
 * 2026-09-02 composer 重设计——语音输入的 **composer 级**会话状态机。
 *
 * `useAsrDraft` 只知道一段采音管线的生命周期（idle → connecting → listening →
 * stopping → idle / error / denied）。设计稿里的状态比它多三个，且全部是"输入区层面"
 * 的语义，不该塞进采音 hook：
 *   · **暂停**：底层其实就是 `stop()`（保留转录），只是界面要说"已暂停 00:07，继续录音
 *     会接在后面"——`continue` 再 `start()` 一次，`useAsrDraft.getBaseText` 读到的正是
 *     含上一段转录的输入框，天然"接在后面"。本 hook 记住"这次结束是为了暂停还是完成"
 *     以及跨段累计的秒数。
 *   · **静音提示**：`level` 连续低于阈值 ≥ `SILENCE_HINT_AFTER` 秒 → 提示；开了自动暂停
 *     再过 `SILENCE_AUTO_PAUSE_AFTER` 秒 → 自动暂停。全部读真实 RMS，不是定时器假装。
 *   · **转录后编辑**：`finish()` 之后进入 `done`，状态栏显示"已转录 N 字，可直接修改"，
 *     可撤销（还原到本次会话开始前的文本）或继续说。用户开始发送 / 清空输入 / 撤销 /
 *     再次开始录音时退出。
 *
 * 阈值是实测经验值，写成常量放在这里（唯一事实源），状态栏文案引用它们。
 */

export const SILENCE_LEVEL_THRESHOLD = 0.02;
export const SILENCE_HINT_AFTER_SECONDS = 8;
export const SILENCE_AUTO_PAUSE_AFTER_SECONDS = 5;
const AUTO_PAUSE_STORAGE_KEY = "workspacex.composer.silence-auto-pause";

export type ComposerVoicePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "stopping"
  | "paused"
  | "done"
  | "error";

export interface ComposerVoiceSession {
  readonly phase: ComposerVoicePhase;
  /** 跨"暂停/继续"累计的录音秒数（暂停态显示的就是它）。 */
  readonly totalSeconds: number;
  /** 本次会话（可能含多段）累计转录的字数，按去空白后的字符数计。 */
  readonly transcribedChars: number;
  /** listening 态下连续静音的秒数；≥ `SILENCE_HINT_AFTER_SECONDS` 即"静音提示"。 */
  readonly silentSeconds: number;
  readonly silenceHint: boolean;
  readonly autoPause: boolean;
  readonly setAutoPause: (on: boolean) => void;
  readonly start: () => void;
  /** 暂停：保留转录，之后可继续 / 完成 / 丢弃。 */
  readonly pause: () => void;
  /** 完成：保留转录，进入"转录后编辑"。 */
  readonly finish: () => void;
  /** 丢弃：本段转录不要（底层 `cancel()`）；暂停态下丢弃整个会话。 */
  readonly discard: () => void;
  /** 撤销转录：把输入框还原到本次会话开始前的文本。 */
  readonly undo: () => void;
  /** 用户开始编辑 / 发送 / 清空之后调用，退出 `done`。 */
  readonly dismiss: () => void;
  /** 打开"换麦克风"菜单的请求计数（静音提示里的按钮 → 语音按钮的设备菜单）。 */
  readonly deviceMenuRequest: number;
  readonly requestDeviceMenu: () => void;
}

function readAutoPause(): boolean {
  try {
    const raw = window.localStorage.getItem(AUTO_PAUSE_STORAGE_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

export function useComposerVoiceSession(
  speech: UseAsrDraftResult,
  opts: { readonly setDraft: (text: string) => void; readonly getDraft: () => string },
): ComposerVoiceSession {
  const [autoPause, setAutoPauseState] = React.useState(true);
  React.useEffect(() => { setAutoPauseState(readAutoPause()); }, []);
  const setAutoPause = React.useCallback((on: boolean) => {
    setAutoPauseState(on);
    try { window.localStorage.setItem(AUTO_PAUSE_STORAGE_KEY, on ? "1" : "0"); } catch { /* 私密模式等，不影响功能 */ }
  }, []);

  /** 结束这一段是为了什么——决定 `stopping → idle` 之后落到 paused 还是 done。 */
  const endIntentRef = React.useRef<"pause" | "finish" | "discard" | null>(null);
  const [settled, setSettled] = React.useState<"paused" | "done" | null>(null);
  /** 本次会话开始前的输入框文本（撤销转录的还原点），跨暂停/继续不变。 */
  const sessionBaseRef = React.useRef<string | null>(null);
  const [carriedSeconds, setCarriedSeconds] = React.useState(0);
  const [carriedChars, setCarriedChars] = React.useState(0);
  const [deviceMenuRequest, setDeviceMenuRequest] = React.useState(0);

  // 采音结束（status 回到 idle）时按意图落到 paused / done。
  const prevStatusRef = React.useRef(speech.status);
  React.useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = speech.status;
    if (prev === speech.status) return;
    if (speech.status === "idle" && (prev === "stopping" || prev === "listening" || prev === "connecting")) {
      const intent = endIntentRef.current;
      endIntentRef.current = null;
      if (intent === "discard") {
        setSettled(null); sessionBaseRef.current = null; setCarriedSeconds(0); setCarriedChars(0);
        return;
      }
      // 累计在这里做（不在点按钮那一刻）：最后一段 `asr.final` 可能在 stopping 期间才到。
      setCarriedSeconds((s) => s + speech.elapsedSeconds);
      setCarriedChars((c) => c + speech.committedText.replace(/\s/g, "").length);
      if (intent === "pause") setSettled("paused");
      else setSettled(speech.committedText.trim() === "" && intent !== "finish" ? null : "done");
    }
    if (speech.status === "error" || speech.status === "denied" || speech.status === "unsupported") {
      endIntentRef.current = null;
    }
  }, [speech.status, speech.committedText, speech.elapsedSeconds]);

  const start = React.useCallback(() => {
    if (sessionBaseRef.current === null || settled === null) {
      // 全新会话（不是从暂停/完成继续）：记住还原点、清零累计。
      sessionBaseRef.current = opts.getDraft();
      setCarriedSeconds(0);
      setCarriedChars(0);
    }
    setSettled(null);
    speech.start();
  }, [opts, settled, speech]);

  const endSegment = React.useCallback((intent: "pause" | "finish" | "discard") => {
    endIntentRef.current = intent;
    if (intent === "discard") speech.cancel();
    else speech.stop();
  }, [speech]);

  const pause = React.useCallback(() => endSegment("pause"), [endSegment]);
  const finish = React.useCallback(() => {
    if (settled === "paused") { setSettled("done"); return; }
    endSegment("finish");
  }, [endSegment, settled]);
  const discard = React.useCallback(() => {
    if (settled === "paused") {
      if (sessionBaseRef.current !== null) opts.setDraft(sessionBaseRef.current);
      sessionBaseRef.current = null;
      setSettled(null);
      setCarriedSeconds(0);
      setCarriedChars(0);
      return;
    }
    endSegment("discard");
  }, [endSegment, opts, settled]);
  const undo = React.useCallback(() => {
    if (sessionBaseRef.current !== null) opts.setDraft(sessionBaseRef.current);
    sessionBaseRef.current = null;
    setSettled(null);
    setCarriedSeconds(0);
    setCarriedChars(0);
  }, [opts]);
  const dismiss = React.useCallback(() => {
    sessionBaseRef.current = null;
    setSettled(null);
    setCarriedSeconds(0);
    setCarriedChars(0);
  }, []);

  // 静音检测：listening 期间每秒看一次"最近一次有声音是什么时候"。
  const lastLoudAtRef = React.useRef<number>(Date.now());
  const [silentSeconds, setSilentSeconds] = React.useState(0);
  React.useEffect(() => {
    if (speech.level > SILENCE_LEVEL_THRESHOLD) lastLoudAtRef.current = Date.now();
  }, [speech.level]);
  React.useEffect(() => {
    if (!speech.listening) { setSilentSeconds(0); return; }
    lastLoudAtRef.current = Date.now();
    const timer = window.setInterval(() => {
      setSilentSeconds(Math.floor((Date.now() - lastLoudAtRef.current) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [speech.listening]);
  React.useEffect(() => {
    if (!speech.listening || !autoPause) return;
    if (silentSeconds >= SILENCE_HINT_AFTER_SECONDS + SILENCE_AUTO_PAUSE_AFTER_SECONDS) pause();
  }, [silentSeconds, speech.listening, autoPause, pause]);

  const phase: ComposerVoicePhase = speech.status === "connecting"
    ? "connecting"
    : speech.status === "listening"
      ? "listening"
      : speech.status === "stopping"
        ? "stopping"
        : speech.status === "error" || speech.status === "denied" || speech.status === "unsupported"
          ? "error"
          : settled === "paused"
            ? "paused"
            : settled === "done"
              ? "done"
              : "idle";

  const liveChars = speech.committedText.replace(/\s/g, "").length + speech.partialText.replace(/\s/g, "").length;

  return {
    phase,
    totalSeconds: carriedSeconds + (speech.listening || speech.stopping ? speech.elapsedSeconds : 0),
    transcribedChars: phase === "listening" || phase === "stopping" || phase === "connecting" ? carriedChars + liveChars : carriedChars,
    silentSeconds,
    silenceHint: phase === "listening" && silentSeconds >= SILENCE_HINT_AFTER_SECONDS,
    autoPause,
    setAutoPause,
    start,
    pause,
    finish,
    discard,
    undo,
    dismiss,
    deviceMenuRequest,
    requestDeviceMenu: () => setDeviceMenuRequest((n) => n + 1),
  };
}
