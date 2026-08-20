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

/**
 * ⚠ 2026-08-20 人类实测反馈（devapp）：「点击 mic 图标以后要反应半天」「终止转录也不能
 * 正常终止」——根因是这个状态机原来只有 idle/listening 两头，中间没有任何"正在连接"/
 * "正在停止"的过渡态。真实上游（DashScope realtime ASR）的握手 + `getUserMedia`
 * 权限弹窗、以及收尾时等最后一段 `asr.final`（`configured-realtime-asr-provider.ts`
 * 的 `FINISH_GRACE_MS`，默认 15 秒上限）都是真实网络延迟，不是 0——旧状态机在这整段
 * 时间里界面**没有任何变化**，用户看到的就是"点了没反应""点了停不下来"。
 * 加 `connecting`/`stopping` 两态，让按钮在等待网络的这段时间里明确说出"正在连接"/
 * "正在停止"，不是沉默。
 */
export type AsrDraftStatus = "idle" | "connecting" | "listening" | "stopping" | "denied" | "unsupported" | "error";

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
  /** 已点开始，采音/WS 握手还没完成——真实上游下这段不是 0 秒，界面必须说话。 */
  readonly connecting: boolean;
  /** 已点停止，正在等最后一段 `asr.final` 落定——同样不是 0 秒（见上面文件头注）。 */
  readonly stopping: boolean;
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
  // 防"停止过程中又点了开始"：UI 层已经在 stopping 态禁用按钮，这里是第二道防线
  // （直接调用 hook、不经过按钮的调用方也不该在这个窗口里重新起一条新的采音管线）。
  const stoppingRef = React.useRef(false);
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
    if (handle === null) return; // 还没连上（connecting）或已经停了——没有一条真实句柄可停。
    // 同步置位：`handle.stop()` 要等上游确认收尾（真实上游下不是 0 秒），界面必须
    // 立刻说"正在停止"，不能等到 promise resolve 才有反应——那正是 devapp 实测反馈的
    // "终止转录也不能正常终止"（不是真没终止，是终止过程中界面看起来像没反应）。
    setStatus("stopping");
    stoppingRef.current = true;
    void handle.stop();
  }, []);

  const start = React.useCallback(() => {
    if (handleRef.current !== null || startingRef.current || stoppingRef.current) return; // 已经在录/正在连/正在停，忽略重复点击。
    if (!isCaptureSupported()) {
      setStatus("unsupported");
      setError("你的浏览器不支持语音输入（缺少麦克风采音或 WebSocket 能力），请手动输入或改用 Chrome 等支持的浏览器。");
      return;
    }
    baseTextRef.current = getBaseText();
    committedRef.current = "";
    setError(null);
    startingRef.current = true;
    // 同步置位：真实上游的采音权限弹窗 + WS 握手不是 0 秒，界面必须立刻说"正在连接"，
    // 不能等到 openAsrDraftStream 的 promise resolve 才有反应——那正是 devapp 实测反馈的
    // "点击 mic 图标以后要反应半天"。
    setStatus("connecting");

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
          stoppingRef.current = false;
          setStatus("error");
          setError(ERROR_TEXT[reason] ?? `语音识别出错：${reason}`);
        },
        onFinished: () => {
          handleRef.current = null;
          stoppingRef.current = false;
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

  return {
    status,
    listening: status === "listening",
    connecting: status === "connecting",
    stopping: status === "stopping",
    error,
    start,
    stop,
  };
}
