"use client";
import * as React from "react";
import { FileText, Download } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/chat-attachment-format";
import { useProducedFileDownload } from "@/lib/use-produced-file-download";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/files/overlay";
import { ProducedFilePdfPreview } from "@/components/chat/produced-file-pdf-preview";
import type { ActiveFile } from "@/lib/agui-file-events";

/**
 * 2026-08-30 人类裁决 —— 见 `copilotkit-v2-panel.tsx` `ProducedFilesCtx` 挂载处的
 * 头注：agent 沙箱产出的可下载文件（PDF/DOCX/XLSX/PPTX……）此前用
 * `ActiveFilePanel` 单独占一个中间列展示，人类实测反馈"不要在中间加这个 column
 * 来可视化"、"下载链接要在 message 上"。这个组件就是那条裁决落地的位置：一张
 * 紧凑的横向卡片，挂在产出它的那条助手消息气泡正下方，不再需要用户去看另一栏。
 *
 * 复用 `active-file-panel.tsx` 同一套下载 URL 解析（`useProducedFileDownload`），
 * 不重写鉴权/URL 拼接逻辑——两处渲染的是同一件事的下载链接。
 */
export function ProducedFileInlineCard({ file, threadId }: { file: ActiveFile; threadId: string | null }): JSX.Element {
  const { src, failed, iconKind } = useProducedFileDownload(file, threadId);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const canPreviewImage = iconKind === "image" && src !== null && !failed;

  return (
    <>
      <div
        data-testid="chat-produced-file-inline-card"
        className={cn(
          "flex w-fit max-w-full gap-2 rounded-lg border border-border bg-card p-2",
          canPreviewImage ? "flex-col" : "items-center px-3",
        )}
      >
        {canPreviewImage ? (
          <button
            type="button"
            className="group relative overflow-hidden rounded-md bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="chat-produced-file-inline-preview-trigger"
            aria-label={`放大预览 ${file.name}`}
            onClick={() => setPreviewOpen(true)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated blob URL cannot use next/image */}
            <img
              src={src}
              alt={file.name}
              className="max-h-72 max-w-full object-contain transition-transform duration-fast group-hover:scale-[1.01]"
              data-testid="chat-produced-file-inline-image"
            />
          </button>
        ) : (
          <FileText
            aria-hidden
            className={cn("h-5 w-5 shrink-0", iconKind === "file" ? "text-muted-foreground" : "text-primary")}
          />
        )}
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-12 font-medium text-card-foreground">{file.name}</p>
            {file.bytes !== null ? (
              <p className="text-10 text-muted-foreground">{formatBytes(file.bytes)}</p>
            ) : null}
          </div>
          {failed ? (
            <span className="shrink-0 text-11 text-destructive" data-testid="chat-produced-file-inline-failed">
              下载失败
            </span>
          ) : (
            <div className="flex shrink-0 items-center gap-1.5">
              {iconKind === "pdf" && src !== null ? <ProducedFilePdfPreview file={file} src={src} /> : null}
              <Button asChild size="xs" variant="outline" disabled={src === null} className="shrink-0">
                <a
                  href={src ?? undefined}
                  download={file.name}
                  data-testid="chat-produced-file-inline-download"
                  aria-disabled={src === null}
                >
                  <Download aria-hidden className="h-3.5 w-3.5" />
                  下载
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>
      {previewOpen && canPreviewImage ? (
        <ProducedImagePreview file={file} src={src} onClose={() => setPreviewOpen(false)} />
      ) : null}
    </>
  );
}

/** Generated images use the already-authorized blob URL for both inline and enlarged views. */
function ProducedImagePreview({ file, src, onClose }: { file: ActiveFile; src: string; onClose: () => void }): JSX.Element {
  return createPortal(
    <div className="fixed inset-0 z-40" data-testid="chat-produced-file-preview-portal">
      <Modal
        testid="chat-produced-file-preview"
        title={file.name}
        subtitle={`${file.mime ?? "image"}${file.bytes !== null ? ` · ${formatBytes(file.bytes)}` : ""}`}
        onClose={onClose}
        width="lg"
        footer={
          <>
            <Button type="button" size="sm" variant="ghost" data-testid="chat-produced-file-preview-dismiss" onClick={onClose}>
              关闭
            </Button>
            <Button type="button" size="sm" variant="primary" asChild>
              <a href={src} download={file.name} data-testid="chat-produced-file-preview-download">
                <Download aria-hidden className="h-3.5 w-3.5" />
                下载
              </a>
            </Button>
          </>
        }
      >
        <div className="grid min-h-[240px] place-items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated blob URL cannot use next/image */}
          <img
            src={src}
            alt={file.name}
            className="max-h-[65vh] max-w-full rounded-md object-contain"
            data-testid="chat-produced-file-preview-image"
          />
        </div>
      </Modal>
    </div>,
    document.body,
  );
}
