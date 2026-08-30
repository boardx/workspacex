"use client";
import { parseVfsUriString } from "@repo/contracts/agui-state-events";
import { apiUrl } from "@/lib/api-client";
import { useAuthedImageSrc } from "@/lib/use-authed-image-src";
import { iconKindForMime, type AttachmentIconKind } from "@/lib/chat-attachment-format";
import type { ActiveFile } from "@/lib/agui-file-events";

/**
 * 2026-08-30 —— agent 沙箱产出（`source: "agent_run_output"`）文件的下载 URL 解析，
 * 从 `active-file-panel.tsx` 的 `ProducedFileDownloadCard` 抽出来，供它自己与
 * `produced-file-inline-card.tsx`（人类裁决：这类文件的下载入口挂到消息气泡下面，
 * 不再单独占一个中间列）共用——两处渲染同一件事的下载链接，不该各自维护一份
 * `parseVfsUriString`/`apiUrl` 拼接逻辑（本仓"同一事实两处声明"的既有教训）。
 *
 * `threadId`/`attachmentId` 任一缺失时 `downloadUrl` 是 `null`，`useAuthedImageSrc`
 * 对 `null` 什么都不拉（它自己的实现）——安全地停在"按钮禁用"态，不会拼一个指向
 * 不存在资源的请求。
 */
export function useProducedFileDownload(file: ActiveFile, threadId: string | null): {
  readonly src: string | null;
  readonly failed: boolean;
  readonly iconKind: AttachmentIconKind;
} {
  const parsed = parseVfsUriString(file.uri);
  const attachmentId = parsed?.domain === "attachment" ? parsed.id : null;
  const downloadUrl = threadId !== null && attachmentId !== null
    ? apiUrl(`/chat/threads/${threadId}/attachments/${attachmentId}/content`)
    : null;
  const { src, failed } = useAuthedImageSrc(downloadUrl);
  const iconKind: AttachmentIconKind = file.mime !== null ? iconKindForMime(file.mime) : "file";
  return { src, failed, iconKind };
}
