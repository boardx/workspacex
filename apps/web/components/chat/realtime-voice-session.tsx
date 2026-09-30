"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Hand, Loader2, Mic, MicOff, PhoneOff, RotateCw } from "lucide-react";
import { AvatarIllustration } from "@/components/ui/avatar-illustration";
import { Button } from "@/components/ui/button";
import { formatElapsed } from "@/components/chat/chat-composer-voice-control";
import {
  describeOmniStartFailure,
  openOmniConversation,
  type OmniConversationHandle,
  type OmniErrorReason,
} from "@/lib/live-omni-conversation";
import { cn } from "@/lib/utils";

/**
 * Chat 语音模式（「实时对话」，ADR-121）——全屏数字人通话界面。
 *
 * 复用白板 POC 的同一个客户端库（`lib/live-omni-conversation.ts`：采音、PCM 播放、打断），
 * 本组件只负责呈现与会话状态机：
 *   连接中 → 通话中（空闲 / 在听 / 思考中 / 在说）→ 断线重连 → 已结束 / 出错。
 * 每轮说完服务端把转写落成本线程的普通消息（`turn.persisted`），挂断后线程里能看到整段对话。
 * 语音模式不调用工具/技能/工作流（页脚说明，数字人指令里同样写明）。
 */

export interface RealtimeVoicePersona {
  readonly agentId: string | null;
  readonly name: string;
  readonly subtitle: string | null;
  /** `dh-*` 真人像 key；null 时用通用助手插画。 */
  readonly avatarKey: string | null;
}

type Phase = "connecting" | "live" | "reconnecting" | "error";
type Activity = "idle" | "listening" | "thinking" | "speaking";

interface Failure {
  readonly title: string;
  readonly detail: string;
  readonly retryable: boolean;
}

const REASON_FAILURE: Record<OmniErrorReason, Failure> = {
  NOT_CONFIGURED: { title: "实时语音尚未开通", detail: "管理员配置实时语音模型后即可使用。你可以先用文字继续对话。", retryable: false },
  AGENT_UNAVAILABLE: { title: "这个数字人暂不可用", detail: "它可能尚未发布，或你没有使用权限。请换一个数字人或使用通用助手。", retryable: false },
  THREAD_UNAVAILABLE: { title: "当前对话无法开启语音", detail: "这条对话可能已归档，或你只有查看权限。", retryable: false },
  UPSTREAM_FAILED: { title: "实时模型暂时不可用", detail: "请稍后重试。", retryable: true },
  INVALID_FRAME: { title: "会话数据异常", detail: "请重新开始通话。", retryable: true },
};

const ACTIVITY_LABEL: Record<Activity, string> = { idle: "空闲", listening: "在听", thinking: "思考中", speaking: "在说" };
const MAX_RECONNECTS = 2;
const RECONNECT_DELAY_MS = 1_500;

export interface RealtimeVoiceSessionProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly persona: RealtimeVoicePersona;
  /** 取（必要时新建）承载转写的线程 id。 */
  readonly resolveThreadId: () => Promise<string>;
  /** 会话结束（挂断/关闭）时回调；`persistedMessageIds` 是本次通话落进线程的消息 id。 */
  readonly onEnded?: (info: { readonly threadId: string | null; readonly persistedMessageIds: readonly string[] }) => void;
  /** 测试注入；缺省为真实实现。 */
  readonly connect?: typeof openOmniConversation;
}

