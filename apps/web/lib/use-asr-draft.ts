/**
 * use-asr-draft.ts —— issue #726：composer 麦克风按钮的语音转录状态机。
 *
 * 验收标准（`.harness/instructions/chat-ux-acceptance-criteria.md` 第 5 项）："麦克风按钮是否
 * 能实时把语音转成文字填进输入框，转录过程中用户能看到实时文字更新（不是录完一段才整体填入），
 * 且转录结果可编辑后再发送"。
 *
 * 底层是服务端代理的 `WS /chat/asr-draft`（`live-asr-draft.ts` → 阿里云百炼实时 ASR，
 * key 只在服务端）——不是浏览器直连、也不是浏览器原生 `SpeechRecognition`。这份文件只是
 * 把"采音开始/结束/转录进来"这几件事包成一个状态机，方便渲染层订阅，不直接碰 DOM。
 */
"use client";
import * as React from "react";
import { openAsrDraftStream, type AsrDraftErrorReason } from "./live-asr-draft";
import { LiveRecordingError } from "./live-recording";

export type AsrDraftStatus = "idle" | "listening" | "denied" | "unsupported" | "error";

export interface UseAsrDraftOptions {
  /** 每次转录内容更新时调用，参数是"基线文本 + 已提交的最终转录 + 当前临时转录"拼接后的完整文本。 */
  readonly onTranscript: (fullText: string) => void;
  /** 开始录音那一刻读取一次，作为追加的基线（保留用户已经手打的文字，不覆盖）。 */
  readonly getBaseText: () => string;
  readonly sessionToken: string;
  /**
   * 选中的输入设备 `deviceId`（contract.md §7.1）。在**开始录音那一刻**读取一次
   * 传给采音层——所以空闲时换设备，下次点开始即生效。空/未传 = 系统默认设备。
   */
  readonly deviceId?: string;
}

export interface UseAsrDraftResult {
  readonly status: AsrDraftStatus;
  readonly listening: boolean;
  readonly error: string | null;
  readonly start: () => void;
  readonly stop: () => void;
}

const ERROR_TEXT: Record<AsrDraftErrorReason, string> = {
  ASR_PROVIDER_UNAVAILABLE: "语音识别服务暂时不可用，请稍后重试。",
  ASR_NOT_CONFIGURED: "当前环境尚未配置语音转写服务，暂时无法使用语音输入，请手动输入。",
  AUDIO_FORMAT_REJECTED: "音频格式被服务拒绝，请刷新页面后重试。",
};

/**
 * 浏览器是否具备"能开一条这样的录音"的基本能力——麦克风采音 + WebSocket。
 * 具体的权限被拒绝/无设备等失败态由 `startCapture()`（`live-recording.ts`）
 * 在真正尝试时以 `LiveRecordingError` 报出，这里只挡"压根没有这些 API"的极端环境。
 */
function isCaptureSupported(): boolean {
  if (typeof window === "undefined") return false;
  const hasAudioContext = typeof window.AudioContext === "function"
    || typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext === "function";
  return Boolean(window.WebSocket) && Boolean(navigator.mediaDevices?.getUserMedia) && hasAudioContext;
}

/** 把已提交的转录追加到基线之后——"追加，不覆盖用户已经手打的文字"。 */
function appendTranscript(base: string, addition: string): string {
  if (addition === "") return base;
  if (base === "") return addition;
  return /\s$/.test(base) ? `${base}${addition}` : `${base} ${addition}`;
}

export function useAsrDraft({ onTranscript, getBaseText, sessionToken, deviceId }: UseAsrDraftOptions): UseAsrDraftResult {
  const [status, setStatus] = React.useState<AsrDraftStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const handleRef = React.useRef<{ stop: () => Promise<void> } | null>(null);
  const startingRef = React.useRef(false);
  const baseTextRef = React.useRef("");
  const committedRef = React.useRef("");
  const onTranscriptRef = React.useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  // 与 baseText 同理：`start` 是稳定回调，用 ref 让它在被调用那一刻读到**最新**选中的
  // 设备，而不是闭包捕获的旧值——否则空闲时换设备不会生效。
  const deviceIdRef = React.useRef(deviceId);
  deviceIdRef.current = deviceId;

  const stop = React.useCallback(() => {
    const handle = handleRef.current;
    handleRef.current = null;
    if (handle !== null) void handle.stop();
  }, []);

  const start = React.useCallback(() => {
    if (handleRef.current !== null || startingRef.current) return; // 已经在录，忽略重复点击。
    if (!isCaptureSupported()) {
      setStatus("unsupported");
      setError("你的浏览器不支持语音输入（缺少麦克风采音或 WebSocket 能力），请手动输入或改用 Chrome 等支持的浏览器。");
      return;
    }
    baseTextRef.current = getBaseText();
    committedRef.current = "";
    setError(null);
    startingRef.current = true;

    void openAsrDraftStream(
      {
        onPartial: (text) => {
          onTranscriptRef.current(appendTranscript(baseTextRef.current, appendTranscript(committedRef.current, text)));
        },
        onFinal: (text) => {
          committedRef.current = appendTranscript(committedRef.current, text);
          onTranscriptRef.current(appendTranscript(baseTextRef.current, committedRef.current));
        },
        onError: (reason) => {
          handleRef.current = null;
          setStatus("error");
          setError(ERROR_TEXT[reason] ?? `语音识别出错：${reason}`);
        },
        onFinished: () => {
          handleRef.current = null;
          setStatus((current) => (current === "error" || current === "denied" ? current : "idle"));
        },
      },
      { sessionToken, deviceId: deviceIdRef.current },
    ).then((handle) => {
      startingRef.current = false;
      handleRef.current = handle;
      setStatus("listening");
    }).catch((caught: unknown) => {
      startingRef.current = false;
      handleRef.current = null;
      if (caught instanceof LiveRecordingError) {
        // `live-recording.ts` 已经把权限被拒绝/无设备/采音起不来分成具名的中文提示，
        // 这里原样透传，不重新发明第二套错误分类。
        setStatus(caught.kind === "permission-denied" ? "denied" : "error");
        setError(caught.message);
        return;
      }
      setStatus("error");
      setError("无法启动语音识别，请重试。");
    });
  }, [getBaseText, sessionToken]);

  React.useEffect(() => () => { void handleRef.current?.stop(); }, []);

  return { status, listening: status === "listening", error, start, stop };
}
