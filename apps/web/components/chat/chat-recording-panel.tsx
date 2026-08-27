"use client";

import * as React from "react";
import { Mic, Square } from "lucide-react";
import { recording } from "@repo/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { LiveRecordingError } from "@/lib/live-recording";
import { listMessages } from "@/lib/live-chat";
import {
  endThreadRecording,
  openAsrStream,
  readTranscript,
  startThreadRecording,
  type AsrStreamErrorReason,
  type AsrStreamHandle,
  type TranscriptSegment,
} from "@/lib/live-asr";

/**
 * #466 —— 核心闭环第 7 步：会话内录音 → 停止 → 转录归属该会话且刷新仍在。
 *
 * 设计签核见 `phases/phase-01-run-a-project/design-deltas/realtime-asr/design-signoff.md`
 * （人类 usamshen 于 2026-08-05 签核）；锚点命名见该目录 contract.md §5。
 *
 * ## 这条路径上没有一行 mock
 *
 * `apps/web/lib/mock/rec*` 与 `lib/mock/itv` 在本文件里**零引用**（contract.md §5 的
 * 硬要求）。开始 → `POST /recording/sessions`；音频 → `WS …/asr-stream`；
 * 转录 → `GET /recording/sessions/:id/segments`。三条都打真实后端。
 *
 * ## 转录**不是**前端状态
 *
 * 停止之后，本组件**重新 GET 一次**转写段，用服务端读回来的那一份**整体替换**
 * 流式过程中累积的那一份。这不是多此一举：它让「界面上看得见」与
 * 「PostgreSQL 里有」变成同一件事，从而让 e2e 里那句「刷新后仍在」不可能被
 * 一个只活在 React state 里的实现骗过去。本仓步骤 6a / 8a 都栽在这一处。
 *
 * ## 失败态说人话，不静默
 *
 * 三种采音失败（权限被拒 / 无麦克风 / 采音管线没起来）由 `live-recording.ts` 具名，
 * 六种 WS 失败由契约 `AsrStreamErrorReason` 具名。**没有「出错了」这一档兜底**——
 * 每一种都有自己的中文说明，因为用户对这六种的处置方式完全不同。
 */

/** 锚点。契约 contract.md §5 指定的四个，跟随既有 `chat-live-*` 前缀。 */
const TESTID = {
  start: "chat-live-recording-start",
  stop: "chat-live-recording-stop",
  status: "chat-live-recording-status",
  transcript: "chat-live-transcript",
} as const;

/**
 * WS 失败码 → 人话。
 *
 * ⚠ 用 `Record<AsrStreamErrorReason, string>` 而不是 `switch` + default：
 *   契约里加一个新码而这里忘了写，是**编译错误**，不是运行时冒出一句
 *   「未知错误」。契约里刻意没有 `UNKNOWN`，这里也就不该有兜底分支。
 */
const ASR_FAILURE_TEXT: Record<AsrStreamErrorReason, string> = {
  ASR_PROVIDER_UNAVAILABLE: "转写服务暂时不可用，本次录音没有产生转录。请稍后重试。",
  ASR_NOT_CONFIGURED: "本组织尚未配置转写服务，录音无法转成文字。请联系管理员配置后重试。",
  AUDIO_FORMAT_REJECTED: "转写服务不接受当前的音频格式。请刷新页面重试；若持续出现请联系管理员。",
  SESSION_ENDED: "这场录音已经结束，无法继续转写。请重新开始录音。",
  CONFIDENTIAL_SCOPE_FORBIDS_EXTERNAL_ASR:
    "本项目被标记为机密，音频不允许离开本地边界，因此不提供外部转写。",
  NO_PROJECT_ROLE: "你在本项目上没有角色，无法录音。请联系项目引导师把你加入项目。",
};

