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
import { apiUrl } from "@/lib/api-client";
import { useAuthedImageSrc } from "@/lib/use-authed-image-src";
import { formatBytes, iconKindForMime, type AttachmentIconKind } from "@/lib/chat-attachment-format";
import type { ChatAttachment } from "@/lib/live-chat";
import { ChatAttachmentSlidesPreview } from "./chat-attachment-slides-preview";

/** 四种渲染态：内联图片 / 内联 PDF / 内联 pptx / 无法内联，仅给图标+下载。 */
function previewMode(kind: AttachmentIconKind): "image" | "pdf" | "slides" | "unsupported" {
  if (kind === "image") return "image";
  if (kind === "pdf") return "pdf";
  if (kind === "slides") return "slides";
  return "unsupported";
}

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

  const contentUrl = apiUrl(`/chat/threads/${threadId}/attachments/${attachment.id}/content`);
  const { src, failed } = useAuthedImageSrc(contentUrl);
  const mode = previewMode(iconKindForMime(attachment.mime));

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
          {failed ? (
            <p className="text-13 text-muted-foreground" data-testid="chat-attachment-preview-failed">
              加载失败，请重试或直接下载。
            </p>
          ) : !src ? (
            <p className="text-13 text-muted-foreground" data-testid="chat-attachment-preview-loading">
              正在加载…
            </p>
          ) : mode === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob URL，不是可优化的远程图
            <img
              src={src} alt={attachment.filename}
              className="max-h-[60vh] max-w-full rounded-md object-contain"
              data-testid="chat-attachment-preview-image"
            />
          ) : mode === "pdf" ? (
            <iframe
              src={src} title={attachment.filename}
              className="h-[60vh] w-full rounded-md border border-border-subtle"
              data-testid="chat-attachment-preview-pdf"
            />
          ) : mode === "slides" ? (
            <ChatAttachmentSlidesPreview src={src} filename={attachment.filename} />
          ) : (
            <p className="text-13 text-muted-foreground" data-testid="chat-attachment-preview-unsupported">
              该文件类型不支持预览，请下载查看。
            </p>
          )}
        </div>
      </Modal>
    </div>,
    document.body,
  );
}
