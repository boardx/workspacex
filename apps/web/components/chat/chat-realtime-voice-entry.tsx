"use client";

import * as React from "react";
import { AudioLines } from "lucide-react";
import { getAgentDirectoryCard } from "@/lib/agent-directory";
import { readAllPersistedMessages } from "@/lib/copilotkit-v2-persisted-messages";
import { createWorkbenchThread } from "@/lib/chat-workbench/project-scope";
import { deleteThread } from "@/lib/live-chat";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RealtimeVoiceSession, type RealtimeVoicePersona } from "@/components/chat/realtime-voice-session";

/**
 * Composer 里的「实时对话」入口（语音输入胶囊左侧）：打开全屏数字人语音通话。
 *
 * 数字人 = composer 当前所选 Agent（未选则「通用助手」）。人设/音色由服务端按已发布角色解析，
 * 这里只取展示用的真人像（`GET /agents/directory/:agentId` 的 `avatar.key`，读失败静默退回插画）。
 * ⚠ 可访问名（aria-label）与可见文字刻意不含「语音/麦克风」（title 含「语音通话」，e2e 只按 aria-label+文字计数）：composer 只允许一个麦克风入口（TW-P0-5⑤ e2e 按名字计数）。
 * 与语音输入（ASR 草稿）互不影响：那是「说话转文字填进输入框」，这是「和数字人直接语音对话」。
 */
export interface ChatRealtimeVoiceEntryProps {
  readonly disabled: boolean;
  readonly agent: { readonly id: string; readonly name: string; readonly duty: string | null; readonly roleLabel?: string | null } | null;
  readonly resolveThreadId: () => Promise<string>;
  readonly onEnded: (info: { readonly threadId: string | null; readonly persistedMessageIds: readonly string[] }) => void;
}

export const REALTIME_ENTRY_TOOLTIP = "和数字人语音通话（实时对话）；想把话转成文字填进输入框，请用「语音输入」";

export function ChatRealtimeVoiceEntry({ disabled, agent, resolveThreadId, onEnded }: ChatRealtimeVoiceEntryProps): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [avatarKey, setAvatarKey] = React.useState<string | null>(null);
  const agentId = agent?.id ?? null;

  React.useEffect(() => {
    setAvatarKey(null);
    if (!open || agentId === null) return;
    let cancelled = false;
    getAgentDirectoryCard(agentId)
      .then((card) => { if (!cancelled) setAvatarKey(card.avatar?.key ?? null); })
      .catch(() => { /* 目录读失败：退回插画头像，通话本身不受影响 */ });
    return () => { cancelled = true; };
  }, [open, agentId]);

  const persona: RealtimeVoicePersona = {
    agentId,
    name: agent?.name ?? "通用助手",
    // 名字下面放角色一句话（duty），与名字重复就退到头衔（roleLabel），都重复则不显示（见 realtimeVoiceSubtitle）。
    subtitle: agent ? pickVoiceSubtitle(agent) : "随时可以聊，我会尽量简洁地回答",
    avatarKey,
  };

  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="chat-composer-realtime-voice"
            onClick={() => setOpen(true)}
            disabled={disabled}
            aria-label={`与${persona.name}实时对话`}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-3 text-13 text-card-foreground transition-colors duration-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground"
          >
            <AudioLines aria-hidden className="h-4 w-4" />
            <span className="whitespace-nowrap">实时对话</span>
          </button>
          </TooltipTrigger>
          <TooltipContent data-testid="chat-composer-realtime-voice-tooltip">{REALTIME_ENTRY_TOOLTIP}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <RealtimeVoiceSession open={open} onOpenChange={setOpen} persona={persona} resolveThreadId={resolveThreadId} onEnded={onEnded} />
    </>
  );
}

