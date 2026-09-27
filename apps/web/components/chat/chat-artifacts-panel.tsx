"use client";

import * as React from "react";
import { Package, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatPanelSkeleton } from "@/components/chat/chat-panel-skeleton";
import { stripCanvasFenceIdentity } from "@/lib/canvas/canvas-fence-identity";
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
  hasSelection, artifacts, loading, error, onRetry, onOpen, versions, versionsCount, onRefresh,
}: {
  hasSelection: boolean;
  artifacts: ListThreadArtifactsOut | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen?: (item: ListThreadArtifactsOut["items"][number]) => void;
  /**
   * 2026-09-27 人类反馈「右边的 panel 需要改进 UIUX」—— 任务检查器的「产物」页签里，此前
   * 是两块各自为政的面板上下叠放：`AgentArtifactVersionsPanel`（任务生成的文件 + 版本）
   * 一个标题、一个刷新、一句空态；本面板又一个标题、一句空态——同一个"还没有产物"
   * 说两遍，还用了内部词「线程」。传入 `versions` 时，两者合成一块：一个标题（总数）、
   * 一个刷新、一个空态；版本面板只画自己的内容（`embedded`）。不传时行为不变。
   */
  versions?: React.ReactNode;
  /** `versions` 里的条目数；`null` = 还在读，此时不下"没有产物"的结论。 */
  versionsCount?: number | null;
  onRefresh?: () => void;
}) {
  const unified = versions !== undefined;
  const listCount = artifacts?.items.length ?? null;
  const total = unified
    ? (listCount === null || versionsCount == null ? null : listCount + versionsCount)
    : listCount;
  const showEmpty = artifacts !== null && artifacts.items.length === 0 && (!unified || versionsCount === 0);
  return (
    <div className="flex flex-col" data-testid="chat-artifacts-panel">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <Package aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 text-12 font-medium" data-testid="chat-artifacts-panel-title">
          {unified ? "产物" : "产物预览"}{total !== null ? `（${total}）` : ""}
        </h2>
        {onRefresh ? (
          <Button size="xs" variant="ghost" className="w-6 px-0" aria-label="刷新产物与修改进度" title="刷新" data-testid="chat-artifacts-refresh" onClick={onRefresh}>
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      {unified ? <div className="p-3 empty:hidden">{versions}</div> : null}
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
      {/* 统一外壳下：列表为空、空态又不该出现（任务文件在上面）时整块不画，不留一截空白内边距。 */}
      {artifacts && (!unified || artifacts.items.length > 0 || showEmpty) ? (
        <div className={`flex flex-col gap-2 ${unified && versionsCount ? "px-3 pb-3" : "p-3"}`} data-testid="chat-artifacts-list">
          {showEmpty ? (
            <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center" data-testid="chat-artifacts-empty">
              <Package aria-hidden className="h-5 w-5 text-muted-foreground" />
              <p className="text-12 font-medium text-card-foreground">这条对话还没有产物</p>
              <p className="max-w-64 text-11 text-muted-foreground">
                任务生成的报告、PPT、表格等文件会出现在这里，可预览、下载，并基于历史版本继续修改。
              </p>
            </div>
          ) : null}
          {artifacts.items.map((item) => {
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  {/* 画布落地标题末尾带一段围栏身份（issue #3252）——那是读回归属用的
                      内部关联键，不该出现在用户看的产物清单里。非画布产物原样显示。 */}
                  <p className="min-w-0 flex-1 truncate text-11 font-medium">
                    {stripCanvasFenceIdentity(item.title)}
                  </p>
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
