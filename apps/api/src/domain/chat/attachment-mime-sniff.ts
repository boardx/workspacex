/**
 * #946 · V9-a F150 —— 附件 MIME 的**服务端字节校验**（纯领域，无 I/O）。
 *
 * coord-main 裁决 A（multer）附带的第 4 条：**mime 校验以服务端字节为权威**，multer 的
 * `fileFilter`（读 `file.mimetype`，那是客户端声明）只做第一道粗筛。这里就是那道权威校验：
 * 拿实际字节的 magic number 归一到一个「族」，再看它与**声明的 MIME** 是否同族；不同族 =
 * 契约错误码 `MIME_MISMATCH`（伪造扩展名/改 Content-Type 骗过白名单的攻击面）。
 *
 * ⚠ 只覆盖契约白名单里的类型（`ATTACHMENT_MIME_ALLOWLIST`）。白名单外的 MIME 由
 * `checkAttachmentBytesAndType` 先判 `FILE_TYPE_REJECTED`，轮不到这里；本函数对未知 MIME
 * 一律返回 false（保守），不给「声明了一个我不认识的类型」开后门。
 *
 * ⚠ docx/xlsx/pptx 三者都是 ZIP 容器（`PK\x03\x04`），magic number 层面无法互相区分——
 * 这是 OOXML 的物理事实，不是本函数的缺陷。所以它们归一到同一个 `"zip"` 族：声明 docx 传了
 * 一个真 ZIP（哪怕内部其实是 xlsx）判**通过**——字节校验的职责是「挡住把 .exe 改名成 .docx」，
 * 不是「校验 OOXML 内部部件」。后者是 V9-b anydoc 解析时才会碰到的事，且失败有独立错误码。
 */

/** 契约白名单每个 MIME 归属的「字节族」。同族 = 字节与声明一致。 */
type MimeFamily = "pdf" | "png" | "jpeg" | "webp" | "zip" | "text";

const MIME_TO_FAMILY: Readonly<Record<string, MimeFamily>> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "zip",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "zip",
};

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

/**
 * 采样前若干字节判「是否像 UTF-8 文本」：出现 NUL(0x00) 即判非文本。
 * 白名单里的文本类型（txt/md/csv）是 UTF-8，正常不含 NUL；二进制文件几乎必然在前几 KB 命中 NUL。
 * 这是启发式，故意保守：真文本极少误杀，二进制冒充文本极难绕过。空文件视为文本（空 csv 合法）。
 */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = Math.min(bytes.length, 8192);
  for (let i = 0; i < sample; i++) {
    if (bytes[i] === 0x00) return false;
  }
  return true;
}

/** 从实际字节的 magic number 归一到族；都不匹配且像文本 → text；否则 → null（未知二进制）。 */
export function sniffMimeFamily(bytes: Uint8Array): MimeFamily | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  // WEBP = RIFF....WEBP（字节 0-3 "RIFF"，字节 8-11 "WEBP"）
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "webp";
  }
  // ZIP 局部文件头（OOXML docx/xlsx/pptx 都是这个）
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (looksLikeText(bytes)) return "text";
  return null;
}

/**
 * 声明的 MIME 与实际字节是否同族。同族 → true（通过）；否则 → false（`MIME_MISMATCH`）。
 * 声明的 MIME 不在白名单映射内 → false（保守；这类应先被白名单校验拦掉）。
 */
export function declaredMimeMatchesBytes(declaredMime: string, bytes: Uint8Array): boolean {
  const expected = MIME_TO_FAMILY[declaredMime];
  if (expected === undefined) return false;
  return sniffMimeFamily(bytes) === expected;
}
