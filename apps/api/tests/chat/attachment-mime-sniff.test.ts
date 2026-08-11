/**
 * #946 · V9-a F150 —— 服务端字节校验（magic number → 族 → 与声明 MIME 比对）单测。
 * 攻击面焦点：把二进制改名/改 Content-Type 冒充白名单类型，必须判 MIME_MISMATCH（false）。
 */
import { describe, expect, it } from "vitest";
import { chatFileUpload as CFU } from "@repo/contracts";
import { declaredMimeMatchesBytes, sniffMimeFamily } from "../../src/domain/chat/attachment-mime-sniff";

const bytes = (...b: number[]) => new Uint8Array(b);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37); // %PDF-1.7
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00); // docx/xlsx/pptx 容器
const TEXT = new TextEncoder().encode("col_a,col_b\n1,2\n");
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00); // MZ（Windows PE），非白名单任何族

describe("sniffMimeFamily", () => {
  it("按 magic number 归族", () => {
    expect(sniffMimeFamily(PDF)).toBe("pdf");
    expect(sniffMimeFamily(PNG)).toBe("png");
    expect(sniffMimeFamily(JPEG)).toBe("jpeg");
    expect(sniffMimeFamily(WEBP)).toBe("webp");
    expect(sniffMimeFamily(ZIP)).toBe("zip");
    expect(sniffMimeFamily(TEXT)).toBe("text");
  });
  it("含 NUL 的未知二进制 → null（不冒充文本）", () => {
    expect(sniffMimeFamily(EXE)).toBeNull(); // MZ 后紧跟 NUL
  });
  it("空文件视为文本（空 csv 合法）", () => {
    expect(sniffMimeFamily(new Uint8Array(0))).toBe("text");
  });
});

describe("declaredMimeMatchesBytes", () => {
  it("声明与字节同族 → 通过", () => {
    expect(declaredMimeMatchesBytes("application/pdf", PDF)).toBe(true);
    expect(declaredMimeMatchesBytes("image/png", PNG)).toBe(true);
    expect(declaredMimeMatchesBytes("text/csv", TEXT)).toBe(true);
    // docx 声明 + 真 ZIP 字节 → 通过（三 OOXML 同 zip 族，符合设计）
    expect(
      declaredMimeMatchesBytes(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ZIP,
      ),
    ).toBe(true);
  });
  it("把 EXE 改 Content-Type 冒充 PDF/PNG/docx → MIME_MISMATCH（false）", () => {
    expect(declaredMimeMatchesBytes("application/pdf", EXE)).toBe(false);
    expect(declaredMimeMatchesBytes("image/png", EXE)).toBe(false);
    expect(
      declaredMimeMatchesBytes(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        EXE,
      ),
    ).toBe(false);
  });
  it("PNG 字节声明成 JPEG → 不同族 → false", () => {
    expect(declaredMimeMatchesBytes("image/jpeg", PNG)).toBe(false);
  });
  it("白名单外的声明 MIME → 一律 false（不开后门）", () => {
    expect(declaredMimeMatchesBytes("application/x-msdownload", TEXT)).toBe(false);
  });
  it("白名单每个 MIME 都在族映射内有归属（不漏配）", () => {
    // 造一份该类型的合法字节，逐条应通过——防新增白名单类型忘了在 sniff 里配族
    const specimen: Record<string, Uint8Array> = {
      "application/pdf": PDF,
      "text/plain": TEXT,
      "text/markdown": TEXT,
      "text/csv": TEXT,
      "image/png": PNG,
      "image/jpeg": JPEG,
      "image/webp": WEBP,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ZIP,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ZIP,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": ZIP,
    };
    for (const mime of CFU.ATTACHMENT_MIME_ALLOWLIST) {
      const s = specimen[mime];
      expect(s, `白名单类型 ${mime} 缺少 sniff 族配置或样本`).toBeDefined();
      expect(declaredMimeMatchesBytes(mime, s!)).toBe(true);
    }
  });
});