/**
 * 开始录音被拒 → 人话。
 *
 * 契约 `startRecording.err` 的每一条在这里都有出口。`CONSENT_NOT_COMPLETED` 与
 * `RETENTION_POLICY_MISSING` 尤其重要：它们是**服务端的门禁**，界面必须把
 * 「为什么不让录」说出来，否则用户只会看见一个点了没反应的按钮。
 */
const START_FAILURE_TEXT: Record<string, string> = {
  CONSENT_NOT_COMPLETED: "还有在场者的录音授权没有完成，本路不采集。请先完成授权矩阵。",
  RETENTION_POLICY_MISSING: "本项目没有设置录音保留期，按规定不能开始录音。请管理员先配置保留期。",
  SESSION_ALREADY_RECORDING: "这条会话已经在录音了。请先停止那一场，或刷新页面。",
  SOURCE_REF_NOT_FOUND: "找不到这条会话，无法开始录音。",
  NO_PROJECT_ROLE: "你在本项目上没有角色，无法录音。",
  IDEMPOTENCY_KEY_CONFLICT: "重复的开始请求。请刷新页面后重试。",
};

type Phase = "idle" | "starting" | "recording" | "stopping" | "failed";

export function ChatRecordingPanel({
  threadId,
  projectId,
  userId,
  bearer,
}: {
  threadId: string;
  projectId: string;
  userId: string;
  bearer: string;
}) {
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [failure, setFailure] = React.useState<string | null>(null);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [partial, setPartial] = React.useState("");
  const [segments, setSegments] = React.useState<readonly TranscriptSegment[]>([]);
  const streamRef = React.useRef<AsrStreamHandle | null>(null);
  /**
   * issue #2285（D10 前半 ④）—— 「转录中」行内卡的计时。存的是**开始时刻**，
   * 不是一个每秒自增的计数器：计数器在标签页被浏览器节流后台化时会漂移，
   * 「结束时刻 - 开始时刻」不会。`tick` 只用来强制这一段每秒重渲染一次，
   * 真正的数字每次都从 `recordingStartedAt` 重新算。
   */
  const [recordingStartedAt, setRecordingStartedAt] = React.useState<number | null>(null);
  const [tick, setTick] = React.useState(0);
  /** 「查看转录」——折叠态只显示一行摘要，展开后复用下面既有的完整转录区。 */
  const [transcriptExpanded, setTranscriptExpanded] = React.useState(false);
  /**
   * ⚠ 失败是**粘性**的：`onError` 在异步回调里发生，而 `stop()` 之后我们会去
   *   重读转录。用 ref 记住「这一场已经失败过」，否则一次成功的空读会把
   *   刚显示出来的失败原因抹掉，用户看见的是「什么都没发生」。
   */
  const failedRef = React.useRef(false);

  /**
   * 从服务端重读本场转录，**整体替换**本地那一份。
   *
   * 这一步是本组件与「假绿」之间的分界线：流式过程中攒的 `asr.final` 只是回显，
   * 界面最终显示的是**数据库读回来的**那一份。
   */
  const refresh = React.useCallback(async (id: string) => {
    const out = await readTranscript(id, bearer);
    setSegments(out.segments);
  }, [bearer]);

  /**
   * 换线程 = 换一场录音；同时把这条线程**上一场**录音的转录读回来。
   *
   * ## 为什么 sessionId 存在 localStorage 里（以及为什么这不是「转录存在前端」）
   *
   * 刷新页面之后，要读回这条线程的转录，就得知道那场录音的 `sessionId`。
   * 而契约里**没有**「按 `sourceRefId` 查会话」的读端口 —— 已签核的 delta
   * （contract.md §2）逐字写着「读回仍走既有 `readTranscriptStream`，
   * **本 delta 不新增读端口**」，所以补一条要另走一次签核。这是一个**真实缺口**，
   * 随 #466 上报，而不是被一个前端缓存假装成不存在。
   *
   * 于是这里存的是**一个 id**，不是转录内容：刷新后照样 `GET` 一次服务端，
   * 显示的每个字都来自 PostgreSQL。所以「刷新后仍在」这条断言仍然只有在
   * **真的落库了**的时候才成立 —— 把落库掏空（哪怕 HTTP 照样 200），
   * 这一句就会红，而这正是它存在的意义。
   */
  React.useEffect(() => {
    setPhase("idle");
    setFailure(null);
    setSegments([]);
    setPartial("");
    setRecordingStartedAt(null);
    setTranscriptExpanded(false);
    failedRef.current = false;
    const remembered = readRememberedSession(threadId);
    setSessionId(remembered);
    if (remembered === null) return;
    void readTranscript(remembered, bearer)
      .then((out) => setSegments(out.segments))
      // 读不回来不是「没有转录」，如实说。静默吞掉会让一次真实的读失败
      // 长得跟「这场录音什么都没录到」一模一样。
      .catch(() => setFailure("无法读取本会话此前的转录。请重试或联系管理员。"));
  }, [bearer, threadId]);

  const start = React.useCallback(async () => {
    setPhase("starting");
    setFailure(null);
    setSegments([]);
    setPartial("");
    failedRef.current = false;
    let started: Awaited<ReturnType<typeof startThreadRecording>>;
    try {
      started = await startThreadRecording(threadId, projectId, userId, bearer);
    } catch (e) {
      failedRef.current = true;
      setPhase("failed");
      setFailure(describeStartFailure(e));
      return;
    }
    setSessionId(started.sessionId);
    rememberSession(threadId, started.sessionId);
    const trackId = started.tracks[0]?.trackId;
    if (trackId === undefined) {
      // 服务端说开始了却一条音轨都没有 ⇒ 如实报，不假装在录。
      failedRef.current = true;
      setPhase("failed");
      setFailure("录音已开始，但服务端没有返回任何音轨，无法采音。请联系管理员。");
      return;
    }

    /**
     * 转录挂靠的锚点。
     *
     * ⚠ **`thread` 载体的段落必须锚在一条消息上**（已签 recording 束的 I-1，
     *   `domain/recording/transcription-core.ts` 的 `ANCHOR_RULES`）：一段对话里的
     *   转录，「它在哪儿」的答案是「在哪条消息旁边」。所以没有消息的会话**不能录** ——
     *   这里如实拒绝并说明原因，而**不是**编一个锚点让它落库：编出来的锚点会让
     *   「这段话出自哪儿」永远说不清，而那正是整个 recording 束存在的理由。
     */
    let anchorMessageId: string;
    try {
      const listed = await listMessages(threadId, { limit: 1 }, bearer);
      const latest = listed.messages[listed.messages.length - 1];
      if (latest === undefined) {
        failedRef.current = true;
        setPhase("failed");
        setFailure("本会话还没有任何消息，转录没有可挂靠的锚点。请先在会话里发一条消息。");
        return;
      }
      anchorMessageId = latest.id;
    } catch {
      failedRef.current = true;
      setPhase("failed");
      setFailure("无法读取本会话的消息，转录没有可挂靠的锚点。请重试。");
      return;
    }

    try {
      streamRef.current = await openAsrStream(started.sessionId, trackId, anchorMessageId, {
        onPartial: (text) => setPartial(text),
        onFinal: () => { setPartial(""); },
        onError: (reason) => {
          failedRef.current = true;
          setFailure(ASR_FAILURE_TEXT[reason]);
          setPhase("failed");
        },
        onFinished: () => setPartial(""),
      }, { sessionToken: bearer });
      setPhase("recording");
      setRecordingStartedAt(Date.now());
    } catch (e) {
      failedRef.current = true;
      setPhase("failed");
      setFailure(
        e instanceof LiveRecordingError
          ? e.message
          : "无法连接转写服务。请确认你仍处于登录状态后重试。",
      );
    }
  }, [bearer, projectId, threadId, userId]);

  const stop = React.useCallback(async () => {
    setPhase("stopping");
    try {
      await streamRef.current?.stop();
      streamRef.current = null;
      if (sessionId !== null) {
        await endThreadRecording(sessionId, bearer);
        await refresh(sessionId);
      }
    } catch (e) {
      failedRef.current = true;
      setFailure(
        e instanceof ApiError
          ? `停止录音失败（${e.reasonCode ?? e.status}）。转录可能不完整。`
          : "停止录音时出错，转录可能不完整。",
      );
    }
    setRecordingStartedAt(null);
    setTranscriptExpanded(false);
    setPhase(failedRef.current ? "failed" : "idle");
  }, [bearer, refresh, sessionId]);

  const busy = phase === "starting" || phase === "stopping";

  /**
   * 每秒重渲染一次——只在 `phase === "recording"` 时挂计时器，收尾/未开始时
   * 不空转。真正的耗时永远从 `recordingStartedAt` 重算（见其上方注释）。
   */
  React.useEffect(() => {
    if (phase !== "recording") return undefined;
    const id = window.setInterval(() => setTick((t) => t + 1), 1_000);
    return () => window.clearInterval(id);
  }, [phase]);

  const elapsedLabel = React.useMemo(
    () => formatElapsed(recordingStartedAt === null ? 0 : Date.now() - recordingStartedAt),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` 只是重算触发器，值本身不使用
    [recordingStartedAt, tick],
  );

  /** 最新一句：优先中间结果（还在说的那句），没有就是最后一条已落库的段落。 */
  const latestLine = partial !== "" ? partial : (segments[segments.length - 1]?.text ?? null);

  /**
   * D10（chat-main-fidelity-rubric.md）—— 参照图在转录中于输入区上方给一张行内卡
   * （"● 会议转录中 28:14 周宁：客户董事会给的窗口是十八个月… [查看转录][停止录音]"）。
   * 此前本组件恒显空闲态那一行（会话录音 / 未在录音 / 本会话还没有转录），
   * `phase === "recording"` 时视觉上和什么都没发生一样。这里只换展示层：
   * 计时/最新一句/停止动作全部读同一份已经真实存在的状态
   * （`recordingStartedAt`/`partial`/`segments`/既有 `stop()`），不新增数据源。
   */
  return (
    <section className="border-b border-border px-4 py-3" data-testid="chat-recording-panel">
      {phase === "recording" ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-card px-2.5 py-1.5"
          data-testid="chat-recording-active-card"
        >
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-destructive" />
          <span className="text-11 font-medium">会话转录中</span>
          <span className="font-mono text-10 text-muted-foreground" data-testid="chat-recording-elapsed">
            {elapsedLabel}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-11 text-muted-foreground"
            data-testid="chat-recording-latest-line"
          >
            {latestLine ?? "正在等待第一段转写…"}
          </span>
          <Button
            size="xs"
            variant="outline"
            data-testid="chat-recording-view-transcript"
            aria-expanded={transcriptExpanded}
            onClick={() => setTranscriptExpanded((v) => !v)}
          >
            查看转录
          </Button>
          <Button
            size="xs"
            variant="destructive"
            data-testid={TESTID.stop}
            onClick={() => void stop()}
          >
            <Square className="size-3" aria-hidden /> 停止录音
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Mic className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="text-11 font-medium">会话录音</span>
          <div className="flex-1" />
          <Button
            size="xs"
            variant="outline"
            data-testid={TESTID.start}
            disabled={busy}
            onClick={() => void start()}
          >
            开始录音
          </Button>
          <Button
            size="xs"
            variant="destructive"
            data-testid={TESTID.stop}
            disabled
            title="没有正在进行的录音"
            onClick={() => void stop()}
          >
            <Square className="size-3" aria-hidden /> 停止
          </Button>
        </div>
      )}

      {phase !== "recording" || transcriptExpanded ? (
        <>
          {/*
            状态锚点。它显示的是「阶段」，不是「有没有出错」——把两者揉进一句话，
            e2e 就只能断言「有文字」，而那种断言在功能全坏时照样绿。
          */}
          <p className="mt-2 text-11 text-muted-foreground" data-testid={TESTID.status} data-phase={phase}>
            {STATUS_TEXT[phase]}
            {sessionId !== null ? <span className="ml-1 font-mono text-10">会话 {sessionId}</span> : null}
          </p>

          {failure !== null ? (
            <p className="mt-1 text-11 text-destructive" data-testid="chat-live-recording-error">{failure}</p>
          ) : null}

          <div className="mt-2" data-testid={TESTID.transcript}>
            {segments.length === 0 && partial === "" ? (
              <p className="text-11 text-muted-foreground" data-testid="chat-live-transcript-empty">
                本会话还没有转录。
              </p>
            ) : null}
            {segments.map((segment) => (
              <p key={segment.id} className="text-12" data-testid={`chat-live-transcript-${segment.id}`}>
                {segment.text}
                {segment.lowConfidence ? <Badge tone="neutral">低置信度</Badge> : null}
              </p>
            ))}
            {/*
              中间结果单独一行且带自己的 testid：它不落库，绝不能与已落库的段落
              混在同一个断言里，否则「转录进了数据库」会被一段还没写库的文字满足。
            */}
            {partial !== "" ? (
              <p className="text-12 italic text-muted-foreground" data-testid="chat-live-transcript-partial">
                {partial}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** `ms` → `mm:ss`（超过一小时会自然溢出成三位分钟数，本仓录音场景不会跑那么久）。 */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 记住「这条线程最近一场录音的 sessionId」。
 *
 * ⚠ 存的是**一个 id**，不是转录内容 —— 转录每次都从服务端 `GET` 回来。
 *   它存在的唯一原因是契约里没有「按 sourceRefId 查会话」的读端口，
 *   而已签核的 delta 明确不新增读端口（contract.md §2）。缺口随 #466 上报。
 *   ⇒ 千万不要"顺手"把 segments 也存进来：那会让「刷新后仍在」变成一句
 *   永远为真的话，也就是本仓最忌讳的假绿。
 */
const SESSION_STORAGE_PREFIX = "wsx.recordingSession.";

function rememberSession(threadId: string, sessionId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${SESSION_STORAGE_PREFIX}${threadId}`, sessionId);
}

