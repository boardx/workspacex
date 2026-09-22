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
const WAV = bytes(0x52,0x49,0x46,0x46,0x24,0,0,0,0x57,0x41,0x56,0x45);
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
      "audio/wav": WAV,
      "audio/x-wav": WAV,
      "audio/wave": WAV,
      "audio/mpeg": Buffer.from([0xff,0xfb,0x90,0]),
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

it("WAV intake distinguishes RIFF/WAVE from WebP and forged executable bytes",()=>{
 for(const mime of ['audio/wav','audio/x-wav','audio/wave']){
  expect(declaredMimeMatchesBytes(mime,WAV)).toBe(true);
  expect(declaredMimeMatchesBytes(mime,WEBP)).toBe(false);
  expect(declaredMimeMatchesBytes(mime,EXE)).toBe(false);
  expect(declaredMimeMatchesBytes(mime,TEXT)).toBe(false);
 }
 expect(declaredMimeMatchesBytes('image/webp',WAV)).toBe(false);
});

it('accepts MP3 magic while rejecting AAC, images and executable masquerades',()=>{
 expect(declaredMimeMatchesBytes('audio/mpeg',Buffer.from([0x49,0x44,0x33,4,0,0,0,0,0,0]))).toBe(true);
 expect(declaredMimeMatchesBytes('audio/mpeg',Buffer.from([0xff,0xfb,0x90,0]))).toBe(true);
 expect(declaredMimeMatchesBytes('audio/mpeg',Buffer.from([0xff,0xf1,0x50,0x80]))).toBe(false);
 expect(declaredMimeMatchesBytes('audio/mpeg',Buffer.from('MZ\0binary'))).toBe(false);
});

/**
 * #964 —— `looksLikeText` 原先只判 NUL：不含 NUL 的二进制（非法 UTF-8 字节序列）会被判成
 * text 族、以 text/plain 之名收下（fail-open）。字节校验的职责是「挡住二进制冒充白名单类型」，
 * 所以这里必须 fail-closed：不是合法 UTF-8 文本 → 不是 text 族。
 */
describe("#964 非法 UTF-8 的二进制不得冒充 text（fail-closed）", () => {
  const notText = (label: string, ...b: number[]) => {
    const buf = bytes(...b);
    expect(sniffMimeFamily(buf), `${label} 不应归到 text 族`).not.toBe("text");
    for (const mime of ["text/plain", "text/markdown", "text/csv"]) {
      expect(declaredMimeMatchesBytes(mime, buf), `${label} 声明 ${mime} 应判 MIME_MISMATCH`).toBe(false);
    }
  };

  it("落单的续字节（0x80-0xBF）不是文本", () => notText("lone continuation", 0x80, 0x80, 0x80, 0x80));
  it("gzip 魔数（无 NUL 的真二进制）不是文本", () => notText("gzip", 0x1f, 0x8b, 0x08, 0x08, 0x7a, 0x7a, 0x7a));
  it("过长编码（C0 AF，经典 '/' 绕过）不是文本", () => notText("overlong", 0xc0, 0xaf));
  it("UTF-16 代理区（ED A0 80）不是文本", () => notText("surrogate", 0xed, 0xa0, 0x80));
  it("码点越界（F5 及以上）不是文本", () => notText("out-of-range", 0xf5, 0x80, 0x80, 0x80));
  it("截断的多字节序列不是文本", () => notText("truncated seq", 0xe4, 0xbd));
  it("控制字节密集的载荷不是文本", () => notText("control-heavy", 0x01, 0x02, 0x03, 0x04, 0x7f, 0x1b));

  it("issue #964 原始反例字节不得以 text 收下", () => {
    // 注：这串字节如今被 mp3 帧同步分支先认走（详见 PR 说明），此处只钉住「不是 text」。
    expect(declaredMimeMatchesBytes("text/plain", bytes(255, 254, 253, 252, 251, 250))).toBe(false);
  });

  it("合法 UTF-8（多字节 / 带 BOM / 含制表与换行）仍判 text", () => {
    expect(sniffMimeFamily(new TextEncoder().encode("你好，world — ☃\r\n\tok\n"))).toBe("text");
    expect(sniffMimeFamily(new TextEncoder().encode("\uFEFFname,值\n1,一\n"))).toBe("text");
    expect(declaredMimeMatchesBytes("text/markdown", new TextEncoder().encode("# 标题\n\n正文 🚀\n"))).toBe(true);
  });

  it("超过采样窗口(8KiB)的长文本仍判 text，且尾部被截断的多字节序列不误杀", () => {
    const long = new TextEncoder().encode("中".repeat(10_000)); // 30000 字节，8192 处必然切在序列中间
    expect(sniffMimeFamily(long)).toBe("text");
  });
});
