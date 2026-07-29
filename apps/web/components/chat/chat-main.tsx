"use client";
import * as React from "react";
import { Users, Share2, PanelRight, Lock, Link2, Check } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { MessageStream } from "./message-stream";
import { ReassignBar } from "./reassign-bar";
import { Composer } from "./composer";
import {
  ACTIVE_THREAD,
  TEAM_ROSTER_COUNT,
  CHAT_MESSAGES,
  TEAM_AGENTS,
  AGENT_PRESENCE_LABEL,
  type ChatMessage,
} from "@/lib/mock/chat";

/**
 * 对话中栏（UC-8.2 R3 二/三）—— 线程头部 + 消息流 + 输入区，并统一走 `StateShell`
 * 承载七态。交互（发送、改派、批准）都在子客户端组件里，本组件只做编排与状态分发。
 *
 * 观察者（readOnly）投影（UC-8.5 R5/R6）：输入区、改派条、批准卡、转录卡**不渲染**
 * （不是禁用）。⚠ 这是**界面投影**，真实权限由服务端不下发实现，视角切换只是预览手段。
 */
export function ChatMain({ state, readOnly = false }: { state: UiState; readOnly?: boolean }) {
  // 观察者只读：滤掉操作面（批准卡）与原始转写（转录卡）——服务端不下发的界面等价
  const messages: ChatMessage[] = readOnly
    ? CHAT_MESSAGES.filter((m) => m.kind !== "approval" && m.kind !== "transcript")
    : CHAT_MESSAGES;

  // 输入区在这些态可见；loading / dep-failed / denied 由 StateShell 接管中栏，不显示输入区
  const showComposer = !readOnly && ["default", "invalid", "success", "empty"].includes(state);
  const showReassign = !readOnly && ["default", "success"].includes(state);

  return (
    <div className="flex h-full flex-col" data-testid="chat-main">
      {/* 线程头部 */}
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5" data-testid="chat-thread-header">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-14 font-semibold">{ACTIVE_THREAD.title}</h1>
          <p className="truncate text-11 text-muted-foreground">{ACTIVE_THREAD.subtitle}</p>
        </div>
        {readOnly && (
          <span className="inline-flex items-center gap-1 text-11 text-muted-foreground" data-testid="chat-observer-tag">
            <Lock aria-hidden className="h-3 w-3" />只读
          </span>
        )}
        <ChatHeaderActions readOnly={readOnly} />
      </header>

      {/* 消息流区（七态统一走 StateShell）*/}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <StateShell
          state={state}
          skeletonRows={5}
          emptyHint="还没有消息。向 AI 团队提第一个问题，或 @ 某个 agent 指定它回答。"
          onCreate={() => window.alert("演示：聚焦输入区，发起第一条消息")}
          errors={{
            budget: "预算 1,200k 超出本项目上限 800k，请下调后再发送",
            message: "消息内容不能为空",
          }}
          depFailure={{
            what: "MCP『行业数据库』与转录服务（ASR）暂时不可用；基于它们的结论已标为不完整，你的输入已保留",
            retry: () => window.location.reload(),
          }}
          denial={{ layer: "project", reason: "你在本项目是观察者，原始转写与执行内容不下发" }}
          successMessage="已批准 · 已转后台任务，约 6 分钟回到本线程"
        >
          <MessageStream messages={messages} />
        </StateShell>
      </div>

      {/* 底部：改派条 + 输入区 / 或观察者只读说明 */}
      {(showComposer || readOnly) && (
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          {showReassign && <ReassignBar />}
          {showComposer ? (
            <Composer invalid={state === "invalid"} />
          ) : (
            <p className="rounded-md bg-muted px-3 py-2 text-11 text-muted-foreground" data-testid="chat-readonly-note">
              观察者只读：已发布产出与脱敏聚合可见；原始转写、私聊与操作按钮都不下发。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** 线程头部动作区 —— 团队在场浮层 / 分享浮层 / 侧栏折叠 */
function ChatHeaderActions({ readOnly }: { readOnly: boolean }) {
  const [open, setOpen] = React.useState<null | "team" | "share">(null);
  const present = TEAM_AGENTS.filter((a) => a.presence === "present");

  return (
    <div className="relative flex items-center gap-1">
      {/*
        裁决 D-U6（2026-07-28）：「两个数同时显示」，不让用户猜哪个是哪个。
        · 在场 = 能立刻响应的（presence === "present"）——回答「现在问一句谁会答」
        · 编制 = 编入本线程的全部 agent（跑批中 / 空闲也算编制内）
        UC-4.2 R6 本来就要求「两个口径分别标注」，此前只显示了在场数，这次落实。
      */}
      <Button
        size="sm"
        variant={open === "team" ? "primary" : "ghost"}
        onClick={() => setOpen((v) => (v === "team" ? null : "team"))}
        aria-expanded={open === "team"}
        data-testid="chat-header-team"
      >
        <Users aria-hidden className="h-3.5 w-3.5" />
        <span data-testid="chat-header-present-count">在场 {ACTIVE_THREAD.presentCount}</span>
        <span aria-hidden className="text-muted-foreground">/</span>
        <span data-testid="chat-header-roster-count" className="text-muted-foreground">
          编制 {TEAM_ROSTER_COUNT}
        </span>
      </Button>

      {!readOnly && (
        <Button
          size="sm"
          variant={open === "share" ? "primary" : "ghost"}
          onClick={() => setOpen((v) => (v === "share" ? null : "share"))}
          aria-expanded={open === "share"}
          data-testid="chat-header-share"
        >
          <Share2 aria-hidden className="h-3.5 w-3.5" />
          分享
        </Button>
      )}

      {/* 侧栏折叠属布局层，预览中右栏固定展示 —— 显式禁用（显式禁用是设计）*/}
      <Button
        size="sm"
        variant="ghost"
        disabled
        title="右侧上下文栏在预览中固定展示；折叠交互属应用外壳（AppShell）布局层，未在本屏接线"
        data-testid="chat-header-sidebar"
      >
        <PanelRight aria-hidden className="h-3.5 w-3.5" />
        侧栏
      </Button>

      {open === "team" && (
        <div
          role="dialog"
          aria-label="在场团队"
          data-testid="chat-team-popover"
          className="absolute right-0 top-full z-10 mt-1 flex w-64 flex-col gap-1.5 rounded-md border border-border bg-card p-2 shadow-md"
        >
          <p className="px-1 text-10 text-muted-foreground">
            在场 {ACTIVE_THREAD.presentCount} · 编制 {ACTIVE_THREAD.rosterCount}（跑批中/空闲不计入在场数）
          </p>
          {present.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-sm px-1 py-1" data-testid={`chat-team-popover-agent-${a.id}`}>
              <Avatar initials={a.initials} tone="ai" size="xs" />
              <span className="min-w-0 flex-1 truncate text-11 font-medium">{a.name} · {a.role}</span>
              <Badge tone="primary">{AGENT_PRESENCE_LABEL[a.presence]}</Badge>
            </div>
          ))}
        </div>
      )}

      {open === "share" && <SharePopover onClose={() => setOpen(null)} />}
    </div>
  );
}

/** 分享浮层 —— 外发是可见动作：给出链接、可见范围与「观察者只读」影响说明，不做成孤零零按钮 */
function SharePopover({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const url = "https://app.workspacex.dev/chat?thread=eu-storage";

  const copy = () => {
    navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      role="dialog"
      aria-label="分享线程"
      data-testid="chat-share-popover"
      className="absolute right-0 top-full z-10 mt-1 flex w-72 flex-col gap-2 rounded-md border border-border bg-card p-2.5 shadow-md"
    >
      <div className="flex items-center gap-1.5">
        <Share2 aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-12 font-medium">分享这个线程</h3>
      </div>
      <div className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-muted px-2 py-1.5">
        <Link2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-10 text-muted-foreground" data-testid="chat-share-link">{url}</span>
        <Button size="xs" variant={copied ? "primary" : "outline"} onClick={copy} data-testid="chat-share-copy">
          {copied ? <><Check aria-hidden className="h-3 w-3" />已复制</> : "复制"}
        </Button>
      </div>
      <p className="rounded-md bg-warning/10 px-2 py-1.5 text-10 text-warning" data-testid="chat-share-scope-note">
        影响范围：被分享者以<strong className="font-medium">观察者只读</strong>加入——仅见已发布产出与脱敏聚合，看不到原始转写、私聊与操作按钮。真实权限由服务端授予，非本链接决定。
      </p>
      <div className="flex items-center justify-end">
        <Button size="xs" variant="ghost" onClick={onClose} data-testid="chat-share-close">完成</Button>
      </div>
    </div>
  );
}
