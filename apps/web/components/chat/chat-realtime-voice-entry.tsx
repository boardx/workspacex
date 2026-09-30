"use client";

import * as React from "react";
import { AudioLines } from "lucide-react";
import { getAgentDirectoryCard } from "@/lib/agent-directory";
import { readAllPersistedMessages } from "@/lib/copilotkit-v2-persisted-messages";
import { RealtimeVoiceSession, type RealtimeVoicePersona } from "@/components/chat/realtime-voice-session";

/**
 * Composer 里的「实时对话」入口（语音输入胶囊左侧）：打开全屏数字人语音通话。
 *
 * 数字人 = composer 当前所选 Agent（未选则「通用助手」）。人设/音色由服务端按已发布角色解析，
 * 这里只取展示用的真人像（`GET /agents/directory/:agentId` 的 `avatar.key`，读失败静默退回插画）。
 * ⚠ 可访问名/title 刻意不含「语音/麦克风」：composer 只允许一个麦克风入口（TW-P0-5⑤ e2e 按名字计数）。
 * 与语音输入（ASR 草稿）互不影响：那是「说话转文字填进输入框」，这是「和数字人直接语音对话」。
 */
export interface ChatRealtimeVoiceEntryProps {
  readonly disabled: boolean;
  readonly agent: { readonly id: string; readonly name: string; readonly duty: string | null } | null;
  readonly resolveThreadId: () => Promise<string>;
  readonly onEnded: (info: { readonly threadId: string | null; readonly persistedMessageIds: readonly string[] }) => void;
}

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
    subtitle: agent?.duty ?? "随时可以聊，我会尽量简洁地回答",
    avatarKey,
  };

  return (
    <>
      <button
        type="button"
        data-testid="chat-composer-realtime-voice"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={`与${persona.name}实时对话`}
        title="实时对话：像打电话一样和数字人交谈（不调用工具）"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-13 text-card-foreground transition-colors duration-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground"
      >
        <AudioLines aria-hidden className="h-4 w-4" />
        <span className="hidden sm:inline">实时对话</span>
      </button>
      <RealtimeVoiceSession open={open} onOpenChange={setOpen} persona={persona} resolveThreadId={resolveThreadId} onEnded={onEnded} />
    </>
  );
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
