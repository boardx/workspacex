/**
 * OOXML 合法性断言（`verification.md` V1）。
 *
 * ⚠ 这里刻意**不**用「文件大小 > 0」「后缀是 .pptx」这类断言。V1-CP 的存在就是为了
 * 钉死这一点:一个"总是回一个 0 字节文件"或"回一段随便什么二进制"的实现必须让
 * 本文件的断言变红。所以下面每一条都真的去解 zip、解 XML、读文本节点。
 *
 * 零依赖手写 zip 解析:只需要 central directory + stored/deflate 两种压缩方法,
 * 引一整个 zip 库进来不值得,而且自己解才能真的断言"zip 结构完整"。
 */
import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  readonly name: string;
  readonly bytes: Buffer;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** 解压 zip;结构不完整时 throw——这就是 V1 的「zip 完整性 OK」断言。 */
export function unzip(buffer: Buffer): readonly ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`corrupt zip: central directory entry ${i} has a bad signature`);
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`corrupt zip: local header for ${name} has a bad signature`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    let bytes: Buffer;
    if (method === 0) bytes = Buffer.from(raw);
    else if (method === 8) bytes = inflateRawSync(raw);
    else throw new Error(`corrupt zip: ${name} uses unsupported compression method ${method}`);

    if (bytes.length !== uncompressedSize) {
      throw new Error(
        `corrupt zip: ${name} inflated to ${bytes.length} bytes, central directory says ${uncompressedSize}`,
      );
    }

    entries.push({ name, bytes });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  // EOCD 至少 22 字节,注释最长 65535。
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error("corrupt zip: no end-of-central-directory record found (not a zip file at all?)");
}

/**
 * 极简 XML 良构性检查:标签配对 + 属性引号闭合。够用来判定「slideN.xml 能被解析」,
 * 且不用给一个纯服务端包引 DOM 解析器。任何不配对都 throw。
 */
export function assertParsableXml(name: string, xml: string): void {
  if (!xml.trimStart().startsWith("<?xml")) {
    throw new Error(`${name}: missing XML declaration`);
  }
  const stack: string[] = [];
  const tagPattern = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = tagPattern.exec(xml)) !== null) {
    const [full, closing, tagName, attrs, selfClosing] = match;
    consumed += full.length;
    if (attrs !== undefined && (attrs.match(/"/g)?.length ?? 0) % 2 !== 0) {
      throw new Error(`${name}: unbalanced attribute quotes on <${tagName}>`);
    }
    if (closing === "/") {
      const open = stack.pop();
      if (open !== tagName) {
        throw new Error(`${name}: closing </${tagName}> does not match open <${open ?? "nothing"}>`);
      }
    } else if (selfClosing !== "/" && !full.startsWith("<?")) {
      stack.push(tagName!);
    }
  }
  if (stack.length > 0) {
    throw new Error(`${name}: unclosed tags ${stack.join(", ")}`);
  }
  if (consumed === 0) {
    throw new Error(`${name}: no XML tags at all`);
  }
}

export interface PptxInspection {
  readonly slideCount: number;
  /** 所有 `<a:t>` 文本节点,按幻灯片顺序拍平。 */
  readonly textRuns: readonly string[];
}

/**
 * V1 的完整断言:zip 完整 → Content_Types 声明 presentation → 每张 slide 可解析
 * → 收集正文文本。任何一步不满足就 throw。
 */
export function inspectPptx(buffer: Buffer): PptxInspection {
  const entries = unzip(buffer);
  const byName = new Map(entries.map((e) => [e.name, e.bytes]));

  const contentTypes = byName.get("[Content_Types].xml");
  if (!contentTypes) throw new Error("not OOXML: [Content_Types].xml missing");
  const contentTypesXml = contentTypes.toString("utf8");
  assertParsableXml("[Content_Types].xml", contentTypesXml);
  if (!contentTypesXml.includes("presentationml.presentation.main+xml")) {
    throw new Error(
      "not a presentation: [Content_Types].xml does not declare presentationml.presentation.main+xml",
    );
  }

  const slideNames = entries
    .map((e) => e.name)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideIndex(a) - slideIndex(b));
  if (slideNames.length === 0) throw new Error("no ppt/slides/slideN.xml entries");

  const textRuns: string[] = [];
  for (const slideName of slideNames) {
    const xml = byName.get(slideName)!.toString("utf8");
    assertParsableXml(slideName, xml);
    for (const m of xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)) {
      textRuns.push(decodeXmlEntities(m[1]!));
    }
  }

  return { slideCount: slideNames.length, textRuns };
}

