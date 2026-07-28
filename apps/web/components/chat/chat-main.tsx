"use client";
import * as React from "react";
import { Users, Share2, PanelRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { MessageStream } from "./message-stream";
import { ReassignBar } from "./reassign-bar";
import { Composer } from "./composer";
import { ACTIVE_THREAD, CHAT_MESSAGES, type ChatMessage } from "@/lib/mock/chat";

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
        {/* 团队 N = 在场数（≠ 编制数 6）*/}
        <Button size="sm" variant="ghost" data-testid="chat-header-team">
          <Users aria-hidden className="h-3.5 w-3.5" />
          团队 {ACTIVE_THREAD.presentCount}
        </Button>
        {!readOnly && (
          <Button size="sm" variant="ghost" data-testid="chat-header-share">
            <Share2 aria-hidden className="h-3.5 w-3.5" />
            分享
          </Button>
        )}
        <Button size="sm" variant="ghost" data-testid="chat-header-sidebar">
          <PanelRight aria-hidden className="h-3.5 w-3.5" />
          侧栏
        </Button>
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
