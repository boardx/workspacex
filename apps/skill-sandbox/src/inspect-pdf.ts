/**
 * PDF 合法性断言（F979，design-delta skill-office-docs-node-runtime，`verification.md`
 * V1-pdf）。PDF **不是** OOXML/zip——`ooxml.ts` 那套解析对它不适用，这里另开一份。
 *
 * 同一条纪律：不用"文件大小 > 0"这类断言。用 `pdf-lib` 真的把文件当 PDF 解析（语法
 * 不合法会抛错），再对每一页的 content stream 做最小化的 PDF 文本算子扫描
 * （`Tj`/`TJ` 操作符的括号字符串操作数），确认请求的文本真的被画进了页面，不是只有
 * 一个空白页。
 *
 * ⚠ **已知限制**：`pdf-lib` 的标准 14 字体（`StandardFonts`）只覆盖 WinAnsi 编码
 * （拉丁字符），不支持中文——嵌入 CJK 字体需要额外的字体文件与 `@pdf-lib/fontkit`
 * 依赖，属于范围外（design-delta §2 明确首个切片只做纯文本排版，不含字体管理）。
 * 因此本 skill 的示例/测试文本用英文，promptTemplate 里会如实告知这一限制。
 */
import { PDFDocument } from "pdf-lib";
import { inflateSync } from "node:zlib";

export interface PdfInspection {
  readonly pageCount: number;
  /** 每一页 content stream 里，`Tj`/`TJ` 算子展示的文本，按页面顺序拍平。 */
  readonly textRuns: readonly string[];
}

export async function inspectPdf(buffer: Buffer): Promise<PdfInspection> {
  // pdf-lib 会在这里抛错：不是合法 PDF 语法（缺 %PDF- 头、xref 表损坏等）就throw，
  // 这就是"文件真的是一份可解析的 PDF"这条断言本身。
  const doc = await PDFDocument.load(buffer, { throwOnInvalidObject: true });
  const pageCount = doc.getPageCount();
  if (pageCount === 0) throw new Error("PDF has zero pages");

  const textRuns: string[] = [];
  for (const page of doc.getPages()) {
    const streamBytes = extractContentStreamBytes(page);
    for (const bytes of streamBytes) {
      textRuns.push(...extractShownText(bytes));
    }
  }
  return { pageCount, textRuns };
}

/**
 * 从页面的 Contents 流取原始字节（pdf-lib 内部结构，走公开的 `node` 访问器）。
 * 一页可能有多个 content stream（数组形式），逐个取。
 */
function extractContentStreamBytes(page: ReturnType<PDFDocument["getPage"]>): readonly Uint8Array[] {
  // pdf-lib 的 Page 类型没有直接暴露"给我 content stream 字节"这个公开 API（它是
  // 为写而不是为读设计的）。这里用它已解析好的 low-level PDFPageLeaf 节点
  // （`page.node`，读 pdf-lib 源码 `api/PDFPage.js` 的 `this.node = leafNode`
  // 确认，不是猜测）取 Contents。`Contents` 可能是单个 stream（有 `.getContents()`），
  // 也可能是 `PDFArray`（多个 stream 的引用数组，`.size()`/`.lookup(i)`，**不是**
  // 原生 JS 数组，`Array.isArray()` 对它恒 false——读 `core/objects/PDFArray.js`
  // 确认）。两种形状都要处理。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const node = (page as any).node;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Contents: any = node.Contents?.();
  if (!Contents) return [];

  const out: Uint8Array[] = [];
  if (typeof Contents.getContents === "function") {
    out.push(Contents.getContents());
  } else if (typeof Contents.size === "function" && typeof Contents.lookup === "function") {
    const n = Contents.size();
    for (let i = 0; i < n; i += 1) {
      const stream = Contents.lookup(i);
      if (stream && typeof stream.getContents === "function") out.push(stream.getContents());
    }
  }
  return out;
}

function maybeInflate(bytes: Uint8Array): Buffer {
  const buf = Buffer.from(bytes);
  // Flate 流以 zlib header 0x78 开头（最常见的 0x789c 等）——不是就当已经是明文。
  if (buf.length >= 2 && buf[0] === 0x78) {
    try {
      return inflateSync(buf);
    } catch {
      return buf;
    }
  }
  return buf;
}

/**
 * 扫描 content stream 里 `Tj`/`TJ` 两种展示文本算子的字符串操作数。
 *
 * ⚠ 实测发现(不是从规范猜的):pdf-lib 给 `page.drawText()` 生成的 `Tj` 操作数
 * 不是 PDF 字面量字符串 `(...)`，而是**十六进制字符串** `<...>`(每两个十六进制
 * 字符 = 一个字节的字形编码)——例如 `<517561727465726C7920526576696577> Tj`
 * 就是 "Quarterly Review" 的十六进制形式。只认 `(...)` 会让 pdf-lib 产出的文本
 * 全部漏检、`textRuns` 恒为空数组,却不报错——最隐蔽的一种假通过。两种形式都要处理。
 */
function extractShownText(rawBytes: Uint8Array): readonly string[] {
  const text = maybeInflate(rawBytes).toString("latin1");
  const out: string[] = [];
  const STR = /\((?:\\.|[^()\\])*\)|<[0-9A-Fa-f\s]*>/g;

  // (literal string) Tj  或  <hex string> Tj
  for (const m of text.matchAll(new RegExp(`(${STR.source})\\s*Tj`, "g"))) {
    out.push(decodePdfStringOperand(m[1]!));
  }
  // [ (a) -120 (b) ] TJ / [ <hex> -120 <hex> ] TJ —— 数组里所有字符串操作数拼起来
  for (const m of text.matchAll(/\[((?:[^\[\]])*)\]\s*TJ/g)) {
    const inner = m[1]!;
    for (const s of inner.matchAll(STR)) out.push(decodePdfStringOperand(s[0]));
  }
  return out;
}

function decodePdfStringOperand(operand: string): string {
  if (operand.startsWith("<")) {
    const hex = operand.slice(1, -1).replace(/\s/g, "");
    return Buffer.from(hex, "hex").toString("latin1");
  }
  return unescapePdfString(operand.slice(1, -1));
}

function unescapePdfString(s: string): string {
  return s.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c));
}
