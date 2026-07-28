"use client";
import { Mic, GitBranch, Sparkles } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AiMessage } from "./ai-message";
import { ApprovalCard } from "./approval-card";
import type { ChatMessage } from "@/lib/mock/chat";

/**
 * 消息流（UC-8.2 R3 二）：四类卡 + 进度卡 + 转录卡。
 * AI 发言与批准卡有交互，下沉到各自的客户端组件；本文件负责按 kind 分发与
 * 人的发言 / 产物卡 / 进度卡 / 转录卡这几种展示型卡片。
 */
export function MessageStream({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="flex flex-col gap-4" data-testid="chat-message-stream">
      {messages.map((m) => {
        switch (m.kind) {
          case "human":
            return <HumanMessage key={m.id} msg={m} />;
          case "ai":
            return <AiMessage key={m.id} msg={m} />;
          case "artifact":
            return <ArtifactCardView key={m.id} artifact={m.artifact} />;
          case "approval":
            return <ApprovalCard key={m.id} request={m.request} />;
          case "progress":
            return <ProgressCard key={m.id} msg={m} />;
          case "transcript":
            return <TranscriptCard key={m.id} msg={m} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

type Human = Extract<ChatMessage, { kind: "human" }>;
function HumanMessage({ msg }: { msg: Human }) {
  return (
    <article className="flex gap-2.5" data-testid="chat-human-message">
      <Avatar initials={msg.initials} tone="human" size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <header className="flex items-center gap-2">
          <span className="text-12 font-semibold">{msg.author}</span>
          <span className="text-11 text-muted-foreground">{msg.time}</span>
        </header>
        <p className="text-13 text-card-foreground">{msg.text}</p>
      </div>
    </article>
  );
}

type Artifact = Extract<ChatMessage, { kind: "artifact" }>["artifact"];
function ArtifactCardView({ artifact }: { artifact: Artifact }) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm" data-testid="chat-artifact-card">
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <GitBranch aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 flex-1 truncate text-13 font-semibold">
          {artifact.artType} · {artifact.name}
        </h3>
        <Badge tone="ai">AI</Badge>
        <Button size="xs" variant="ghost" data-testid="chat-artifact-fullscreen">全屏编辑</Button>
      </header>
      <div className="flex flex-col gap-2 p-3">
        <p className="text-12 text-muted-foreground">{artifact.structure}</p>
        <code className="rounded-sm bg-muted px-2 py-1 font-mono text-11 text-card-foreground">
          {artifact.dataChain}
        </code>
        <p className="inline-flex items-center gap-1 text-11 text-destructive">
          <Sparkles aria-hidden className="h-3 w-3" />
          {artifact.annotation}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {artifact.actions.map((a, i) => (
            <Button key={a} size="sm" variant={i === 0 ? "outline" : "ghost"} data-testid={`chat-artifact-action-${i}`}>
              {a}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}

type ProgressMsg = Extract<ChatMessage, { kind: "progress" }>;
function ProgressCard({ msg }: { msg: ProgressMsg }) {
  return (
    <section className="flex items-center gap-3 rounded-lg border border-border-subtle bg-panel px-3 py-2" data-testid="chat-progress-card">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge tone="ai">{msg.agent}</Badge>
          <span className="truncate text-12">{msg.task}</span>
          <span className="shrink-0 text-11 text-muted-foreground">{msg.done}/{msg.total}</span>
        </div>
        <Progress value={(msg.done / msg.total) * 100} />
      </div>
      <Button size="xs" variant="ghost" data-testid="chat-progress-view">查看进度 ▸</Button>
      <Button size="xs" variant="ghost" data-testid="chat-progress-pause">暂停</Button>
    </section>
  );
}

type TranscriptMsg = Extract<ChatMessage, { kind: "transcript" }>;
function TranscriptCard({ msg }: { msg: TranscriptMsg }) {
  return (
    <section className="rounded-lg border border-border-subtle bg-panel-alt px-3 py-2" data-testid="chat-transcript-card">
      <header className="flex items-center gap-2">
        <Mic aria-hidden className="h-3.5 w-3.5 text-primary" />
        <span className="text-11 font-medium">会议转录中</span>
        <span className="text-11 text-muted-foreground">{msg.elapsed}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" data-testid="chat-transcript-view">查看转录</Button>
          <Button size="xs" variant="ghost" data-testid="chat-transcript-stop">停止录音</Button>
        </div>
      </header>
      <p className="mt-1 text-12 text-card-foreground">{msg.line}</p>
    </section>
  );
}
