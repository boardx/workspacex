"use client";

import * as React from "react";
import { FileImage, FileSpreadsheet, FileText, File as FileIcon, Presentation, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, iconKindForMime, type AttachmentIconKind } from "@/lib/chat-attachment-format";
import { ChatAttachmentPreviewModal } from "@/components/chat/chat-attachment-preview-modal";
import { ChatSidebarUploadButton, type ChatAttachmentsController } from "@/components/chat/chat-composer-attachments";
import type { ChatAttachment, ListThreadAttachmentsOut } from "@/lib/live-chat";

/**
 * issue #728 D9（右侧栏，人类 2026-08-21 裁决选项 A）—— 真实「材料」列表。
 *
 * 原型期五标签设计（转录/执行/洞察/产物/材料）里，「转录」控件本来就不在右侧栏
 * （挂在消息面板上方的 `ChatRecordingPanel`，D9 裁决明确不搬）；「执行/洞察」两个
 * 在后端**没有任何真实数据支撑**（`get-thread.ts` 的 `rightTabs()` 硬编码为 0），
 * 本轮不做，待后端建模。这里只做「材料」这一项——数据来自真实 `chat_message_attachments`
 * 表（`listThreadAttachments`，`GET /chat/threads/:threadId/attachments`），与「产物」
 * （`ChatArtifactsPanel`）拼成两个真标签，同一份右侧栏 `Tabs`。
 *
 * 只列**已挂到消息**的附件（`message_id IS NOT NULL`）——composer 里还没随消息发出的
 * pending 附件不算材料，那是草稿态。点击一条材料复用 `ChatAttachmentPreviewModal`
 * （#1584 已有组件，消息气泡里点附件同一个弹窗），不另写第二份预览实现。
 *
 * ## 头部「+」上传入口（issue #1758，人类给参考截图后裁决 C）
 * 点了之后走的是**同一个** composer 的 `ChatAttachmentsController.pickFiles`（同一次真实
 * `uploadAttachment` 调用），效果是"加进 composer 的 pending 队列"——不自动发消息、不触发
 * agent run。上传后文件出现在输入框下方的 composer 附件区，不会立刻出现在这个材料列表里
 * （见 `ChatSidebarUploadButton` 头注的架构调查）。`uploadCtl` 为 `null`（未登录/没有真实
 * bearer）时不渲染上传入口——没有可用的上传通道，渲染一个点了必炸的按钮比不渲染还坏。
 */
export function ChatMaterialsPanel({
  hasSelection, threadId, materials, loading, error, onRetry, uploadCtl,
}: {
  hasSelection: boolean;
  threadId: string | null;
  materials: ListThreadAttachmentsOut | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** issue #1758 —— composer 与右栏共享的同一份附件控制器；`null` 表示当前没有可用的上传通道。 */
  uploadCtl: ChatAttachmentsController | null;
}) {
  const [previewing, setPreviewing] = React.useState<ChatAttachment | null>(null);
  return (
    <div className="flex flex-col" data-testid="chat-materials-panel">
      <div className="flex items-center gap-2 border-b border-border-subtle p-3">
        <FileText aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="flex-1 text-12 font-medium">材料{materials ? `（${materials.items.length}）` : ""}</h2>
        {uploadCtl ? <ChatSidebarUploadButton ctl={uploadCtl} disabled={!hasSelection} /> : null}
      </div>
      {uploadCtl ? (
        <p className="px-3 pt-2 text-10 text-muted-foreground">
          上传的文件会加入下一条消息的附件，发送后才会出现在这个列表里。
        </p>
      ) : null}
      {/* 未选线程与加载中是互斥状态，同一时刻只显一态（UI 评分 b10-entry 截图：两态并存）。
          文案不带「真实」——那是区别于 mock 的开发者词汇，不该出现在用户可见文案里。 */}
      {!hasSelection ? <p className="p-3 text-12 text-muted-foreground">选择线程后读取材料。</p> : null}
      {hasSelection && loading ? <p className="p-3 text-12 text-muted-foreground">正在读取材料列表…</p> : null}
      {error ? (
        <div className="flex flex-col items-start gap-2 p-3" data-testid="chat-materials-error">
          <p className="text-12 text-destructive">{error}</p>
          <Button size="xs" variant="outline" data-testid="chat-materials-retry" onClick={onRetry}>
            <RefreshCw aria-hidden className="h-3 w-3" />重试
          </Button>
        </div>
      ) : null}
      {materials ? (
        <div className="flex flex-col gap-2 p-3">
          {materials.items.length === 0 ? (
            <p className="text-12 text-muted-foreground" data-testid="chat-materials-empty">
              这条线程还没有随消息发出的材料。
            </p>
          ) : null}
          {materials.items.map((item) => {
            const Icon = TYPE_ICON[iconKindForMime(item.mime)];
            return (
              <button
                key={item.id}
                type="button"
                className="flex items-center gap-2 rounded-md border border-border-subtle p-2 text-left transition-colors duration-200 hover:border-primary/50"
                data-testid={`chat-material-${item.id}`}
                onClick={() => setPreviewing(item)}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-11 font-medium" title={item.filename}>
                  {item.filename}
                </span>
                <span className="shrink-0 text-10 text-muted-foreground">{formatBytes(item.bytes)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {previewing && threadId ? (
        <ChatAttachmentPreviewModal
          threadId={threadId}
          attachment={previewing}
          onClose={() => setPreviewing(null)}
        />
      ) : null}
    </div>
  );
}

const TYPE_ICON: Record<AttachmentIconKind, LucideIcon> = {
  pdf: FileText, doc: FileText, sheet: FileSpreadsheet, slides: Presentation,
  image: FileImage, text: FileText, file: FileIcon,
};
