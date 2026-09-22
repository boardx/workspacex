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
type MimeFamily = "pdf" | "png" | "jpeg" | "webp" | "zip" | "text" | "wav" | "mp3";

const MIME_TO_FAMILY: Readonly<Record<string, MimeFamily>> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
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

/** 非法 UTF-8 之外，还要挡住「合法 UTF-8 但明显不是给人读的」载荷的控制字节占比上限。 */
const MAX_CONTROL_RATIO = 0.02;

/**
 * 某个多字节序列的首个续字节的合法区间（其余续字节一律 0x80-0xBF）。
 * 返回 null = 这个前导字节根本不合法（0x80-0xC1 落单/过长前缀、0xF5-0xFF 码点越界）。
 */
function sequenceSpec(lead: number): { length: number; firstMin: number; firstMax: number } | null {
  if (lead >= 0xc2 && lead <= 0xdf) return { length: 2, firstMin: 0x80, firstMax: 0xbf };
  if (lead === 0xe0) return { length: 3, firstMin: 0xa0, firstMax: 0xbf }; // 排除过长编码
  if (lead === 0xed) return { length: 3, firstMin: 0x80, firstMax: 0x9f }; // 排除 UTF-16 代理区
  if (lead >= 0xe1 && lead <= 0xef) return { length: 3, firstMin: 0x80, firstMax: 0xbf };
  if (lead === 0xf0) return { length: 4, firstMin: 0x90, firstMax: 0xbf }; // 排除过长编码
  if (lead === 0xf4) return { length: 4, firstMin: 0x80, firstMax: 0x8f }; // 上限 U+10FFFF
  if (lead >= 0xf1 && lead <= 0xf3) return { length: 4, firstMin: 0x80, firstMax: 0xbf };
  return null;
}

/**
 * 采样前若干字节判「是否是 UTF-8 文本」——**fail-closed**：不能证明是文本的，一律不是文本。
 *
 * ⚠ #964（PR #961 事后取证）：本函数原先只判 NUL(0x00)，于是「不含 NUL 的任意字节」
 * 都被当成文本收下——gzip 魔数 `1F 8B 08`、落单的续字节 `80 80 80`、过长编码 `C0 AF`、
 * UTF-16 代理区 `ED A0 80` 全部判 text，攻击者把二进制改 Content-Type 成 text/plain 即可
 * 绕过字节校验。那是 fail-open：判不出来就放行。现在改成真的按 UTF-8 语法逐序列校验，
 * 任何一处不合法即判非文本；白名单里的 txt/md/csv 本来就要求是 UTF-8，合法文本不受影响。
 *
 * 另外挡一类「合法 UTF-8 但不是文本」的载荷：C0 控制字符（TAB/LF/CR 除外）与 DEL 占比超过
 * `MAX_CONTROL_RATIO` 即判非文本。
 *
 * 采样窗口（8 KiB）可能把一个多字节序列拦腰切断：这时**不**判非法（否则合法长文本会被误杀），
 * 但若缓冲区本身就在序列中间结束，那就是货真价实的非法 UTF-8，判非文本。
 * 空文件仍视为文本（空 csv 合法）。
 */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = Math.min(bytes.length, 8192);
  const windowTruncated = bytes.length > sample;
  let controls = 0;
  let i = 0;

  while (i < sample) {
    const lead = bytes[i]!;
    if (lead === 0x00) return false; // NUL 永远不是文本
    if (lead < 0x80) {
      const isPlainControl = lead < 0x20 && lead !== 0x09 && lead !== 0x0a && lead !== 0x0d;
      if (isPlainControl || lead === 0x7f) controls++;
      i++;
      continue;
    }

    const spec = sequenceSpec(lead);
    if (spec === null) return false;
    if (i + spec.length > sample) {
      // 序列跨过采样窗口尾部：是窗口切的就放过，是文件本身断的就判非法。
      return windowTruncated ? controls / sample < MAX_CONTROL_RATIO : false;
    }
    const first = bytes[i + 1]!;
    if (first < spec.firstMin || first > spec.firstMax) return false;
    for (let k = 2; k < spec.length; k++) {
      const cont = bytes[i + k]!;
      if (cont < 0x80 || cont > 0xbf) return false;
    }
    i += spec.length;
  }

  return sample === 0 || controls / sample < MAX_CONTROL_RATIO;
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
  // WAV = RIFF....WAVE. Full PCM/container validation belongs to the sandbox decoder.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x41, 0x56, 0x45], 8)) return "wav";
  // ID3 or MPEG audio frame sync (nonzero layer distinguishes ADTS AAC).
  if(startsWith(bytes,[0x49,0x44,0x33])||(bytes.length>=4&&bytes[0]===0xff&&(bytes[1]!&0xe0)===0xe0&&(bytes[1]!&0x06)!==0))return "mp3";
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
