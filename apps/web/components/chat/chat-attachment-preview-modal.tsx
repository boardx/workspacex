"use client";

/**
 * #1584 —— 消息气泡里点击附件条，弹窗预览 + 下载。
 *
 * 字节走 `GET /chat/threads/:threadId/attachments/:attachmentId/content`（不是契约操作，
 * 见 `chat-attachment.controller.ts` 头注）——`@CurrentPrincipal` 门控，裸 `<img src>` 发不出
 * `Authorization` 头，所以复用 `useAuthedImageSrc`（`apps/web/lib/use-authed-image-src.ts`，
 * 尽管名字带 "Image"，实现本就是任意字节通用的：手动 fetch 带 Bearer → blob →
 * `URL.createObjectURL`）——不另写第二份同类实现。
 *
 * 内联渲染三类：image（`<img>`）、pdf（`<iframe>`，浏览器原生 PDF viewer）、
 * slides/pptx（`ChatAttachmentSlidesPreview`，纯前端库 `pptx-preview` 渲染，见 #1980）。
 * 其余类型（docx/xlsx/text/...）没有可靠的离线内联渲染器，对齐既有
 * `apps/web/components/files/file-preview.tsx` 的降级约定：图标 + 文件名 + 「不支持预览，
 * 请下载查看」+ 下载按钮。下载对四类（含可预览的三类）统一走同一个 blob URL，
 * `download` 属性触发另存，不需要再发一次 `?download=1` 请求——预览已经把字节都取回来了。
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { Download } from "lucide-react";
import { Modal } from "@/components/files/overlay";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/chat-attachment-format";
import type { ChatAttachment } from "@/lib/live-chat";
import { ChatAttachmentView, type AttachmentViewHandle } from "./chat-attachment-view";

/*
 * 渲染体已搬进 `chat-attachment-view.tsx`（右栏与模态共用同一份，见该文件头注）。
 * 这里保留 re-export：既有引用方（测试与 produced-file 卡片）一个字都不用改。
 */
export { previewMode, TextAttachmentPreview } from "./chat-attachment-view";

export function ChatAttachmentPreviewModal({
  threadId, attachment, onClose,
}: {
  threadId: string;
  attachment: ChatAttachment;
  onClose: () => void;
}) {
  // 与 `ChatAttachMaterialModal` 同一处置：Modal 壳是 `absolute inset-0`，贴最近定位祖先——
  // 消息列表本身是 `relative` 容器，直接挂会被困在气泡里，需要 portal 到 body。
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const [state, setState] = React.useState<AttachmentViewHandle>({ src: null, failed: false });
  const src = state.src;

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-40" data-testid="chat-attachment-preview-portal">
      <Modal
        testid="chat-attachment-preview"
        title={attachment.filename}
        subtitle={`${attachment.mime} · ${formatBytes(attachment.bytes)}`}
        onClose={onClose}
        width="lg"
        footer={
          <>
            {/* `Modal` 自己的头部已经有一个 `${testid}-close`（图标 X）—— 这里是页脚的文字
                按钮，与共享组件 `ChatAttachMaterialModal` 的 `-cancel` 命名同一套约定，
                避免和 Modal 自带的 close 撞 testid（真实撞过一次，2026-08-19 实测）。 */}
            <Button type="button" size="sm" variant="ghost" data-testid="chat-attachment-preview-dismiss" onClick={onClose}>
              关闭
            </Button>
            <Button
              type="button" size="sm" variant="primary" asChild
              disabled={!src}
              data-testid="chat-attachment-preview-download"
            >
              {/* blob URL 本身就是完整字节，`download` 属性只是告诉浏览器另存而不是导航过去；
                  失败（src 为 null）时按钮禁用，不给一个点了没反应的死链接。 */}
              <a href={src ?? undefined} download={attachment.filename}>
                <Download aria-hidden className="h-3.5 w-3.5" />
                下载
              </a>
            </Button>
          </>
        }
      >
        <div className="grid min-h-[240px] place-items-center">
          <ChatAttachmentView
            threadId={threadId}
            attachmentId={attachment.id}
            filename={attachment.filename}
            mime={attachment.mime}
            onState={setState}
          />
        </div>
      </Modal>
    </div>,
    document.body,
  );
}
