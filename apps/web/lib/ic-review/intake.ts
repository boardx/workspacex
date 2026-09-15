/**
 * 材料包接收：浏览器侧校验 + 哈希（不做本地内容解析）。
 *
 * v3 架构（复用真实 chat）下，材料不在浏览器里解析——PDF/DOCX/XLSX/PPTX 这些格式
 * 交给真实附件上传 + 服务端 `wx_document_parse` 处理，本文件只做两件事：
 * ① 挡掉后端一定会拒的文件（类型不在白名单 / 超过大小上限），给出可读原因，
 *    不静默丢弃；② 算哈希，供出处/留痕引用。
 *
 * ⚠ 白名单/大小上限的单一事实源是 `chatFileUpload.ATTACHMENT_MIME_ALLOWLIST` /
 * `ATTACHMENT_LIMITS`（已签核，见 `packages/contracts/src/chat-file-upload.ts`），
 * 这里只是按扩展名做一次**客户端预检**（早一点给用户反馈），不是权威判定——
 * 服务端按真实字节内容核验 MIME 才是权威（防伪造扩展名），预检拦不住的交给上传
 * 接口的错误信封处理。
 *
 * ⚠ 早期版本（本地正则引擎时代）会把每个文件读成文本、再从文本重建 File 对象——
 * 对 PDF/DOCX 这类二进制格式，`file.text()` 会把字节按 UTF-8 硬解、破坏原始内容，
 * 重建出来的「File」已经不是一份能被后端正确解析的 PDF 了。v3 不再需要本地读文本
 * （不做本地分析），所以这里直接透传原始 `File` 对象，不经过文本往返。
 */
import { chatFileUpload } from "@repo/contracts";
import type { ReviewDocument, UnparsedFile } from "./types";

const { ATTACHMENT_LIMITS, ATTACHMENT_MIME_ALLOWLIST } = chatFileUpload;

/** 扩展名 → 白名单 MIME 的客户端预检映射；权威仍是服务端按字节核验。 */
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
  /** 通过预检、可以直接上传的原始文件（未做任何转换）。 */
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
      unparsed.push({ name: file.name, bytes: file.size, reason: `单次审阅最多 ${ATTACHMENT_LIMITS.maxAttachmentsPerMessage} 份材料，本文件超出这个数量` });
    }
  }
  return { accepted, unparsed };
}

/** 示例材料包（纯文本，合成数据）专用——不经过 intakeFiles 的真实上传预检。 */
export async function intakeTexts(files: readonly { name: string; text: string }[]): Promise<ReviewDocument[]> {
  return Promise.all(files.map(async (f, index) => ({
    id: `fixture-${index}-${f.name}`, name: f.name, text: f.text, sha256: await sha256Hex(f.text), bytes: new TextEncoder().encode(f.text).length,
  })));
}
