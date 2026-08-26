"use client";

import * as React from "react";
import { Package, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatPanelSkeleton } from "@/components/chat/chat-panel-skeleton";
import type { ListThreadArtifactsOut } from "@/lib/live-chat";

/**
 * 十项 UX 缺口第 4 项（右侧上下文面板，issue #708）—— 真实「产物」列表。
 *
 * ⚠ 原型期五标签设计（转录/执行/洞察/产物/材料）里，「转录」有独立入口
 *   （`ChatRecordingPanel`，挂在消息面板上方，issue #728 D9 人类 2026-08-21 裁决
 *   明确不搬进右侧栏）；「执行/洞察」在后端**没有任何真实数据支撑**——`get-thread.ts`
 *   的 `rightTabs()` 把这两项计数硬编码为 0，没有查询、没有落库，待后端建模，本轮不做。
 *   给它们画一个永远显示「0」或编造假计数的标签页，比不做还坏：那是在编一个
 *   「有数据源」的假象。「材料」这一项**已经**有真实 `chat_message_attachments` 表支撑
 *   （见 `chat-materials-panel.tsx`），与本面板拼成 D9 的两个真标签，一起挂在
 *   `chat-read-screen.tsx` 右侧栏的 `Tabs` 下。
 *
 * 数据来自 `listThreadArtifacts`（`GET /chat/threads/:threadId/artifacts`），
 * 由 `chat-read-screen.tsx` 顶层读取（与 `roster` 同一套 key/loading/failure 纪律），
 * 这里只负责渲染，不发第二次请求。
 *
 * issue #2099（真实 devapp 实测：条目点了没反应）—— `onOpen` 是可选的：不传时条目
 * 保持纯展示（`<div>`），与此前行为逐字节相同；两条轨道（`copilotkit-v2-shell.tsx`/
 * `chat-read-screen.tsx`）都已经接上，传的是打开 `ChatArtifactPreviewDialog` 的回调
 * （见调用点）。可选而不是强制，是因为这是个"读时才知道"的能力位——万一未来出现
 * 一个没有产物预览权限的调用场景，不传 `onOpen` 就能诚实退回不可点，不必改这个
 * 组件本身。
 */
export function ChatArtifactsPanel({
  hasSelection, artifacts, loading, error, onRetry, onOpen,
}: {
  hasSelection: boolean;
  artifacts: ListThreadArtifactsOut | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen?: (item: ListThreadArtifactsOut["items"][number]) => void;
}) {
  return (
    <div className="flex flex-col" data-testid="chat-artifacts-panel">
      <div className="flex items-center gap-2 border-b border-border-subtle p-3">
        <Package aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-12 font-medium">产物{artifacts ? `（${artifacts.items.length}）` : ""}</h2>
      </div>
      {/* 未选线程与加载中是互斥状态，同一时刻只显一态（UI 评分 b10-entry 截图：两态并存）。
          文案不带「真实」——那是区别于 mock 的开发者词汇，不该出现在用户可见文案里。 */}
      {/* issue #2075（TW-COPY-1）—— 原文「选择线程后读取产物。」两处开发者味：
          ①「线程」是内部概念，用户看到的东西叫「对话」；② 句子说的是「系统」要做什么
          （"读取"），不是「用户」该做什么。换成用户语言 + 明确动作。 */}
      {!hasSelection ? (
        <p className="p-3 text-12 text-muted-foreground" data-testid="chat-artifacts-no-selection">
          还没有选择对话。在左侧选一条对话，这里会列出它生成的产物。
        </p>
      ) : null}
      {/* issue #2075（TW-P2-7）—— 加载态从"一行灰字"换成真骨架，理由见
          `chat-panel-skeleton.tsx` 头注（一行字既不是 skeleton 也不是占位区）。 */}
      {hasSelection && loading ? <ChatPanelSkeleton label="正在读取产物列表" /> : null}
      {error ? (
        <div className="flex flex-col items-start gap-2 p-3" data-testid="chat-artifacts-error">
          <p className="text-12 text-destructive">{error}</p>
          <Button size="xs" variant="outline" data-testid="chat-artifacts-retry" onClick={onRetry}>
            <RefreshCw aria-hidden className="h-3 w-3" />重试
          </Button>
        </div>
      ) : null}
      {artifacts ? (
        <div className="flex flex-col gap-2 p-3">
          {artifacts.items.length === 0 ? (
            <p className="text-12 text-muted-foreground" data-testid="chat-artifacts-empty">
              这条线程还没有落地的产物。
            </p>
          ) : null}
          {artifacts.items.map((item) => {
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-11 font-medium">{item.title}</p>
                  <Badge tone={item.mode === "pinned" ? "primary" : "neutral"}>{ARTIFACT_MODE_TEXT[item.mode]}</Badge>
                </div>
                <p className="mt-1 text-10 text-muted-foreground">
                  {item.hasSource ? "已挂出处" : "未挂出处"}
                  {item.version !== null ? ` · 版本 ${item.version}` : ""}
                </p>
              </>
            );
            return onOpen ? (
              <button
                key={item.artifactId}
                type="button"
                onClick={() => onOpen(item)}
                className="rounded-md border border-border-subtle p-2 text-left transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid={`chat-artifact-${item.artifactId}`}
              >
                {body}
              </button>
            ) : (
              <div
                key={item.artifactId}
                className="rounded-md border border-border-subtle p-2"
                data-testid={`chat-artifact-${item.artifactId}`}
              >
                {body}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const ARTIFACT_MODE_TEXT: Record<ListThreadArtifactsOut["items"][number]["mode"], string> = {
  draft: "草稿",
  live: "实时关联",
  pinned: "固定快照",
};
