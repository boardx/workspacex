"use client";
import * as React from "react";
import { isMemberChatComposing } from "@/lib/project-member-chat-input";
import { ArrowUp, Copy, Hash, MessageCircle, MessagesSquare, PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectMemberStageReference } from "@/lib/live-project-member-chat";

export type MemberDeliveryState = "sending" | "unconfirmed" | "failed" | "stored";
export type TeamTextLiveMessage = {
  id: string; text: string; authorLabel: string; authorId?: string; createdAt?: string; own: boolean;
  state: MemberDeliveryState; failure?: string; retryable?: boolean; replyCount?: number;
  stageReference?: ProjectMemberStageReference | null;
};
export type TeamTextLiveTopic = {
  root: TeamTextLiveMessage; replies: readonly TeamTextLiveMessage[]; draft: string;
  historyState: "loading" | "ready" | "error"; historyError?: string; hasOlder: boolean; loadingOlder: boolean;
  onDraftChange: (text: string) => void; onSend: () => void; onRetry: (id: string) => void;
  onRefresh: () => void; onLoadOlder: () => void;
};
export type TeamTextLiveProps = {
  projectId: string; compact: boolean; onClose?: () => void; messages: readonly TeamTextLiveMessage[];
  draft: string; onDraftChange: (text: string) => void; onSend: () => void; onRetry: (id: string) => void;
  historyState: "loading" | "ready" | "error"; historyError?: string; onRefresh: () => void;
  readOnly: boolean; readOnlyNotice?: string; offline: boolean; syncing: boolean;
  hasOlder: boolean; loadingOlder: boolean; onLoadOlder: () => void;
  earlierTopics?: readonly { id: string; replyCount: number }[]; topicPending?: boolean; pendingTopicError?: string;
  topic?: TeamTextLiveTopic; onOpenTopic: (id: string) => void; onCloseTopic: () => void;
  stageReference?: ProjectMemberStageReference; includeStageReference: boolean; onIncludeStageReference: (included: boolean) => void;
};
/** Pure member UI. No Agent, memory action, notification or delivery guess is mounted. */
export function TeamTextLiveConversation(props: TeamTextLiveProps): JSX.Element {
  const [notice, setNotice] = React.useState("");
  const closeTopicButton = React.useRef<HTMLButtonElement>(null);
  const topicReturn = React.useRef<HTMLButtonElement | null>(null);
  const topicId = props.topic?.root.id;
  const [rootExpanded, setRootExpanded] = React.useState(false);
  React.useEffect(() => { setRootExpanded(false); }, [topicId]);
  const viewport = React.useRef<HTMLDivElement>(null);
  const followLatest = React.useRef(true);
  const [showLatest, setShowLatest] = React.useState(false);
  const displayedRows = props.topic?.replies ?? props.messages;
  const lastRow = displayedRows[displayedRows.length - 1];
  React.useLayoutEffect(() => { followLatest.current = true; setShowLatest(false); }, [topicId, props.projectId]);
  React.useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    if (followLatest.current || lastRow?.own) { node.scrollTop = node.scrollHeight; followLatest.current = true; setShowLatest(false); }
    else setShowLatest(true);
  }, [lastRow?.id, lastRow?.state, lastRow?.own, topicId]);
  React.useEffect(() => { if (topicId) closeTopicButton.current?.focus(); }, [topicId]);
  const closeTopic = () => { props.onCloseTopic(); setTimeout(() => { if (topicReturn.current?.isConnected) topicReturn.current.focus(); }, 0); };
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setNotice("已复制消息。"); } catch { setNotice("未能自动复制，请选择文字后复制。"); } }
  function message(item: TeamTextLiveMessage) {
    return <article key={item.id} data-testid="project-member-message" data-message-id={item.id} data-delivery={item.state} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 text-12 text-muted-foreground"><span className="font-medium text-background-foreground">{item.authorLabel}</span>{item.createdAt && <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>}</div>
      {item.authorId && <details className="text-12 text-muted-foreground"><summary className="w-fit cursor-pointer rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">查看成员ID</summary><p className="mt-1 select-all break-all" data-testid="project-member-author-id">{item.authorId}</p></details>}
      <p className={`whitespace-pre-wrap break-words rounded-control p-3 text-13 [overflow-wrap:anywhere] ${item.own ? "bg-secondary text-secondary-foreground" : "border border-border-subtle bg-card text-card-foreground"}`} data-testid="project-member-message-body">{item.text}</p>
      {item.stageReference && <p className="text-12 text-muted-foreground">讨论引用 · 第{item.stageReference.stageId}步{item.stageReference.revision ? ` · 共享稿版本${item.stageReference.revision}` : ""}</p>}
      <div className="flex flex-wrap items-center gap-2 text-12 text-muted-foreground">
        <Button size="xs" variant="ghost" type="button" aria-label="复制本条成员消息" onClick={() => void copy(item.text)}><Copy aria-hidden className="mr-1 h-3 w-3" />复制</Button>
        {!props.topic && item.state === "stored" && <Button type="button" size="xs" variant="ghost" data-testid={`project-member-topic-${item.id}`} onClick={(event) => { topicReturn.current = event.currentTarget; props.onOpenTopic(item.id); }}><MessagesSquare aria-hidden className="mr-1 h-3 w-3" />话题{item.replyCount ? ` · ${item.replyCount}` : ""}</Button>}
        {item.state === "stored" ? <span>服务器已保存</span> : item.state === "sending" ? <span role="status">发送中…</span> : <><span role="alert">{item.state === "unconfirmed" ? "尚未确认，原文保留" : "发送失败，原文保留"}{item.failure ? ` · ${item.failure}` : ""}</span>{item.retryable !== false && <Button type="button" size="xs" variant="outline" data-testid={`project-member-retry-${item.id}`} disabled={props.readOnly || props.offline} onClick={() => (props.topic ? props.topic.onRetry : props.onRetry)(item.id)}>同一请求重试</Button>}</>}
      </div>
    </article>;
  }
  const topic = props.topic, state = props.topicPending ? (props.pendingTopicError ? "error" : "loading") : topic?.historyState ?? props.historyState;
  const error = props.pendingTopicError ?? topic?.historyError ?? props.historyError;
  const rows = props.topicPending ? [] : topic?.replies ?? props.messages, draft = props.topicPending ? "" : topic?.draft ?? props.draft;
  const onDraft = topic?.onDraftChange ?? props.onDraftChange, send = topic?.onSend ?? props.onSend;
  const disabled = props.readOnly || props.offline || state !== "ready";
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="项目成员文字频道" data-testid="project-member-conversation" data-project-id={props.projectId}>
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border-subtle p-4"><div className="min-w-0"><p className="text-12 text-muted-foreground">项目成员 · 文字频道</p><h2 className="mt-1 flex items-center gap-2 text-16 font-medium"><Hash aria-hidden className="h-4 w-4" />小组讨论</h2></div>{props.compact && <Button type="button" size="icon" variant="ghost" aria-label="关闭小组讨论" data-testid="project-member-close" onClick={props.onClose}><PanelRightClose aria-hidden className="h-4 w-4" /></Button>}</header>
    <div className="space-y-2 px-4 pt-3 text-12 text-muted-foreground"><p>AI不会自动加入频道；讨论不会自动成为阶段成果。</p>{props.offline ? <p role="status">当前离线，未发送草稿仍保留；恢复网络后补拉。</p> : props.syncing ? <p role="status">正在同步频道…</p> : null}{props.readOnly && <p role="status" data-testid="project-member-readonly">{props.readOnlyNotice ?? "项目只读，不能发送或重试消息。"}</p>}{notice && <p role="status">{notice}</p>}</div>
    {(topic || props.topicPending) && <header className="mx-4 mt-3 shrink-0 space-y-2 border-b border-border-subtle pb-3" data-testid="project-member-topic-header">
      <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-14 font-medium"><MessagesSquare aria-hidden className="h-4 w-4" />话题</h3><Button ref={closeTopicButton} size="sm" variant="ghost" type="button" data-testid="project-member-topic-close" onClick={closeTopic}>返回频道</Button></div>
      {topic && <section className="space-y-2 rounded-control bg-secondary p-3" aria-label="正在回复的原消息" data-testid="project-member-topic-root" data-message-id={topic.root.id}>
        <div className="flex items-center justify-between gap-2"><p className="text-12 text-muted-foreground">正在回复 · <span className="font-medium text-background-foreground">{topic.root.authorLabel}</span></p><Button type="button" size="xs" variant="ghost" aria-expanded={rootExpanded} aria-controls="project-member-topic-original" data-testid="project-member-topic-expand" onClick={() => setRootExpanded((value) => !value)}>{rootExpanded ? "收起原文" : "展开原文"}</Button></div>
        <p id="project-member-topic-original" data-testid="project-member-topic-original" className={`whitespace-pre-wrap break-words text-13 [overflow-wrap:anywhere] ${rootExpanded ? "max-h-32 overflow-y-auto" : "line-clamp-2"}`}>{topic.root.text}</p>
        {rootExpanded && <div className="flex flex-wrap items-center gap-2 text-12 text-muted-foreground">{topic.root.createdAt && <time dateTime={topic.root.createdAt}>{new Date(topic.root.createdAt).toLocaleString()}</time>}{topic.root.authorId && <details><summary className="cursor-pointer">查看成员ID</summary><p className="select-all break-all">{topic.root.authorId}</p></details>}<Button size="xs" variant="ghost" type="button" onClick={() => void copy(topic.root.text)}><Copy aria-hidden className="mr-1 h-3 w-3" />复制原文</Button></div>}
      </section>}
    </header>}
    <div ref={viewport} onScroll={(event) => { const node = event.currentTarget; followLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; if (followLatest.current) setShowLatest(false); }} className="min-h-40 min-w-0 flex-1 space-y-4 overflow-y-auto p-4" role="log" aria-label={topic ? "本话题的回复" : "项目成员消息"} data-testid={topic ? "project-member-replies" : "project-member-history"} aria-live="polite">
      {!props.topicPending && (topic?.hasOlder ?? props.hasOlder) && <Button type="button" variant="ghost" size="sm" disabled={topic?.loadingOlder ?? props.loadingOlder} onClick={topic?.onLoadOlder ?? props.onLoadOlder} data-testid="project-member-load-older">{(topic?.loadingOlder ?? props.loadingOlder) ? "正在读取…" : "加载更早消息"}</Button>}
      {state === "loading" ? <p role="status" data-testid="project-member-loading">正在读取{topic ? "话题" : "频道"}…</p> : state === "error" ? <div role="alert" className="space-y-2" data-testid="project-member-history-error"><p className="text-13">{error ?? "消息读取失败。原有消息和草稿保留。"}</p><Button type="button" size="sm" variant="outline" onClick={topic?.onRefresh ?? props.onRefresh}>重试读取</Button></div> : null}
      {!topic && !props.topicPending && props.earlierTopics?.map((item) => <Button key={item.id} type="button" size="sm" variant="outline" data-testid={`project-member-earlier-topic-${item.id}`} onClick={() => props.onOpenTopic(item.id)}>较早话题有回复 · {item.replyCount}</Button>)}
      {rows.map((item) => message(item))}
      {state === "ready" && rows.length === 0 && <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center text-muted-foreground" data-testid="project-member-empty"><MessageCircle aria-hidden className="h-5 w-5" /><p className="text-14">{topic ? "还没有回复" : "从一条小组讨论开始"}</p></div>}
    </div>
    {showLatest && <Button size="sm" variant="ghost" type="button" onClick={() => { const node = viewport.current; if (node) node.scrollTop = node.scrollHeight; followLatest.current = true; setShowLatest(false); }}>跳到最新消息</Button>}
    <form className="shrink-0 space-y-2 border-t border-border-subtle bg-background p-4" data-testid="project-member-form" onSubmit={(event) => { event.preventDefault(); if (!disabled && draft.trim()) send(); }}>
      {props.stageReference && <label className="flex items-center gap-2 text-12"><input type="checkbox" checked={props.includeStageReference} disabled={disabled} onChange={(event) => props.onIncludeStageReference(event.currentTarget.checked)} />主动附上第{props.stageReference.stageId}步引用</label>}
      <label htmlFor="project-member-draft" className="block text-12 text-muted-foreground">{topic ? "回复此话题" : "发给项目成员"}</label>
      <div className="space-y-2 rounded-container border border-border-subtle bg-card p-3"><textarea id="project-member-draft" aria-label={topic ? "回复此话题" : "发给项目成员"} data-testid="project-member-input" rows={2} maxLength={4000} className="block w-full min-w-0 resize-none bg-transparent text-14 focus-visible:outline-none focus-visible:ring-0 disabled:text-disabled-foreground" value={draft} disabled={disabled} placeholder={topic ? "围绕这条消息回复…" : "讨论分工、安排与不同意见…"} onChange={(event) => onDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !isMemberChatComposing(event.nativeEvent)) { event.preventDefault(); if (!disabled && draft.trim()) send(); } }} /><div className="flex items-center justify-between gap-3"><span className="text-12 text-muted-foreground">Enter发送 · Shift+Enter换行</span><Button type="button" size="icon" variant="primary" aria-label={topic ? "发送话题回复" : "发送给项目成员"} data-testid="project-member-send" disabled={disabled || !draft.trim()} onClick={send}><ArrowUp aria-hidden className="h-4 w-4" /></Button></div></div>
    </form>
  </section>;
}
