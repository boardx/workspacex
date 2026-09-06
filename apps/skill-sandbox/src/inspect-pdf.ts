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
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
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
  /** 字体字典上的 `/Encoding` 名（内嵌 CJK 字体是 `Identity-H`）。 */
  readonly fontEncodings: readonly string[];
  /**
   * 把内嵌字体**掏出来重新解析**，看这些字形编号是不是真的可用（取得到、且轮廓非空）。
   *
   * ⚠ 这条才是"打开不会是方框"的判据。2026-09-06 实测教训：只断言"字形编号 != 0"
   * 会放行一份打开全是方框的 PDF——`subset: true` 会把字形重编号成 1,2,3…，编号非零
   * 恒真，与那些字形里到底有没有轮廓无关。
   */
  readonly usableGlyphs: (codes: readonly number[]) => Promise<GlyphUsability>;
}

export interface GlyphUsability {
  /** 内嵌字体整份解析不了时给出原因；能解析则为 null。 */
  readonly unreadableFont: string | null;
  /** 取不到或轮廓为空的字形编号——非空就意味着页面上那些位置是方框。 */
  readonly brokenCodes: readonly number[];
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
  const { embeddedFontFileCount, fontEncodings, embeddedFontBytes } = inspectFonts(doc);
  return {
    pageCount,
    textRuns,
    embeddedFontFileCount,
    fontEncodings,
    usableGlyphs: (codes) => Promise.resolve(checkGlyphs(embeddedFontBytes, codes)),
  };
}

/**
 * 用内嵌的那份字体字节自己解析一遍，逐个字形要轮廓。
 *
 * ⚠ 不去猜"哪种失败算坏"：解析不了、取不到字形、轮廓为空，三者都算坏，各自如实报出。
 * ⚠ CFF（OTF）字体内嵌在 `/FontFile3` 里的是**裸 CFF 表**，fontkit 打不开它——那不
 *   等于字体坏了。所以 CFF 这一路用 `/FontFile3` 存在与否 + 页面编码来判断，真正的
 *   字形可用性由构建期的覆盖自检与本函数对 TrueType 路径的检查共同覆盖；
 *   `subset: true` 的坏结果在这里表现为"解析失败"，正是我们要它红的那种红。
 */
function checkGlyphs(
  fontBytes: Uint8Array | null,
  codes: readonly number[],
): GlyphUsability {
  if (!fontBytes) return { unreadableFont: "PDF 里没有内嵌字体文件", brokenCodes: [...codes] };
  let font: ReturnType<typeof fontkit.create>;
  try {
    font = fontkit.create(Buffer.from(fontBytes));
  } catch (e) {
    return {
      unreadableFont: e instanceof Error ? e.message : "内嵌字体无法解析",
      brokenCodes: [...codes],
    };
  }
  const broken: number[] = [];
  for (const code of new Set(codes)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const glyph = (font as any).getGlyph(code);
      if (!glyph?.path || glyph.path.commands.length === 0) broken.push(code);
    } catch {
      broken.push(code);
    }
  }
  return { unreadableFont: null, brokenCodes: broken };
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
  embeddedFontBytes: Uint8Array | null;
} {
  let embeddedFontFileCount = 0;
  let embeddedFontBytes: Uint8Array | null = null;
  const fontEncodings: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    for (const key of obj.keys()) {
      if (!String(key).startsWith("/FontFile")) continue;
      embeddedFontFileCount += 1;
      const stream = doc.context.lookup(obj.get(PDFName.of(String(key).slice(1)))!);
      if (stream instanceof PDFRawStream) embeddedFontBytes = decodeStream(stream);
    }
    if (String(obj.get(PDFName.of("Type")) ?? "") === "/Font") {
      const encoding = obj.get(PDFName.of("Encoding"));
      if (encoding) fontEncodings.push(String(encoding).replace(/^\//, ""));
    }
  }
  return { embeddedFontFileCount, fontEncodings, embeddedFontBytes };
}

/** 字体流通常是 FlateDecode；不是就当已经是明文（与 content stream 那边同一条处理）。 */
function decodeStream(stream: PDFRawStream): Uint8Array {
  const raw = Buffer.from(stream.getContents());
  const filter = String(stream.dict.get(PDFName.of("Filter")) ?? "");
  if (!filter.includes("FlateDecode")) return raw;
  try {
    return inflateSync(raw);
  } catch {
    return raw;
  }
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
