/**
 * #946 · V9-a —— 附件 UI 的**纯展示助手**（无 mock、无签核数值、无 I/O）。
 *
 * 活路由 composer（`chat-composer-attachments.tsx`）与签核原型（`chat-file-upload-preview.tsx`）
 * 都从这里取展示逻辑，避免第三份副本。**签核数值**（25MB / 10 / 白名单）不在这里——它们的
 * 唯一事实源是契约 `chat-file-upload.ts` 的 `ATTACHMENT_LIMITS` / `ATTACHMENT_MIME_ALLOWLIST`
 * （前端经 `live-chat.ts` 的再导出取用）。这里只放「怎么显示」，不放「限多少」。
 */
import { ATTACHMENT_MIME_ALLOWLIST } from "./live-chat";

/** 人读文件大小，1024 进制，最多一位小数。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${round1(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${round1(mb)} MB`;
  return `${round1(mb / 1024)} GB`;
}
function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** MIME → 类型图标族（组件按此选 lucide 图标；不认识的回落到通用文件图标）。 */
export type AttachmentIconKind = "pdf" | "doc" | "sheet" | "slides" | "image" | "text" | "file";

export function iconKindForMime(mime: string): AttachmentIconKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("wordprocessingml")) return "doc";
  if (mime.includes("spreadsheetml") || mime === "text/csv") return "sheet";
  if (mime.includes("presentationml")) return "slides";
  if (mime.startsWith("image/")) return "image";
  if (mime === "text/plain" || mime === "text/markdown") return "text";
  return "file";
}

/** MIME → 人读短标签（报错文案「支持：PDF、DOCX、…」用）。不认识的回落到 MIME 尾段。 */
const MIME_LABEL: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "text/plain": "TXT",
  "text/markdown": "Markdown",
  "text/csv": "CSV",
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/webp": "WEBP",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
};

export function mimeLabel(mime: string): string {
  return MIME_LABEL[mime] ?? mime.split("/").pop() ?? mime;
}

/** 白名单人读串（从契约 allowlist 派生，不手写第二份），供「支持：…」文案直接拼。 */
export const WHITELIST_LABELS: string =
  (ATTACHMENT_MIME_ALLOWLIST as readonly string[]).map(mimeLabel).join("、");
