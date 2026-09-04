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
  /** 停止并**保留**已转录的文字（追加进输入框）——TW-P0-5⑥ 的「确认」。 */
  readonly stop: () => void;
  /**
   * TW-P0-5⑥ —— 停止并**丢弃**这一段录音期间产生的转录，把输入框内容还原到开始
   * 录音那一刻（`baseTextRef`）。仍然真的调用底层 `handle.stop()` 收尾采音/WS，
   * 只是不把随后到达的 `onPartial`/`onFinal` 写回输入框——真实取消，不是假装。
   */
  readonly cancel: () => void;
  /** 本轮录音已进行的整数秒数；未在录音时为 0。纯本地计时，不是伪造进度条。 */
  readonly elapsedSeconds: number;
  /** 0..1，来自 `pcm16Level()` 对真实采到的帧求 RMS；未在录音时为 0。 */
  readonly level: number;
  /**
   * 2026-09-02 composer 重设计（转录方式：已确认为深色、识别中为浅灰带光标）——
   * 把"这一段录音"的三截文本分开暴露，渲染层才能区分颜色：
   * `baseText` 开始录音那一刻输入框里已有的文字；`committedText` 本段已落定的转录
   * （`asr.final` 累积）；`partialText` 当前还在识别中的临时片段。`onTranscript` 收到的
   * 完整文本 = base ⊕ committed ⊕ partial，三者只是同一份数据的拆分，不是第二份事实。
   * 录音结束后 `committedText` 保留到下一次 `start()`，供"撤销转录"把输入框还原到 `baseText`。
   */
  readonly baseText: string;
  readonly committedText: string;
  readonly partialText: string;
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
export function appendTranscript(base: string, addition: string): string {
  if (addition === "") return base;
  if (base === "") return addition;
  return /\s$/.test(base) ? `${base}${addition}` : `${base} ${addition}`;
}

/**
 * issue #2637 ⑤ —— 人类实测反馈：转录结果里混进很多多余的中文顿号/句号。根因：
 * `turn_detection: server_vad` 把一段连续的话按静音切成多个"轮次"，上游模型对
 * **每一轮**单独给出带标点的转写（`conversation.item.input_audio_transcription.completed`），
 * 而不是对整段话统一断句——于是同一句话被切成几段各自"、"/"。"收尾之后，`appendTranscript`
 * 原样拼接，读起来就是「早上好。我想说的是、今天…」这种每隔几个字就断一次标点的样子。
 *
 * 这里在**每一段转写落地时**清理，而不是等最终整段文本出来再清理一遍——用户是
 * 边说边看着「详细说说」实时更新的（`onTranscript`），伪影必须在它第一次出现的
 * 那一刻就被处理掉，不能只在录音结束后才回头改。
 *
 *   1. 折叠连续标点为最后一个（模型偶尔对同一处停顿重复给标点，如"。、"→"、"）。
 *   2. 去掉一段转写**开头**孤立的顿号/逗号——几乎总是上一轮刚结束、这一轮刚起时
 *      模型对静音的误判，不是说话人真的从标点开始说。
 *
 * 不处理段落**中间**的标点（那些多半是模型对真实停顿的合理判断，贸然剥掉会把
 * "我想说的是，今天" 变成读不断句的病句，比多几个标点更糟）。
 */
export function sanitizeAsrSegment(text: string): string {
  return text
    .replace(/[、。，,.!！?？;；:：]{2,}/g, (run) => run.slice(-1))
    .replace(/^[、，,]+/, "");
}

/**
 * 2026-09-04 review fix（PR #2644 reviewer diagnostic）—— `sanitizeAsrSegment` 只清理
 * **单个** final 段内部的标点，人类实测反馈报的其实是**跨段**的标点：一次连续的话被
 * server VAD 切成"早上好。"/"我想说的是。"/"今天…"这几个独立 final，每一段自己收尾时
 * 上游都会补一个句号——这些句号标的是"这一轮 VAD 判定的静音到了"，不是说话人真的在
 * 那里断句。原来的 `onFinal` 处理器把 `sanitizeAsrSegment` 只套在新到的这一段上，
 * 前面已经落定的 `committedRef.current` 末尾那个句号原样留着，于是拼起来还是
 * "早上好。我想说的是。今天…"——句号数量没变，只是从段内变成了段间。
 *
 * 修法：在**追加下一段之前**，剥掉已落定文本末尾那个"轮次边界"标点——这样只有真正
 * 说完整段话、后面再也没有新 final 追加进来的那一个末尾标点会被保留，中间每一轮的
 * 收尾标点在下一轮到达的那一刻就被去掉。不动段落**中间**的标点（那还是
 * `sanitizeAsrSegment` 的职责），也不动引导性的省略号"…"——那通常是说话人自己停顿，
 * 不是轮次边界的产物。
 */