export function RealtimeVoiceSession(props: RealtimeVoiceSessionProps): JSX.Element {
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-background text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          data-testid="realtime-voice-session"
          aria-describedby="realtime-voice-session-scope"
        >
          {props.open ? <SessionBody {...props} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SessionBody({ onOpenChange, persona, resolveThreadId, onEnded, connect = openOmniConversation }: RealtimeVoiceSessionProps): JSX.Element {
  const [phase, setPhase] = React.useState<Phase>("connecting");
  const [activity, setActivity] = React.useState<Activity>("idle");
  const [failure, setFailure] = React.useState<Failure | null>(null);
  const [muted, setMuted] = React.useState(false);
  const [userCaption, setUserCaption] = React.useState("");
  const [assistantCaption, setAssistantCaption] = React.useState("");
  const [elapsed, setElapsed] = React.useState(0);

  const handleRef = React.useRef<OmniConversationHandle | null>(null);
  const threadIdRef = React.useRef<string | null>(null);
  const persistedRef = React.useRef<string[]>([]);
  const reconnectsRef = React.useRef(0);
  const fatalRef = React.useRef(false);
  const endedRef = React.useRef(false);
  const mutedRef = React.useRef(false);
  const generationRef = React.useRef(0);

  const start = React.useCallback(async (mode: "fresh" | "reconnect") => {
    const generation = ++generationRef.current;
    fatalRef.current = false;
    setFailure(null);
    setPhase(mode === "fresh" ? "connecting" : "reconnecting");
    setActivity("idle");
    try {
      const threadId = threadIdRef.current ?? await resolveThreadId();
      threadIdRef.current = threadId;
      if (endedRef.current || generation !== generationRef.current) return;
      const stale = () => generation !== generationRef.current || endedRef.current;
      let closeHandled = false;
      const handle = await connect({ threadId, agentId: persona.agentId }, {
        onReady: () => { if (stale()) return; reconnectsRef.current = 0; setPhase("live"); },
        onUserSpeech: (speaking) => { if (!stale()) setActivity(speaking ? "listening" : "thinking"); },
        onUserTranscript: (text, final) => {
          if (stale()) return;
          setUserCaption((current) => (final ? text : text || current));
          if (!final) setAssistantCaption("");
        },
        onAssistantTranscript: (text, final) => {
          if (!stale()) setAssistantCaption((current) => (final ? text : `${current}${text}`));
        },
        onAssistantAudio: (speaking) => { if (!stale()) setActivity(speaking ? "speaking" : "idle"); },
        onTurnPersisted: (_role, messageId) => { persistedRef.current.push(messageId); },
        onError: (_message, reason) => {
          if (stale()) return;
          const next = reason ? REASON_FAILURE[reason] : { title: "网络连接中断", detail: "正在尝试恢复通话。", retryable: true };
          if (!next.retryable) fatalRef.current = true;
          setFailure(next);
        },
        onClosed: () => {
          if (stale() || closeHandled) return;
          closeHandled = true;
          handleRef.current = null;
          setActivity("idle");
          if (!fatalRef.current && reconnectsRef.current < MAX_RECONNECTS) {
            reconnectsRef.current += 1;
            setPhase("reconnecting");
            window.setTimeout(() => { if (!stale()) void start("reconnect"); }, RECONNECT_DELAY_MS);
            return;
          }
          setPhase("error");
          setFailure((current) => current ?? { title: "通话已断开", detail: "网络不稳定，请重试。", retryable: true });
        },
      });
      if (stale()) { void handle.stop(); return; }
      handleRef.current = handle;
      handle.setMuted(mutedRef.current);
    } catch (error) {
      if (generation !== generationRef.current || endedRef.current) return;
      fatalRef.current = true;
      setPhase("error");
      setFailure({ title: "无法开始通话", detail: describeOmniStartFailure(error), retryable: true });
    }
  }, [connect, persona.agentId, resolveThreadId]);

  React.useEffect(() => {
    endedRef.current = false;
    const persisted = persistedRef.current; // 同一个数组，就地 push
    void start("fresh");
    return () => {
      endedRef.current = true;
      generationRef.current += 1;
      const handle = handleRef.current;
      handleRef.current = null;
      void handle?.stop();
      onEnded?.({ threadId: threadIdRef.current, persistedMessageIds: [...persisted] });
    };
    // 只在挂载时开一次；`start` 的依赖变化不应重开会话。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (phase !== "live") return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const toggleMute = React.useCallback(() => {
    setMuted((value) => {
      const next = !value;
      mutedRef.current = next;
      handleRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const interrupt = React.useCallback(() => {
    handleRef.current?.cancelResponse();
    setActivity("idle");
  }, []);

  const retry = React.useCallback(() => {
    reconnectsRef.current = 0;
    void start("fresh");
  }, [start]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLButtonElement) return;
    if (event.key === "m" || event.key === "M") { event.preventDefault(); toggleMute(); }
  };

  const visibleActivity: Activity = phase === "live" ? activity : "idle";
  const statusText = phase === "connecting" ? "正在连接…"
    : phase === "reconnecting" ? "连接中断，正在重连…"
    : phase === "error" ? (failure?.title ?? "通话已断开")
    : muted && visibleActivity !== "speaking" ? "已静音"
    : ACTIVITY_LABEL[visibleActivity];

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <header className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-6">
        <div className="min-w-0">
          <DialogPrimitive.Title className="truncate text-16 font-semibold">与 {persona.name} 实时对话</DialogPrimitive.Title>
          <p className="text-12 text-muted-foreground">
            {phase === "live" ? <span data-testid="realtime-voice-elapsed">{formatElapsed(elapsed)}</span> : "语音模式"}
          </p>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4 py-6 sm:px-6">
        <Portrait persona={persona} activity={visibleActivity} phase={phase} />
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-20 font-semibold">{persona.name}</p>
          {persona.subtitle ? <p className="max-w-md text-13 text-muted-foreground">{persona.subtitle}</p> : null}
          <p
            role="status"
            aria-live="polite"
            data-testid="realtime-voice-status"
            data-phase={phase}
            data-activity={visibleActivity}
            className={cn("mt-2 flex items-center gap-2 text-14 font-medium", phase === "error" ? "text-destructive" : "text-primary")}
          >
            {phase === "connecting" || phase === "reconnecting" ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
            {statusText}
          </p>
        </div>

        {phase === "error" && failure ? (
          <div role="alert" data-testid="realtime-voice-error" className="flex max-w-sm flex-col items-center gap-3 rounded-container border border-border bg-card px-5 py-4 text-center">
            <p className="text-13 text-muted-foreground">{failure.detail}</p>
            {failure.retryable ? (
              <Button variant="outline" size="sm" onClick={retry} data-testid="realtime-voice-retry">
                <RotateCw aria-hidden className="mr-2 h-4 w-4" />重试
              </Button>
            ) : null}
          </div>
        ) : (
          <section aria-label="实时字幕" data-testid="realtime-voice-captions" className="flex w-full max-w-xl flex-col gap-3">
            <Caption who="你" text={userCaption} placeholder={phase === "live" ? "直接开口说话，说完稍作停顿即可" : ""} testId="realtime-voice-caption-user" />
            <Caption who={persona.name} text={assistantCaption} placeholder="" testId="realtime-voice-caption-assistant" emphasis />
          </section>
        )}
      </main>

      <footer className="flex flex-col items-center gap-3 px-4 pb-6 sm:px-6">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="lg"
            className="h-14 w-14 rounded-full p-0"
            onClick={toggleMute}
            disabled={phase !== "live"}
            aria-pressed={muted}
            aria-label={muted ? "取消静音（快捷键 M）" : "静音（快捷键 M）"}
            data-testid="realtime-voice-mute"
          >
            {muted ? <MicOff aria-hidden className="h-6 w-6" /> : <Mic aria-hidden className="h-6 w-6" />}
          </Button>
          <Button
            variant="destructive"
            size="lg"
            className="h-16 w-16 rounded-full p-0"
            onClick={() => onOpenChange(false)}
            aria-label="挂断（Esc）"
            data-testid="realtime-voice-hangup"
          >
            <PhoneOff aria-hidden className="h-7 w-7" />
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-14 w-14 rounded-full p-0"
            onClick={interrupt}
            disabled={phase !== "live" || visibleActivity !== "speaking"}
            aria-label="打断回答（也可以直接开口说话）"
            data-testid="realtime-voice-interrupt"
          >
            <Hand aria-hidden className="h-6 w-6" />
          </Button>
        </div>
        <p id="realtime-voice-session-scope" className="max-w-md text-center text-11 text-muted-foreground">
          可随时开口打断。语音模式暂不支持调用工具、技能和工作流；需要时请挂断后用文字对话。对话内容会保存到当前会话。
        </p>
      </footer>
    </div>
  );
}

function Portrait({ persona, activity, phase }: { persona: RealtimeVoicePersona; activity: Activity; phase: Phase }): JSX.Element {
  return (
    <div className="relative flex items-center justify-center" data-testid="realtime-voice-portrait" data-activity={activity}>
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-full border-4 transition-colors duration-base",
          activity === "listening" && "animate-pulse border-primary",
          activity === "speaking" && "border-primary",
          activity === "thinking" && "animate-spin border-border border-t-primary",
          activity === "idle" && (phase === "error" ? "border-destructive" : "border-border"),
        )}
      />
      <div
        className={cn(
          "m-2 size-40 overflow-hidden rounded-full bg-muted text-muted-foreground shadow-lg transition-transform duration-base sm:size-56",
          activity === "speaking" && "scale-105",
        )}
      >
        <AvatarIllustration avatarKey={persona.avatarKey ?? "robot"} />
      </div>
      {activity === "speaking" ? (
        <div aria-hidden className="absolute -bottom-3 flex h-8 items-center gap-1 rounded-full border border-border bg-card px-3 shadow">
          {[0, 1, 2, 3, 4].map((bar) => (
            <span key={bar} className="w-1 animate-pulse rounded-full bg-primary" style={{ height: `${8 + (bar % 3) * 5}px`, animationDelay: `${bar * 90}ms` }} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Caption({ who, text, placeholder, testId, emphasis }: { who: string; text: string; placeholder: string; testId: string; emphasis?: boolean }): JSX.Element | null {
  if (!text && !placeholder) return null;
  return (
    <p data-testid={testId} className={cn("rounded-container px-4 py-3 text-14", emphasis ? "bg-card text-card-foreground" : "text-muted-foreground")}>
      <span className="mr-2 text-12 font-medium text-muted-foreground">{who}</span>
      {text || placeholder}
    </p>
  );
}
