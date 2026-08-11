/**
 * #946 · F153/W1（V9-b）—— 附件抽取的**纯**领域决策：一个附件的 MIME 决定它怎么变成文本。
 *
 * 洋葱最内层：不认识 anydoc、不认识对象存储、不做 I/O。只回答一个纯问题——
 * 「这个 MIME 该走哪条抽取路径」：
 *   - `convert`   → 交给 `AttachmentToMarkdownPort`（anydoc）转 markdown，附带要显式传的 `format`。
 *                   （CSV 等无签名格式必须显式给 format，anydoc 不靠嗅字节，见 PROP-CHAT-ANYDOC-INTEGRATION-001。）
 *   - `passthrough` → 本身就是文本（txt/md），字节即内容，不进 anydoc（也省一次原生调用与内存峰值）。
 *   - `unsupported` → 抽不出文本（图片没有文字层；扫描件/图片 PDF 由 anydoc 侧报 unsupported，OCR 归 CE-014）。
 *                     结果是「无法提取」，不是失败——附件仍在，只是内容进不了上下文。
 *
 * ⚠ MIME 白名单的唯一事实源是契约 `chat-file-upload.ts` 的 `ATTACHMENT_MIME_ALLOWLIST`。
 *   本文件为白名单里**每一个** MIME 都给一条计划；测试用契约常量遍历断言无遗漏，防「加了新
 *   白名单类型却没人给它抽取路径」悄悄漏过（本仓「同一事实两处声明」教训的另一面：这里不复述
 *   白名单，只对它做全覆盖映射）。
 */

/** anydoc 的 `Format` 取值（字符串字面量——NAPI const enum 运行时被内联，传字符串即可）。 */
export type AnydocFormat = "pdf" | "docx" | "xlsx" | "pptx" | "csv";

export type ExtractionPlan =
  | { readonly kind: "convert"; readonly format: AnydocFormat }
  | { readonly kind: "passthrough" }
  | { readonly kind: "unsupported"; readonly reason: "image" };

/**
 * MIME → 抽取计划。白名单外的 MIME 不该走到这里（上传时已被 `checkAttachmentBytesAndType`
 * 挡掉），真到了就当 `unsupported` 保守处理，绝不猜一个 format 硬转。
 */
export function planExtraction(mime: string): ExtractionPlan {
  switch (mime) {
    case "application/pdf":
      return { kind: "convert", format: "pdf" };
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return { kind: "convert", format: "docx" };
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return { kind: "convert", format: "xlsx" };
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return { kind: "convert", format: "pptx" };
    case "text/csv":
      return { kind: "convert", format: "csv" };
    case "text/plain":
    case "text/markdown":
      return { kind: "passthrough" };
    case "image/png":
    case "image/jpeg":
    case "image/webp":
      return { kind: "unsupported", reason: "image" };
    default:
      // 白名单外——保守当抽不出文本，不臆造 format。
      return { kind: "unsupported", reason: "image" };
  }
}