function stripTrailingTurnBoundaryPunctuation(text: string): string {
  return text.replace(/[、。，,.!！?？;；:：]+$/, "");
}

export function useAsrDraft({ onTranscript, getBaseText, sessionToken, deviceId }: UseAsrDraftOptions): UseAsrDraftResult {
  const [status, setStatus] = React.useState<AsrDraftStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [level, setLevel] = React.useState(0);
  const [segments, setSegments] = React.useState({ baseText: "", committedText: "", partialText: "" });
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
  /**
   * TW-P0-5⑥ —— `cancel()` 与 `stop()` 共用同一条底层收尾路径，唯一区别是这个标记：
   * 置位后 `onPartial`/`onFinal` 到达时不再写回输入框，`onFinished` 把输入框强制
   * 复原到 `baseTextRef`（开始录音那一刻的文本）。不是另起一条采音/WS 逻辑。
   */
  const discardRef = React.useRef(false);

  const endSession = React.useCallback((discard: boolean) => {
    const handle = handleRef.current;
    handleRef.current = null;
    if (handle === null) return; // 还没连上（connecting）或已经停了——没有一条真实句柄可停。
    discardRef.current = discard;
    if (discard) {
      onTranscriptRef.current(baseTextRef.current);
      setSegments((s) => ({ ...s, committedText: "", partialText: "" }));
    }
    // 同步置位：`handle.stop()` 要等上游确认收尾（真实上游下不是 0 秒），界面必须
    // 立刻说"正在停止"，不能等到 promise resolve 才有反应——那正是 devapp 实测反馈的
    // "终止转录也不能正常终止"（不是真没终止，是终止过程中界面看起来像没反应）。
    setStatus("stopping");
    stoppingRef.current = true;
    void handle.stop();
  }, []);

  const stop = React.useCallback(() => endSession(false), [endSession]);
  const cancel = React.useCallback(() => endSession(true), [endSession]);

  const start = React.useCallback(() => {
    if (handleRef.current !== null || startingRef.current || stoppingRef.current) return; // 已经在录/正在连/正在停，忽略重复点击。
    if (!isCaptureSupported()) {
      setStatus("unsupported");
      setError("你的浏览器不支持语音输入（缺少麦克风采音或 WebSocket 能力），请手动输入或改用 Chrome 等支持的浏览器。");
      return;
    }
    baseTextRef.current = getBaseText();
    committedRef.current = "";
    discardRef.current = false;
    setSegments({ baseText: baseTextRef.current, committedText: "", partialText: "" });
    setError(null);
    setElapsedSeconds(0);
    setLevel(0);
    startingRef.current = true;
    // 同步置位：真实上游的采音权限弹窗 + WS 握手不是 0 秒，界面必须立刻说"正在连接"，
    // 不能等到 openAsrDraftStream 的 promise resolve 才有反应——那正是 devapp 实测反馈的
    // "点击 mic 图标以后要反应半天"。
    setStatus("connecting");

    void openAsrDraftStream(
      {
        onPartial: (rawText) => {
          if (discardRef.current) return;
          const text = sanitizeAsrSegment(rawText);
          setSegments((s) => ({ ...s, partialText: text }));
          onTranscriptRef.current(appendTranscript(baseTextRef.current, appendTranscript(committedRef.current, text)));
        },
        onFinal: (rawText) => {
          if (discardRef.current) return;
          const text = sanitizeAsrSegment(rawText);
          committedRef.current = appendTranscript(stripTrailingTurnBoundaryPunctuation(committedRef.current), text);
          setSegments((s) => ({ ...s, committedText: committedRef.current, partialText: "" }));
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
          if (discardRef.current) onTranscriptRef.current(baseTextRef.current);
          setSegments((s) => ({ ...s, partialText: "" }));
          setLevel(0);
          setStatus((current) => (current === "error" || current === "denied" ? current : "idle"));
        },
        // TW-P0-5⑥ —— 真实音量指示：每一帧真实采到的 PCM16 求一次 RMS，
        // 不是渲染层自己画的假动画（见 `pcm16Level()` 头注）。
        onLevel: (value) => setLevel(value),
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

  // TW-P0-5⑥ —— 录音计时：`listening` 期间每秒 +1，不在录音时归零。纯本地
  // `setInterval`，不依赖服务端回传的任何时间戳（上游没有提供，也不需要）。
  React.useEffect(() => {
    if (status !== "listening") return;
    const timer = window.setInterval(() => setElapsedSeconds((s) => s + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [status]);

  return {
    status,
    listening: status === "listening",
    connecting: status === "connecting",
    stopping: status === "stopping",
    error,
    start,
    stop,
    cancel,
    elapsedSeconds,
    level,
    baseText: segments.baseText,
    committedText: segments.committedText,
    partialText: segments.partialText,
  };
}