/** duty / roleLabel 里第一个非空、且不等于名字的那条；都没有返回 null。 */
export function pickVoiceSubtitle(agent: { readonly name: string; readonly duty: string | null; readonly roleLabel?: string | null }): string | null {
  const name = agent.name.trim();
  for (const c of [agent.duty, agent.roleLabel]) {
    const t = c?.trim() ?? "";
    if (t.length > 0 && t !== name) return t;
  }
  return null;
}

/** 结构类型：只用到 CopilotKit agent 的消息读写两件事。 */
interface MessageSink {
  readonly messages: ReadonlyArray<{ readonly id: string }>;
  setMessages(messages: never): void;
}

/**
 * 挂断后把语音转写（服务端已落库的普通消息）并进当前视图：读回整条线程，只追加**本次通话**落库的那些
 * （`turn.persisted` 回报的 id）——不碰其余消息，避免与流式消息的临时 id 错配而重复。
 * 与挂载 hydration 同一个读口（`readAllPersistedMessages`），不另写一套分页。
 */
export async function mergePersistedVoiceTurns(sink: MessageSink, threadId: string, messageIds: readonly string[], bearer: string | undefined): Promise<void> {
  const wanted = new Set(messageIds);
  const { messages } = await readAllPersistedMessages(threadId, bearer);
  const live = sink.messages;
  const liveIds = new Set(live.map((m) => m.id));
  const fresh = messages
    .filter((m) => wanted.has(m.id) && !liveIds.has(m.id))
    .map((m) => ({ id: m.id, role: m.role, content: m.content }));
  if (fresh.length === 0) return;
  sink.setMessages([...live, ...fresh] as never);
}

export interface VoiceThreadLifecycleDeps {
  readonly create: (projectId: string | null) => Promise<{ readonly threadId: string; readonly version: number }>;
  readonly discard: (threadId: string, projectId: string | null, version: number) => Promise<unknown>;
}

const defaultLifecycleDeps: VoiceThreadLifecycleDeps = {
  create: createWorkbenchThread,
  discard: (threadId, projectId, version) => deleteThread(threadId, projectId, version, "实时对话未产生内容"),
};

/**
 * 新对话里开「实时对话」时线程的生命周期：会话开始需要一条真实线程承载判权与落库，所以按需建；
 * 挂断时**一轮都没落库**就把这条本次通话自建的线程删掉（不留空线程、不改地址栏）；
 * 落了库才交给 `onPersisted`（调用方在那里回写地址栏）。已有线程永远不删。
 */
export function createVoiceThreadLifecycle(
  opts: {
    readonly existingThreadId: () => string | null;
    readonly projectId: string | null;
    readonly onPersisted: (info: { readonly threadId: string; readonly createdByVoice: boolean; readonly messageIds: readonly string[] }) => void;
    /** 通话结束但一句都没落库（没说话 / 没识别到）——调用方给一句提示，别让用户以为保存了。 */
    readonly onNothingSaved?: () => void;
  },
  deps: VoiceThreadLifecycleDeps = defaultLifecycleDeps,
): { resolveThreadId: () => Promise<string>; onEnded: (info: { readonly threadId: string | null; readonly persistedMessageIds: readonly string[] }) => void } {
  let created: { threadId: string; version: number } | null = null;
  return {
    resolveThreadId: async () => {
      const existing = opts.existingThreadId();
      if (existing !== null) return existing;
      if (created === null) {
        const out = await deps.create(opts.projectId);
        created = { threadId: out.threadId, version: out.version };
      }
      return created.threadId;
    },
    onEnded: ({ threadId, persistedMessageIds }) => {
      const own = created !== null && created.threadId === threadId ? created : null;
      if (threadId === null) return;
      if (persistedMessageIds.length === 0) {
        opts.onNothingSaved?.();
        if (own) {
          created = null;
          void deps.discard(own.threadId, opts.projectId, own.version).catch(() => { /* 删失败只留一条空线程，不打扰用户 */ });
        }
        return;
      }
      created = null;
      opts.onPersisted({ threadId, createdByVoice: own !== null, messageIds: persistedMessageIds });
    },
  };
}
