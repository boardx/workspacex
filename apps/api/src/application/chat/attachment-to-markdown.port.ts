/**
 * #946 · F153/W1（V9-b）—— `AttachmentToMarkdownPort`：把附件字节转成 markdown 的**能力边界**。
 *
 * application 层只认识这个端口；`@firecrawl/anydoc` 只出现在 infrastructure 的实现里
 * （见 `infrastructure/chat/anydoc-attachment-to-markdown.ts`），洋葱依赖方向不破。
 * 选型与约束见 `docs/proposals/PROP-CHAT-ANYDOC-INTEGRATION-001.md`。
 *
 * `format` 由领域 `planExtraction(mime)` 决定并显式传入——anydoc 对无签名格式（CSV）不靠嗅
 * 字节，必须显式给；这里也不让实现去猜。
 */

/**
 * 抽取失败码——**逐字镜像** anydoc 的 `ConvertErrorCode`（端口把原生错误收敛成这个封闭枚举，
 * 上层不 catch 原生 Error）。含义见 anydoc `index.d.ts`：
 * - `unsupported`  未知/不可转格式（含图片型 PDF——扫描件，OCR 归 CE-014）。
 * - `malformed`    结构不可用，抽不出有意义内容。
 * - `encrypted`    加密/口令保护。
 * - `resourceLimit` 触发解压/嵌套/节点数安全上限。
 * - `missingPart`  缺少产出任何有意义内容所必需的部件。
 * - `io`           读取失败。
 */
export type ConvertErrorCode =
  | "unsupported"
  | "malformed"
  | "encrypted"
  | "resourceLimit"
  | "missingPart"
  | "io";

export type ConvertResult =
  | { readonly ok: true; readonly markdown: string }
  | { readonly ok: false; readonly code: ConvertErrorCode };

export interface AttachmentToMarkdownPort {
  /**
   * 把 `bytes` 按 `format` 转成 markdown。永不抛：失败收敛成 `{ ok:false, code }`
   * （原生错误的 `.code` 映射到 `ConvertErrorCode`；映射不到的未知错误当 `malformed`）。
   */
  convert(bytes: Uint8Array, format: string): Promise<ConvertResult>;
}

export const ATTACHMENT_TO_MARKDOWN = Symbol("AttachmentToMarkdownPort");

/** anydoc 的包名 + 版本，如实写进抽取记录的 `generatorModel`（CE 完成契约要求，单源在此）。 */
export const ATTACHMENT_MARKDOWN_GENERATOR = "@firecrawl/anydoc@0.1.8";
