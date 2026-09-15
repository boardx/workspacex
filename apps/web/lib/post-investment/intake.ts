/**
 * 材料包接收：浏览器侧校验 + 哈希（不做本地内容解析）。逐字复用 `lib/ic-review/intake.ts`
 * 的架构与理由（同一份头注适用，这里不重复）——PDF/DOCX/XLSX/PPTX 交给真实附件上传 +
 * 服务端 `wx_document_parse`，本文件只挡后端一定会拒的文件并给可读原因、算哈希供出处引用。
 * 不直接 import 那个模块：两个 Agent 各自独立、互不依赖，任何一个要删都不牵连另一个。
 */
import { chatFileUpload } from "@repo/contracts";
import type { ReportDocument, UnparsedFile } from "./types";

const { ATTACHMENT_LIMITS, ATTACHMENT_MIME_ALLOWLIST } = chatFileUpload;

const EXTENSION_MIME: Record<string, (typeof ATTACHMENT_MIME_ALLOWLIST)[number]> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown", markdown: "text/markdown",
  csv: "text/csv",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export interface IntakeResult {
  readonly accepted: File[];
  readonly unparsed: UnparsedFile[];
}

export async function sha256Hex(bytes: ArrayBuffer | string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  const buf = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  if (!subtle) return "sha256-unavailable".padEnd(64, "0").slice(0, 64);
  const digest = await subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extensionOf(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}

function precheckReason(file: File): string | null {
  const ext = extensionOf(file.name);
  if (!(ext in EXTENSION_MIME)) {
    return `扩展名 .${ext || "?"} 不在允许上传的格式内（支持 PDF / DOCX / XLSX / PPTX / txt / md / csv / 图片 / 音频）`;
  }
  if (file.size > ATTACHMENT_LIMITS.maxBytesPerFile) {
    return `超过单文件 ${(ATTACHMENT_LIMITS.maxBytesPerFile / 1024 / 1024).toFixed(0)}MB 上限（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`;
  }
  return null;
}

export async function intakeFiles(files: readonly File[]): Promise<IntakeResult> {
  const accepted: File[] = [];
  const unparsed: UnparsedFile[] = [];
  for (const file of files) {
    const reason = precheckReason(file);
    if (reason) {
      unparsed.push({ name: file.name, bytes: file.size, reason });
      continue;
    }
    accepted.push(file);
  }
  if (accepted.length > ATTACHMENT_LIMITS.maxAttachmentsPerMessage) {
    const overflow = accepted.splice(ATTACHMENT_LIMITS.maxAttachmentsPerMessage);
    for (const file of overflow) {
      unparsed.push({ name: file.name, bytes: file.size, reason: `单次分析最多 ${ATTACHMENT_LIMITS.maxAttachmentsPerMessage} 份材料，本文件超出这个数量` });
    }
  }
  return { accepted, unparsed };
}

/** 示例材料包（纯文本，测试方案 A/B/C）专用——不经过 intakeFiles 的真实上传预检。 */
export async function intakeTexts(files: readonly { name: string; text: string }[]): Promise<ReportDocument[]> {
  return Promise.all(files.map(async (f, index) => ({
    id: `fixture-${index}-${f.name}`, name: f.name, text: f.text, sha256: await sha256Hex(f.text), bytes: new TextEncoder().encode(f.text).length,
  })));
}