function slideIndex(name: string): number {
  return Number(/slide(\d+)\.xml$/.exec(name)![1]);
}

/**
 * F979（design-delta skill-office-docs-node-runtime）—— docx/xlsx 都是 OOXML zip，
 * 复用上面同一套 `unzip`/`assertParsableXml`，只是各自的 `[Content_Types].xml` 声明
 * 与正文文本节点位置不同。同一条纪律：不用"文件大小 > 0"/"后缀是 .docx"这类断言，
 * 真的解 zip、解 XML、读文本节点（对应 V1-docx/V1-xlsx 反证）。
 */
export interface DocxInspection {
  /** `word/document.xml` 里所有 `<w:t>` 文本节点，按文档顺序拍平。 */
  readonly textRuns: readonly string[];
}

export function inspectDocx(buffer: Buffer): DocxInspection {
  const entries = unzip(buffer);
  const byName = new Map(entries.map((e) => [e.name, e.bytes]));

  const contentTypes = byName.get("[Content_Types].xml");
  if (!contentTypes) throw new Error("not OOXML: [Content_Types].xml missing");
  const contentTypesXml = contentTypes.toString("utf8");
  assertParsableXml("[Content_Types].xml", contentTypesXml);
  if (!contentTypesXml.includes("wordprocessingml.document.main+xml")) {
    throw new Error(
      "not a Word document: [Content_Types].xml does not declare wordprocessingml.document.main+xml",
    );
  }

  const documentXmlBytes = byName.get("word/document.xml");
  if (!documentXmlBytes) throw new Error("no word/document.xml entry");
  const documentXml = documentXmlBytes.toString("utf8");
  assertParsableXml("word/document.xml", documentXml);

  const textRuns: string[] = [];
  for (const m of documentXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)) {
    textRuns.push(decodeXmlEntities(m[1]!));
  }
  return { textRuns };
}

export interface XlsxInspection {
  readonly sheetCount: number;
  /** `xl/sharedStrings.xml` 里所有 `<t>` 文本节点——exceljs 默认把字符串写进共享
   *  字符串表，不是内联在 sheet XML 里。 */
  readonly sharedStrings: readonly string[];
}

export function inspectXlsx(buffer: Buffer): XlsxInspection {
  const entries = unzip(buffer);
  const byName = new Map(entries.map((e) => [e.name, e.bytes]));

  const contentTypes = byName.get("[Content_Types].xml");
  if (!contentTypes) throw new Error("not OOXML: [Content_Types].xml missing");
  const contentTypesXml = contentTypes.toString("utf8");
  assertParsableXml("[Content_Types].xml", contentTypesXml);
  if (!contentTypesXml.includes("spreadsheetml.sheet.main+xml")) {
    throw new Error(
      "not an Excel workbook: [Content_Types].xml does not declare spreadsheetml.sheet.main+xml",
    );
  }

  const sheetNames = entries.map((e) => e.name).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (sheetNames.length === 0) throw new Error("no xl/worksheets/sheetN.xml entries");
  for (const name of sheetNames) {
    assertParsableXml(name, byName.get(name)!.toString("utf8"));
  }

  const sharedStrings: string[] = [];
  const sharedStringsXml = byName.get("xl/sharedStrings.xml");
  if (sharedStringsXml) {
    const xml = sharedStringsXml.toString("utf8");
    assertParsableXml("xl/sharedStrings.xml", xml);
    for (const m of xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
      sharedStrings.push(decodeXmlEntities(m[1]!));
    }
  }

  return { sheetCount: sheetNames.length, sharedStrings };
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
