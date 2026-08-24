"use client";
import * as React from "react";
import { ChevronRight, AlertTriangle } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MarkdownMessage } from "./markdown-message";
import { MessageEntrance } from "./message-entrance";
import {
  TOOL_CALL_STATUS_LABEL,
  type ChatMessage,
  type MessageBadgeView,
  type ToolCallLog,
  type ToolCallStatus,
  type CitationView,
} from "@/lib/mock/chat";

type AiMessage = Extract<ChatMessage, { kind: "ai" }>;
type BadgeTone = "neutral" | "primary" | "ai" | "warning" | "danger" | "outline";

/**
 * AI 发言（UC-8.2 R3 步骤 3/4/8）：消息头（agent · 角色 · skill · 思考摘要 · 角标）、
 * 正文、可展开的工具调用链、可定位的引用列表。
 * 交互（展开工具调用 / 展开引用）在此客户端组件内自持状态。
 *
 * VZ-01：正文改由 `MarkdownMessage` 渲染 —— 支持 markdown（标题/列表/加粗/
 * 行内码/代码块/链接/表格）+ 内联 ```mermaid 图（白名单 12 种，越界/语法错落
 * 诚实错误态）。旧的纯文本 `<p>{msg.text}</p>` 退役。
 */
export function AiMessage({ msg }: { msg: AiMessage }) {
  return (
    <MessageEntrance testId="chat-message-entrance-ai">
      <article
        data-testid="chat-ai-message"
        className="flex gap-2.5 rounded-lg bg-ai-tint/40 p-3"
      >
        <Avatar initials={msg.initials} tone="ai" size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* 消息头 */}
          <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone="ai">AI</Badge>
            <span className="text-12 font-semibold">{msg.agentName} · {msg.agentRole}</span>
            {msg.skill && (
              <span className="text-11 text-muted-foreground" data-testid="chat-ai-skill">
                skill: {msg.skill}
              </span>
            )}
            {msg.thinking && (
              <span className="text-11 text-muted-foreground">▸ {msg.thinking}</span>
            )}
            <span className="text-11 text-muted-foreground">{msg.time}</span>
            {/* 角标标在发生它的这条消息上（UC-8.2 R7 状态 4.5）*/}
            {msg.badges.map((b, i) => (
              <MessageHeaderBadge key={i} badge={b} />
            ))}
          </header>

          <MarkdownMessage text={msg.text} />

          {msg.tools && <ToolCalls log={msg.tools} />}
          {msg.citations && msg.citations.length > 0 && <CitationList citations={msg.citations} />}
        </div>
      </article>
    </MessageEntrance>
  );
}

function MessageHeaderBadge({ badge }: { badge: MessageBadgeView }) {
  if (badge.kind === "degraded") {
    return (
      <Badge tone="warning" data-testid="chat-badge-degraded">
        <AlertTriangle aria-hidden className="h-3 w-3" />
        降级运行 · {badge.model}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" data-testid="chat-badge-review">
      待复核 {badge.count}
    </Badge>
  );
}

/** 工具调用链：默认折叠，折叠头即摘要；展开逐条列签名/结果/运行态（UC-8.2 R7 工具调用层）*/
function ToolCalls({ log }: { log: ToolCallLog }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-md border border-border-subtle bg-card" data-testid="chat-tool-calls">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="chat-tool-calls-toggle"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-11 transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight aria-hidden className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", open && "rotate-90")} />
        <span className="font-medium">工具调用 · {log.count}</span>
        <span className="text-muted-foreground">｜ 读了 {log.readItems} 条 · {log.tokens} token</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-1 border-t border-border-subtle p-2" data-testid="chat-tool-calls-detail">
          {log.calls.map((c, i) => (
            <li key={i} data-testid="chat-tool-call-row" className="flex items-center justify-between gap-3 rounded-sm px-1.5 py-1">
              <code className="min-w-0 flex-1 truncate font-mono text-11 text-card-foreground">{c.signature}</code>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className={cn("text-11", c.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                  {c.result}
                </span>
                <ToolStatusDot status={c.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolStatusDot({ status }: { status: ToolCallStatus }) {
  const toneByStatus: Record<ToolCallStatus, BadgeTone> = {
    failed: "danger",
    running: "ai",
    reuse: "neutral",
    done: "primary",
  };
  return <Badge tone={toneByStatus[status]}>{TOOL_CALL_STATUS_LABEL[status]}</Badge>;
}

/** 引用列表：编号 + 出处全称 + 页码/时间段，点开定位（UC-8.2 R7 引用层，三段缺一不可）*/
function CitationList({ citations }: { citations: CitationView[] }) {
  const [openIdx, setOpenIdx] = React.useState<number | null>(null);
  return (
    <ol className="flex flex-col gap-1 rounded-md border border-border-subtle bg-card p-2" data-testid="chat-citations">
      {citations.map((c) => (
        <li key={c.index}>
          <button
            type="button"
            onClick={() => setOpenIdx((v) => (v === c.index ? null : c.index))}
            aria-expanded={openIdx === c.index}
            data-testid="chat-citation-row"
            className="flex w-full items-baseline gap-2 rounded-sm px-1 py-0.5 text-left transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="shrink-0 text-11 font-semibold text-primary">{c.index}</span>
            <span className="min-w-0 flex-1 text-11">
              <span className="text-card-foreground">{c.sourceFullName}</span>
              <span className="text-muted-foreground"> · {c.anchor}</span>
            </span>
          </button>
          {openIdx === c.index && (
            <p className="ml-5 mt-0.5 rounded-sm bg-muted px-2 py-1 text-10 text-muted-foreground" data-testid="chat-citation-anchor">
              定位到 {c.anchor}（{c.anchorKind === "page" ? "文档页码" : c.anchorKind === "transcript" ? "转录时间码" : "消息锚点"}）· 不跳出线程
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
