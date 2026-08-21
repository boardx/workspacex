"use client";

import * as React from "react";
import { Package, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
 */
export function ChatArtifactsPanel({
  hasSelection, artifacts, loading, error, onRetry,
}: {
  hasSelection: boolean;
  artifacts: ListThreadArtifactsOut | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col" data-testid="chat-artifacts-panel">
      <div className="flex items-center gap-2 border-b border-border-subtle p-3">
        <Package aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-12 font-medium">产物{artifacts ? `（${artifacts.items.length}）` : ""}</h2>
      </div>
      {!hasSelection ? <p className="p-3 text-12 text-muted-foreground">选择线程后读取产物。</p> : null}
      {loading ? <p className="p-3 text-12 text-muted-foreground">正在读取真实产物列表…</p> : null}
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
          {artifacts.items.map((item) => (
            <div
              key={item.artifactId}
              className="rounded-md border border-border-subtle p-2"
              data-testid={`chat-artifact-${item.artifactId}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-11 font-medium">{item.title}</p>
                <Badge tone={item.mode === "pinned" ? "primary" : "neutral"}>{ARTIFACT_MODE_TEXT[item.mode]}</Badge>
              </div>
              <p className="mt-1 text-10 text-muted-foreground">
                {item.hasSource ? "已挂出处" : "未挂出处"}
                {item.version !== null ? ` · 版本 ${item.version}` : ""}
              </p>
            </div>
          ))}
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
