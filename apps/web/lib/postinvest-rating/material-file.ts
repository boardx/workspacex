/**
 * 上传材料的回显信息（R3-2：文件名 / 大小 / SHA256 / 识别到的类型）。
 *
 * SHA-256 是**浏览器里真算的**（`crypto.subtle.digest`），不是占位符——原型截图里那些
 * `aaaaaaaaa…` 是 mock，真页面要么给真哈希要么不给。它的用处是 R6 的可追溯：同一份报表
 * 重复上传时人能一眼看出是不是同一个文件。
 *
 * 类型识别按扩展名，**只是推测**：界面上必须写明这是按文件名猜的，真正的类型判定由 Agent
 * 读完内容后给出。把推测显示成结论，正是 UC-16.1 反复强调不许做的事。
 */
export type MaterialKind = "statement" | "audit_report" | "recording" | "unknown";

export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  statement: "报表",
  audit_report: "审计报告",
  recording: "录音",
  unknown: "未识别",
};

const AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "aac", "flac", "ogg"];
const STATEMENT_EXTENSIONS = ["xlsx", "xls", "csv"];

/** 按文件名推测类型。审计报告只认名字里带「审计」/「audit」的 pdf/docx，其余 pdf 归报表。 */
export function guessMaterialKind(fileName: string): MaterialKind {
  const lower = fileName.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  if (AUDIO_EXTENSIONS.includes(ext)) return "recording";
  if (STATEMENT_EXTENSIONS.includes(ext)) return "statement";
  if (ext === "pdf" || ext === "docx" || ext === "doc") {
    return lower.includes("审计") || lower.includes("audit") ? "audit_report" : "statement";
  }
  if (ext === "pptx" || ext === "ppt") return "statement";
  return "unknown";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 真算 SHA-256。`crypto.subtle` 只在安全上下文（https / localhost）可用；不可用时返回
 * null，界面据此不显示哈希——而不是编一个或显示空串装作算过了。
 */
export async function sha256Hex(file: File): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

export interface MaterialFile {
  readonly file: File;
  readonly kind: MaterialKind;
  readonly sha256: string | null;
}

export async function describeMaterial(file: File): Promise<MaterialFile> {
  return { file, kind: guessMaterialKind(file.name), sha256: await sha256Hex(file) };
}
