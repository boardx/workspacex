"use client";
import * as React from "react";
import { FileText, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/chat-attachment-format";
import { useProducedFileDownload } from "@/lib/use-produced-file-download";
import { Button } from "@/components/ui/button";
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

  return (
    <div
      data-testid="chat-produced-file-inline-card"
      className="flex w-fit max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
    >
      <FileText
        aria-hidden
        className={cn("h-5 w-5 shrink-0", iconKind === "file" ? "text-muted-foreground" : "text-primary")}
      />
      <div className="min-w-0">
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
      )}
    </div>
  );
}
