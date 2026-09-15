/** 材料包接收：浏览器侧读取 + 哈希 + 可解析性判定（需求 01 第 1-2 步）。 */
import type { ReviewDocument, UnparsedFile } from "./types";

/** 当前解析层只覆盖纯文本族；PDF/Office 要走服务端 `wx_document_parse`（需求 02 已登记）。 */
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|html?)$/i;

export interface IntakeResult {
  readonly documents: ReviewDocument[];
  readonly unparsed: UnparsedFile[];
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "sha256-unavailable".padEnd(64, "0").slice(0, 64);
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function canParse(name: string): boolean {
  return TEXT_EXT.test(name);
}

export function unparsedReason(name: string): string {
  if (/\.(pdf|docx?|pptx?|xlsx?)$/i.test(name)) {
    return "该格式需服务端 wx_document_parse（页码/单元格级定位），当前部署尚未接线；请先转存为 txt/md/csv 上传";
  }
  return "不在可解析格式白名单内";
}

export async function intakeFiles(files: readonly File[]): Promise<IntakeResult> {
  const documents: ReviewDocument[] = [];
  const unparsed: UnparsedFile[] = [];
  for (const [index, file] of files.entries()) {
    if (!canParse(file.name)) {
      unparsed.push({ name: file.name, bytes: file.size, reason: unparsedReason(file.name) });
      continue;
    }
    try {
      const text = await file.text();
      documents.push({ id: `upload-${index}-${file.name}`, name: file.name, text, sha256: await sha256Hex(text), bytes: file.size });
    } catch {
      unparsed.push({ name: file.name, bytes: file.size, reason: "读取失败" });
    }
  }
  return { documents, unparsed };
}

export async function intakeTexts(files: readonly { name: string; text: string }[]): Promise<ReviewDocument[]> {
  return Promise.all(files.map(async (f, index) => ({
    id: `fixture-${index}-${f.name}`, name: f.name, text: f.text, sha256: await sha256Hex(f.text), bytes: new TextEncoder().encode(f.text).length,
  })));
}
