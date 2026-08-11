/**
 * #946 · F153/W1（V9-b）—— `AttachmentToMarkdownPort` 的 `@firecrawl/anydoc` 实现。
 *
 * 这是**唯一** import anydoc 的地方（洋葱：原生依赖只在 infrastructure）。anydoc 的
 * `toMarkdownBytes(bytes, format)` 从字节直接产 markdown；失败以带 `.code` 的 Error 抛出，
 * 这里把 `.code` 收敛成端口的封闭 `ConvertErrorCode`，**永不把原生 Error 泄漏给上层**。
 *
 * ⚠ format 必须显式传（CSV 无签名，anydoc 不嗅字节）——由领域 `planExtraction(mime)` 决定，
 *   本实现不猜。⚠ 内存峰值可达 ~28×输入（25MB→~700MB，见 PROP-CHAT-ANYDOC-INTEGRATION-001），
 *   并发上限与 3MB 同步阈值由调用方（worker / 上传用例）控制，不在本实现里。
 */
import * as anydoc from "@firecrawl/anydoc";
import type {
  AttachmentToMarkdownPort, ConvertErrorCode, ConvertResult,
} from "../../application/chat/attachment-to-markdown.port";

const KNOWN_CODES: ReadonlySet<ConvertErrorCode> = new Set<ConvertErrorCode>([
  "unsupported", "malformed", "encrypted", "resourceLimit", "missingPart", "io",
]);

/** 把原生错误的 `.code` 收敛成封闭枚举；认不出的一律当 `malformed`（结构性抽不出内容）。 */
function toConvertErrorCode(raw: unknown): ConvertErrorCode {
  const code = (raw as { code?: unknown } | null)?.code;
  return typeof code === "string" && KNOWN_CODES.has(code as ConvertErrorCode)
    ? (code as ConvertErrorCode)
    : "malformed";
}

export class AnydocAttachmentToMarkdown implements AttachmentToMarkdownPort {
  async convert(bytes: Uint8Array, format: string): Promise<ConvertResult> {
    try {
      // format 传字符串字面量（'pdf'/'docx'/…）——anydoc 的 Format 是 NAPI const enum，
      // 运行时即字符串值；用参数类型断言避免 import 那个会被内联的 const enum。
      const markdown = await anydoc.toMarkdownBytes(
        bytes,
        format as Parameters<typeof anydoc.toMarkdownBytes>[1],
      );
      return { ok: true, markdown };
    } catch (e) {
      return { ok: false, code: toConvertErrorCode(e) };
    }
  }
}
