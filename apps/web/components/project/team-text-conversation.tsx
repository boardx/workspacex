"use client";
import * as React from "react";
import { isMemberChatComposing } from "@/lib/project-member-chat-input";
import { ArrowUp, Copy, Hash, MessageCircle, MessagesSquare, PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { V2UserMessage } from "@/components/chat/copilotkit-v2-user-message";

export type TeamTextPreviewMessage = { id: string; text: string; state: "preview" | "failed" };
export type TeamTextPreviewChannel = { key: string; title: string; scope: string };
/** Human text conversation UI. The caller owns delivery; this preview has no message transport. */
export function TeamTextConversation({ channel, channels, messages, draft, compact, readOnly, historyState = "ready", onDraftChange, onSend, onRetry, onHistoryRetry, onChooseChannel, onClose }: {
  channel: TeamTextPreviewChannel; channels: readonly TeamTextPreviewChannel[]; messages: readonly TeamTextPreviewMessage[]; draft: string;
  compact: boolean; readOnly: boolean; historyState?: "ready" | "loading" | "error";
  onDraftChange: (value: string) => void; onSend: () => void; onRetry: (id: string) => void; onHistoryRetry: () => void;
  onChooseChannel: (key: string) => void; onClose: () => void;
}): JSX.Element {
  const [copyNotice, setCopyNotice] = React.useState("");
  const [historyOffset, setHistoryOffset] = React.useState<number | null>(null);
  const [topic, setTopic] = React.useState<{ channelKey: string; messageId: string } | null>(null);
  const topicClose = React.useRef<HTMLButtonElement>(null);
  const topicReturn = React.useRef<HTMLButtonElement | null>(null);
  const focusedMessage = historyState === "ready" && topic?.channelKey === channel.key ? messages.find((message) => message.id === topic.messageId) : undefined;
  const closeTopic = (): void => {
    setTopic(null);
    const target = topicReturn.current;
    setTimeout(() => { if (target?.isConnected) target.focus(); }, 0);
  };
  const focusedTopicId = focusedMessage?.id;
  React.useEffect(() => { if (focusedTopicId) topicClose.current?.focus(); }, [focusedTopicId]);
  const pageSize = 5;
  const lastPageStart = Math.max(0, messages.length - pageSize);
  const pageStart = historyOffset === null ? lastPageStart : Math.min(historyOffset, lastPageStart);
  const inputUnavailable = readOnly || historyState !== "ready" || !!focusedMessage;
  React.useEffect(() => { setHistoryOffset(null); setTopic(null); }, [channel.key]);
  const sendMessage = (): void => { if (inputUnavailable || !draft.trim()) return; setHistoryOffset(null); onSend(); };
  const copyMessage = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice("已复制本条消息。");
    } catch {
      setCopyNotice("未能自动复制，请选择消息文字后复制。");
    }
  };
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4" aria-label="成员文字交流" data-testid="team-text-conversation" data-channel={channel.key}>
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0" data-testid="team-text-channel-heading"><p className="text-12 text-muted-foreground">{channel.scope} · 人类成员</p><h2 className="mt-1 flex items-center gap-2 break-words text-16 font-medium"><Hash aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />{channel.title}</h2></div>
      {compact && <Button type="button" variant="ghost" size="icon" aria-label="关闭团队沟通" data-testid="team-text-close" data-global="close-comm" onClick={onClose}><PanelRightClose aria-hidden className="h-4 w-4" /></Button>}
    </header>
    <details className="text-12" data-testid="team-text-channels"><summary className="cursor-pointer">切换频道 · 草稿按频道保留</summary><nav className="mt-2 flex flex-col gap-1" aria-label="文字频道">{channels.map((c) => <Button key={c.key} type="button" variant={c.key === channel.key ? "secondary" : "ghost"} size="sm" className="justify-start" data-global="channel" data-channel={c.key} data-testid={`team-text-channel-${c.key}`} onClick={() => { setTopic(null); onChooseChannel(c.key); }} aria-current={c.key === channel.key ? "page" : undefined}>{c.scope} · {c.title}</Button>)}</nav></details>
    <p className="text-12 text-muted-foreground" data-testid="team-text-boundary">文字沟通预览 · 只保留本页测试内容，未发送给其他成员、未写入项目。AI不会自动加入频道或将讨论认作成果。</p>
    {copyNotice && <p role="status" className="text-12 text-muted-foreground" data-testid="team-text-copy-status">{copyNotice}</p>}
    {readOnly && <p className="rounded-control bg-muted p-3 text-12" role="status" data-testid="team-text-readonly">项目已归档，只读回看；不能发送或重试消息。</p>}
    <nav className={(messages.length <= pageSize || historyState !== "ready" || !!focusedMessage ? "hidden" : "flex") + " flex-wrap items-center gap-2 text-12"} aria-label="本频道本页记录分页" data-testid="team-text-pagination" hidden={messages.length <= pageSize || historyState !== "ready" || !!focusedMessage}>
      <span data-testid="team-text-page-range">第{messages.length ? pageStart + 1 : 0}–{Math.min(pageStart + pageSize, messages.length)}条 / 共{messages.length}条本页记录</span>
      <Button type="button" variant="outline" size="xs" data-team="older-messages" disabled={pageStart === 0} onClick={() => setHistoryOffset(Math.max(0, pageStart - pageSize))}>更早5条</Button>
      <Button type="button" variant="outline" size="xs" data-team="newer-messages" disabled={pageStart === lastPageStart} onClick={() => setHistoryOffset(Math.min(lastPageStart, pageStart + pageSize))}>较新5条</Button>
      <Button type="button" variant="outline" size="xs" data-team="latest-messages" disabled={pageStart === lastPageStart} onClick={() => setHistoryOffset(null)}>最近5条</Button>
    </nav>
    <div className="min-h-40 min-w-0 flex-1 space-y-3" role="log" aria-label="本频道的本页消息" aria-live="polite" data-testid="team-text-history" hidden={!!focusedMessage}>
      {historyState === "loading" ? <p role="status" className="text-13 text-muted-foreground" data-testid="team-text-loading">正在读取频道记录（状态预览）…</p>
        : historyState === "error" ? <div role="alert" className="space-y-2 text-13" data-testid="team-text-history-error"><p>频道记录读取失败（状态预览）。未把失败当作没有消息。</p><Button type="button" size="sm" variant="outline" data-testid="team-text-history-retry" data-team="history-retry" disabled={readOnly} onClick={onHistoryRetry}>重试读取预览</Button></div>
        : messages.length ? messages.slice(pageStart, pageStart + pageSize).map((m) => <article key={m.id} data-testid="team-text-message" data-message-id={m.id} data-delivery={m.state}>
          <p className="mb-1 text-right text-12 text-muted-foreground">我 · 本页预览</p>
          <div className="min-w-0 [overflow-wrap:anywhere] [&_[data-testid=copilot-user-toolbar]]:hidden"><V2UserMessage message={{ id: m.id, role: "user", content: m.text }} /></div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-12 text-muted-foreground"><Button type="button" size="xs" variant="ghost" data-team="copy-message" data-message-id={m.id} aria-label="复制本条消息" onClick={() => void copyMessage(m.text)}><Copy aria-hidden className="h-3 w-3" />复制</Button><Button type="button" size="xs" variant="ghost" data-team="open-topic" data-message-id={m.id} data-testid={`team-text-topic-${m.id}`} aria-label="查看消息话题" onClick={(event) => { topicReturn.current = event.currentTarget; setTopic({ channelKey: channel.key, messageId: m.id }); }}><MessagesSquare aria-hidden className="h-3 w-3" />话题</Button>{m.state === "failed" ? <><span role="alert">发送失败示例 · 原文仍保留</span><Button type="button" size="xs" variant="outline" data-team="retry-message" data-message-id={m.id} data-testid={`team-text-retry-${m.id}`} disabled={readOnly} onClick={() => onRetry(m.id)}>重试预览</Button></> : <span>仅本页可见 · 未实际发送</span>}</div>
        </article>)
          : <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground" data-testid="team-text-empty"><MessageCircle aria-hidden className="h-5 w-5" /><p className="text-14">从一条小组讨论开始</p><p className="text-12">交流分工、研究安排与不同意见。需要成为成果的内容，再由学生主动整理。</p></div>}
    </div>
    {focusedMessage && <aside className="flex min-h-40 flex-1 flex-col gap-4 rounded-control border border-border-subtle bg-card p-3" aria-label="消息话题" data-testid="team-text-topic-panel">
      <header className="flex items-center justify-between gap-3"><div><p className="text-12 text-muted-foreground">主频道 · {channel.title}</p><h3 className="text-14 font-medium">话题</h3></div><Button ref={topicClose} type="button" size="sm" variant="ghost" data-team="close-topic" data-testid="team-text-topic-close" onClick={closeTopic}>返回频道</Button></header>
      <div className="min-w-0 [overflow-wrap:anywhere] [&_[data-testid=copilot-user-toolbar]]:hidden" data-testid="team-text-topic-source"><V2UserMessage message={{ id: focusedMessage.id, role: "user", content: focusedMessage.text }} /></div>
      <p className="text-12 text-muted-foreground" data-testid="team-text-topic-boundary">本页话题预览。回复、@成员、通知和已读状态尚未接入；主频道未发送的草稿保持不变。</p>
    </aside>}
    <form className="space-y-2" data-testid="team-text-form" hidden={!!focusedMessage} onSubmit={(e) => { e.preventDefault(); if (!readOnly && draft.trim()) sendMessage(); }}>
      <label htmlFor="wx-member-input" className="block text-12 text-muted-foreground">发给「{channel.title}」的成员</label>
      <div className="space-y-3 rounded-container border border-border-subtle bg-card p-3">
        <textarea id="wx-member-input" aria-label="发给频道成员" data-testid="team-text-input" className="block w-full min-w-0 resize-none bg-transparent text-14 focus-visible:outline-none focus-visible:ring-0 disabled:text-disabled-foreground" rows={2} maxLength={4000} value={draft} disabled={inputUnavailable} placeholder="和组员讨论下一步…" onChange={(e) => onDraftChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isMemberChatComposing(e.nativeEvent)) { e.preventDefault(); if (!readOnly && draft.trim()) sendMessage(); } }} />
        <div className="flex items-center justify-between gap-3"><span className="text-12 text-muted-foreground">Enter 发送 · Shift+Enter 换行</span><Button type="button" size="icon" variant="primary" id="wx-member-send" aria-label="预览发送给频道成员" data-global="send-message" data-testid="team-text-send" disabled={inputUnavailable || !draft.trim()} onClick={sendMessage}><ArrowUp aria-hidden className="h-4 w-4" /></Button></div>
      </div>
    </form>
  </section>;
}

// The live transport owner uses the same human-channel feature without mounting AI UI.
export { TeamTextLiveConversation } from "./team-text-live-conversation";
