"use client";
import * as React from "react";
import Link from "next/link";
import { Mic, GitBranch, Sparkles, Maximize2, Check, ChevronRight, AlertTriangle } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AiMessage } from "./ai-message";
import { ApprovalCard } from "./approval-card";
import { MessageEntrance } from "./message-entrance";
import { cn } from "@/lib/utils";
import { TRANSCRIPT_ENTRIES, type ChatMessage } from "@/lib/mock/chat";

/**
 * 消息流（UC-8.2 R3 二）：四类卡 + 进度卡 + 转录卡。
 * AI 发言与批准卡有交互，下沉到各自的客户端组件；本文件负责按 kind 分发与
 * 人的发言 / 产物卡 / 进度卡 / 转录卡这几种展示型卡片，并给每张卡片接上真实出口。
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
    <MessageEntrance testId="chat-message-entrance-human">
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
    </MessageEntrance>
  );
}

type Artifact = Extract<ChatMessage, { kind: "artifact" }>["artifact"];
function ArtifactCardView({ artifact }: { artifact: Artifact }) {
  // 乐观：产物动作点了给可见反馈（派给 / 加入报告）——真实落库在服务端
  const [applied, setApplied] = React.useState<number[]>([]);
  const feedbackFor = (label: string) =>
    label.includes("派给") ? `已${label} · 转后台任务` : label.includes("报告") ? "已加入报告草稿" : `已${label}`;

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm" data-testid="chat-artifact-card">
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <GitBranch aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 flex-1 truncate text-13 font-semibold">
          {artifact.artType} · {artifact.name}
        </h3>
        <Badge tone="ai">AI</Badge>
        {/* 假设树在画布上编辑 → 真链接到项目画布 */}
        <Button size="xs" variant="ghost" asChild data-testid="chat-artifact-fullscreen">
          <Link href="/projects/p1/canvas">
            <Maximize2 aria-hidden className="h-3 w-3" />
            全屏编辑
          </Link>
        </Button>
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
          {artifact.actions.map((a, i) =>
            applied.includes(i) ? (
              <span
                key={a}
                className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-11 text-success"
                data-testid={`chat-artifact-done-${i}`}
              >
                <Check aria-hidden className="h-3 w-3" />
                {feedbackFor(a)}
              </span>
            ) : (
              <Button
                key={a}
                size="sm"
                variant={i === 0 ? "outline" : "ghost"}
                onClick={() => setApplied((p) => [...p, i])}
                data-testid={`chat-artifact-action-${i}`}
              >
                {a}
              </Button>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

type ProgressMsg = Extract<ChatMessage, { kind: "progress" }>;
function ProgressCard({ msg }: { msg: ProgressMsg }) {
  const [paused, setPaused] = React.useState(false);
  return (
    <section className="flex items-center gap-3 rounded-lg border border-border-subtle bg-panel px-3 py-2" data-testid="chat-progress-card">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge tone={paused ? "neutral" : "ai"}>{msg.agent}</Badge>
          <span className="truncate text-12">{msg.task}</span>
          <span className="shrink-0 text-11 text-muted-foreground">{msg.done}/{msg.total}</span>
          {paused && <Badge tone="warning" data-testid="chat-progress-paused">已暂停</Badge>}
        </div>
        <Progress value={(msg.done / msg.total) * 100} label={`${msg.task} 进度`} />
      </div>
      {/* 查看进度 → 任务详情在 /tasks */}
      <Button size="xs" variant="ghost" asChild data-testid="chat-progress-view">
        <Link href="/tasks">查看进度 ▸</Link>
      </Button>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => setPaused((v) => !v)}
        aria-pressed={paused}
        data-testid="chat-progress-pause"
      >
        {paused ? "继续" : "暂停"}
      </Button>
    </section>
  );
}

type TranscriptMsg = Extract<ChatMessage, { kind: "transcript" }>;
function TranscriptCard({ msg }: { msg: TranscriptMsg }) {
  const [expanded, setExpanded] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const [stopped, setStopped] = React.useState(false);

  return (
    <section className="rounded-lg border border-border-subtle bg-panel-alt px-3 py-2" data-testid="chat-transcript-card">
      <header className="flex items-center gap-2">
        <Mic aria-hidden className={cn("h-3.5 w-3.5", stopped ? "text-muted-foreground" : "text-primary")} />
        <span className="text-11 font-medium">{stopped ? "会议转录已停止" : "会议转录中"}</span>
        <span className="text-11 text-muted-foreground">{msg.elapsed}</span>
        {!stopped && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              data-testid="chat-transcript-view"
            >
              <ChevronRight aria-hidden className={cn("h-3 w-3 transition-transform duration-fast", expanded && "rotate-90")} />
              查看转录
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setStopping(true)} data-testid="chat-transcript-stop">停止录音</Button>
          </div>
        )}
      </header>

      {!stopped && <p className="mt-1 text-12 text-card-foreground">{msg.line}</p>}

      {/* 展开：把右栏转录的最近几行内联出来（同源数据，不跳出线程）*/}
      {expanded && !stopped && (
        <ul className="mt-2 flex flex-col gap-1.5 border-t border-border-subtle pt-2" data-testid="chat-transcript-inline">
          {TRANSCRIPT_ENTRIES.map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5" data-testid={`chat-transcript-inline-${e.id}`}>
              <span className="flex items-baseline gap-2">
                <span className="text-11 font-medium">{e.speaker}</span>
                <span className="font-mono text-10 text-muted-foreground">{e.time}</span>
              </span>
              <span className="text-11 text-card-foreground">{e.text}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 停止录音 = 危险动作：二次确认 + 影响范围 */}
      {stopping && !stopped && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5" role="alertdialog" data-testid="chat-transcript-stop-confirm">
          <p className="inline-flex items-start gap-1.5 text-11 text-destructive">
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            停止后本场不再实时转录，已转文本保留；重新开始会新建一段录音。确定停止？
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="destructive" onClick={() => { setStopped(true); setStopping(false); }} data-testid="chat-transcript-stop-yes">确认停止</Button>
            <Button size="sm" variant="ghost" onClick={() => setStopping(false)} data-testid="chat-transcript-stop-no">返回</Button>
          </div>
        </div>
      )}

      {stopped && (
        <p className="mt-1 rounded-md bg-muted px-2 py-1.5 text-11 text-muted-foreground" data-testid="chat-transcript-stopped">
          已停止录音 · 已转文本保留在右栏「转录」页，可继续检索。
        </p>
      )}
    </section>
  );
}