function readRememberedSession(threadId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`${SESSION_STORAGE_PREFIX}${threadId}`);
}

const STATUS_TEXT: Record<Phase, string> = {
  idle: "未在录音。",
  starting: "正在开始录音…",
  recording: "正在录音并实时转写…",
  stopping: "正在停止并等待最后一段转写落库…",
  failed: "录音未能完成。",
};

function describeStartFailure(error: unknown): string {
  if (error instanceof ApiError) {
    const known = error.reasonCode === null ? undefined : START_FAILURE_TEXT[error.reasonCode];
    if (known !== undefined) return known;
    return `无法开始录音（${error.reasonCode ?? `HTTP ${error.status}`}）。`;
  }
  return "无法开始录音：请求没有到达服务端。";
}

/**
 * 编译期钉子：契约的音频格式是唯一事实源。
 *
 * 采样率/声道数在本仓有两个消费者（浏览器采音、服务端适配器），第三个副本
 * 就是漂移的开始。这行断言让「界面这一侧以为是 16k」与「契约说是 16k」
 * 保持同一个来源 —— 改契约不改这里会**编译失败**，而不是录出一段上游听不懂的音频。
 */
const _AUDIO_FORMAT_IS_CONTRACT_OWNED: typeof recording.ASR_AUDIO_FORMAT =
  recording.streamOperations.streamAsr.audio;
void _AUDIO_FORMAT_IS_CONTRACT_OWNED;
