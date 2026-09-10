"use client";

import * as React from "react";
import { FileImage, FileSpreadsheet, FileText, File as FileIcon, Presentation, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, iconKindForMime, type AttachmentIconKind } from "@/lib/chat-attachment-format";
import { ChatAttachmentPreviewModal } from "@/components/chat/chat-attachment-preview-modal";
import { ChatPanelSkeleton } from "@/components/chat/chat-panel-skeleton";
import { ChatAttachmentBanner, ChatSidebarUploadButton, type ChatMaterialsUploadPort } from "@/components/chat/chat-composer-attachments";
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
 *
 * ## issue #3347 —— 拖拽上传与「为什么没有入口」
 * 拖拽的**落区不在本组件**：整条右栏（`ChatTaskInspector` 根节点）都接住 drop，
 * 落在别的页签上也算数（并自动切到本页签）。本组件只负责把结果说清楚：
 *   · `uploadNotice` —— 拖进来的不是文件（纯文本 / 链接 / 文件夹）时的说明。落区那侧
 *     判定，这里只渲染。**不能静默**：用户做了动作，系统必须回话（#3311 / #3317 同族）。
 *   · `uploadCtl.banner` —— 超大 / 类型不支持 / 超过每条消息上限，来自控制器**同一份**
 *     banner 状态（composer 那边渲染的是同一个事实，不是这里另算一遍）。
 *   · `readOnlyReason` —— 只读 / 归档时入口**渲染但禁用并写出理由**，不是悄悄消失。
 *     理由与 composer 底部那行同源（`canWrite`/`archived`，见
 *     `copilotkit-v2-panel-body.tsx` 的 `sendDisabledReason`）；上传的服务端授权本来
 *     就由 `composer.send` 能力把关（越权返回 `NO_WRITE_ROLE`），本入口不新增任何
 *     服务端能力，也没有第二套存储：拖进来的文件与 📎 选的文件是同一条 pending 队列
 *     （`chat_message_attachments` 里 `message_id IS NULL` 的同一批行）。
 */
export function ChatMaterialsPanel({
  hasSelection, threadId, materials, loading, error, onRetry, uploadCtl,
  uploadNotice = null, readOnlyReason = null, pendingCount = 0, dropActive = false,
}: {
  hasSelection: boolean;
  threadId: string | null;
  materials: ListThreadAttachmentsOut | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** issue #1758 —— composer 与右栏共享的同一份上传能力；`null` 表示当前没有可用的上传通道。 */
  uploadCtl: ChatMaterialsUploadPort | null;
  /** issue #3347 —— 落区判定出的「这不是文件」等说明；`null` = 无话可说。 */
  uploadNotice?: string | null;
  /** issue #3347 —— 只读/归档时的禁用理由；非 `null` 时入口渲染但禁用并写出理由。 */
  readOnlyReason?: string | null;
  /** issue #3347 —— 已上传、还没随消息发出的附件数（同 composer 那一份，不另算）。 */
  pendingCount?: number;
  /** issue #3347 —— 整条右栏正在被拖拽悬停（落区在 `ChatTaskInspector` 根节点）。 */
  dropActive?: boolean;
}) {
  const [previewing, setPreviewing] = React.useState<ChatAttachment | null>(null);
  return (
    <div className="flex flex-col" data-testid="chat-materials-panel" data-drop-active={dropActive ? "true" : "false"}>
      <div className="flex items-center gap-2 border-b border-border-subtle p-3">
        <FileText aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="flex-1 text-12 font-medium">材料{materials ? `（${materials.items.length}）` : ""}</h2>
        {uploadCtl ? (
          <ChatSidebarUploadButton ctl={uploadCtl} disabled={!hasSelection || readOnlyReason !== null} />
        ) : null}
      </div>
      {uploadCtl ? (
        <p className="px-3 pt-2 text-10 text-muted-foreground" data-testid="chat-materials-upload-hint">
          {readOnlyReason ?? "点「+」选文件，或把文件拖到这一栏。上传的文件会加入下一条消息的附件，发送后才会出现在这个列表里。"}
        </p>
      ) : null}
      {/* issue #3347 —— 拖进来后「有没有生效」必须看得见。`pendingCount` 是 composer
          那份 `uploadedIds.length`（同一事实，经外壳原样转发），不是这里重新数一遍。 */}
      {pendingCount > 0 ? (
        <p className="px-3 pt-2 text-10 text-muted-foreground" data-testid="chat-materials-pending-count">
          已加入下一条消息的附件：{pendingCount} 个（发送后进入下面的列表）
        </p>
      ) : null}
      {uploadNotice ? (
        <p
          className="mx-3 mt-2 rounded-md border border-border-subtle bg-muted px-2.5 py-2 text-11"
          role="status"
          data-testid="chat-materials-upload-notice"
        >
          {uploadNotice}
        </p>
      ) : null}
      {uploadCtl ? (
        <div className="px-3 pt-2 empty:hidden">
          <ChatAttachmentBanner banner={uploadCtl.banner} testId="chat-materials-upload-error" />
        </div>
      ) : null}
      {/* 未选线程与加载中是互斥状态，同一时刻只显一态（UI 评分 b10-entry 截图：两态并存）。
          文案不带「真实」——那是区别于 mock 的开发者词汇，不该出现在用户可见文案里。 */}
      {/* issue #2075（TW-COPY-1）—— 与 `chat-artifacts-panel.tsx` 同一处修法、同一条理由：
          「线程」换成用户语言「对话」，句子说的是用户该做的动作，不是系统要做的事。 */}
      {!hasSelection ? (
        <p className="p-3 text-12 text-muted-foreground" data-testid="chat-materials-no-selection">
          还没有选择对话。在左侧选一条对话，这里会列出随消息发出的文件。
        </p>
      ) : null}
      {/* issue #2075（TW-P2-7）—— 同 `chat-artifacts-panel.tsx`：加载态换成真骨架。 */}
      {hasSelection && loading ? <ChatPanelSkeleton label="正在读取材料列表" /> : null}
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
                className="flex items-center gap-2 rounded-md border border-border-subtle p-2 text-left transition-colors duration-base hover:border-primary/50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
