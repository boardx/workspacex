/**
 * #946 · V9-a F150 —— 附件上传的**纯**领域校验。
 *
 * 洋葱最内层：不知道 HTTP / 对象存储 / PostgreSQL。这里只做**不需要 I/O** 的两条校验
 * （字节大小 + MIME 白名单）；需要 I/O 的两条（该线程 pending 计数、actor 写权）在
 * application 层做（见 upload-attachment 用例）。
 *
 * ⚠ 数值上限的唯一事实源是契约 `chat-file-upload.ts` 的 `ATTACHMENT_LIMITS` /
 * `ATTACHMENT_MIME_ALLOWLIST`——本文件从契约读，**不复述数值**（ADR-020 / 本仓「同一事实
 * 两处声明」教训）。
 *
 * ⚠ 传入的 `bytes`/`mime` 必须是**服务端核验后**的权威值，不是客户端声明值——校验伪造
 * （声明 mime 与实际字节格式不符）在调用方核验，这里只按已核验值比对白名单。
 */
import { chatFileUpload as CFU } from "@repo/contracts";

/** 本纯校验能给出的两个失败码（`ChatAttachmentError` 的子集）。 */
export type AttachmentBytesTypeError = "FILE_TOO_LARGE" | "FILE_TYPE_REJECTED";

/** 该线程可挂的 pending 附件数上限（数量校验用；值来自契约）。 */
export const ATTACHMENT_PENDING_LIMIT = CFU.ATTACHMENT_LIMITS.maxAttachmentsPerMessage;

/** 单文件字节上限（值来自契约）。 */
export const ATTACHMENT_MAX_BYTES = CFU.ATTACHMENT_LIMITS.maxBytesPerFile;

/**
 * 纯校验字节大小 + MIME 白名单。通过 → null；否则 → 具体失败码。
 */
export function checkAttachmentBytesAndType(input: {
  readonly bytes: number;
  readonly mime: string;
}): AttachmentBytesTypeError | null {
  if (!Number.isFinite(input.bytes) || input.bytes < 0) return "FILE_TYPE_REJECTED";
  if (input.bytes > ATTACHMENT_MAX_BYTES) return "FILE_TOO_LARGE";
  if (!(CFU.ATTACHMENT_MIME_ALLOWLIST as readonly string[]).includes(input.mime)) {
    return "FILE_TYPE_REJECTED";
  }
  return null;
}

/**
 * 数量校验：该线程当前 pending（未挂消息）附件数 `pendingCount` 再加本次一个是否越限。
 * 越限 → `"ATTACHMENT_LIMIT_EXCEEDED"`；否则 null。`pendingCount` 由 application 层从库里数。
 */
export function checkAttachmentCount(pendingCount: number): "ATTACHMENT_LIMIT_EXCEEDED" | null {
  return pendingCount >= ATTACHMENT_PENDING_LIMIT ? "ATTACHMENT_LIMIT_EXCEEDED" : null;
}
