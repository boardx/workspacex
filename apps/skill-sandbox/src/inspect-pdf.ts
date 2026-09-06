/**
 * PDF 合法性断言（F979，design-delta skill-office-docs-node-runtime，`verification.md`
 * V1-pdf）。PDF **不是** OOXML/zip——`ooxml.ts` 那套解析对它不适用，这里另开一份。
 *
 * 同一条纪律：不用"文件大小 > 0"这类断言。用 `pdf-lib` 真的把文件当 PDF 解析（语法
 * 不合法会抛错），再对每一页的 content stream 做最小化的 PDF 文本算子扫描
 * （`Tj`/`TJ` 操作符的括号字符串操作数），确认请求的文本真的被画进了页面，不是只有
 * 一个空白页。
 *
 * ⚠ **只对拉丁文本有效**：`pdf-lib` 的标准 14 字体（`StandardFonts`）走 WinAnsi 编码，
 * `Tj` 操作数就是字符本身，所以这里能把文本读回来。**中文走的是另一条路**——嵌入
 * 字体 + Identity-H，`Tj` 操作数是字形编号而不是字符，且 pdf-lib 不写 ToUnicode
 * CMap（实测确认），从 PDF 反查不回原文。中文的断言方式见
 * `tests/produces-real-cjk-pdf.test.ts` 头注（比对字形编号 + .notdef 检查），
 * 别试图在这里"顺手支持一下中文文本提取"，那是做不到的。
 */
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { inflateSync } from "node:zlib";

export interface PdfInspection {
  readonly pageCount: number;
  /** 每一页 content stream 里，`Tj`/`TJ` 算子展示的文本，按页面顺序拍平。 */
  readonly textRuns: readonly string[];
  /**
   * 文件里**内嵌**的字体文件个数（字体描述符上的 `/FontFile`、`/FontFile2`、
   * `/FontFile3` 键）。中文 PDF 的关键断言之一：字体必须真的嵌进文件，只写一个
   * 字体名字指望阅读器自己有，换台机器就是一页方框。
   */
  readonly embeddedFontFileCount: number;
  /** 字体字典上的 `/Encoding` 名（内嵌 CJK 子集字体是 `Identity-H`）。 */
  readonly fontEncodings: readonly string[];
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
  const { embeddedFontFileCount, fontEncodings } = inspectFonts(doc);
  return { pageCount, textRuns, embeddedFontFileCount, fontEncodings };
}

/**
 * 遍历**已解析的间接对象**找字体信息，而不是在原始字节里 grep `/FontFile2`。
 *
 * ⚠ 这不是风格选择：pdf-lib 保存时会把对象写进压缩的 object stream，字典里的键名
 * 在文件字节里**根本不以明文出现**（实测：一份确实内嵌了子集字体的 PDF，
 * `bytes.includes('/FontFile2')` 是 false）。在字节里 grep 会得到一个稳定的假阴性，
 * 而假阴性在这里的方向是"把好文件判坏"——比假阳性好，但仍然是错的断言。
 */
function inspectFonts(doc: PDFDocument): {
  embeddedFontFileCount: number;
  fontEncodings: readonly string[];
} {
  let embeddedFontFileCount = 0;
  const fontEncodings: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    for (const key of obj.keys()) {
      if (String(key).startsWith("/FontFile")) embeddedFontFileCount += 1;
    }
    if (String(obj.get(PDFName.of("Type")) ?? "") === "/Font") {
      const encoding = obj.get(PDFName.of("Encoding"));
      if (encoding) fontEncodings.push(String(encoding).replace(/^\//, ""));
    }
  }
  return { embeddedFontFileCount, fontEncodings };
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
