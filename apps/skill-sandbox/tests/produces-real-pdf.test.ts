/**
 * F979（design-delta skill-office-docs-node-runtime）—— `verification.md` V1-pdf
 * + V1-CP 反证。同一形态：断言落在 `src/inspect-pdf.ts` 的真解析上（`pdf-lib` 解析
 * 语法 + 扫描 content stream 里的 `Tj`/`TJ` 展示文本算子），不用"文件大小 > 0"这类断言。
 *
 * ⚠ 本文件用英文文本 + `StandardFonts`,锁的是"内置字体这条路仍然好使"。中文是
 * **另一条路**(嵌入预装 CJK 字体 + Identity-H),由 `produces-real-cjk-pdf.test.ts`
 * 单独锁——两条路的断言方式不一样(那边比对字形编号,不是读回文本),不要合并。
 */
import { describe, expect, it } from "vitest";
import { executeScript } from "../src/execute-script.js";
import { flatModulesDir } from "./support/flat-modules.js";
import { inspectPdf } from "../src/inspect-pdf.js";

const TIMEOUT_MS = 60_000;

const PDF_SCRIPT = `
const { PDFDocument, StandardFonts } = require('pdf-lib');
const fs = require('fs');

(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Quarterly Review', { x: 50, y: 720, size: 24, font });
  page.drawText('Revenue grew 18% year over year', { x: 50, y: 680, size: 12, font });

  const bytes = await doc.save();
  fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/report.pdf', bytes);
  console.log('WROTE_PDF');
})().catch((e) => { console.error(e.stack); process.exit(1); });
`;

describe("V1-pdf 沙箱产出真实 .pdf", () => {
  it("runs a pdf-lib script against the preinstalled module and returns a real PDF", async () => {
    const result = await executeScript({
      script: PDF_SCRIPT,
      timeoutMs: TIMEOUT_MS,
      preinstalledModulesDir: await flatModulesDir(),
    });

    expect(result.stderr, `script stderr:\n${result.stderr}`).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("WROTE_PDF");

    expect(result.files).toHaveLength(1);
    const file = result.files[0]!;
    expect(file.name).toBe("report.pdf");

    const bytes = Buffer.from(file.contentBase64, "base64");
    expect(bytes.length).toBe(file.sizeBytes);

    const inspection = await inspectPdf(bytes);
    expect(inspection.pageCount).toBe(1);
    expect(inspection.textRuns).toContain("Quarterly Review");
    expect(inspection.textRuns).toContain("Revenue grew 18% year over year");
  }, TIMEOUT_MS);

  it("proves pdf-lib is preinstalled rather than fetched — no module dir means an honest failure", async () => {
    const result = await executeScript({ script: PDF_SCRIPT, timeoutMs: TIMEOUT_MS });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("MODULE_NOT_FOUND");
  }, TIMEOUT_MS);
});

describe("V1-CP 反证：V1-pdf 的断言必须能红", () => {
  it("rejects an empty file", async () => {
    await expect(inspectPdf(Buffer.alloc(0))).rejects.toThrow(/No PDF header found/);
  });

  it("rejects arbitrary non-pdf bytes", async () => {
    await expect(inspectPdf(Buffer.from("this is definitely not a pdf", "utf8"))).rejects.toThrow(
      /No PDF header found/,
    );
  });

  it("rejects a truncated/corrupt PDF (valid header, invalid object syntax)", async () => {
    // PDF 不是 zip/OOXML，所以这里没有"合法 OOXML 但类型不对"那种反证形状——改用
    // "PDF 头部合法但对象语法被截断"，逼 pdf-lib 的 { throwOnInvalidObject: true }
    // 真的抛错，证明 inspectPdf 不是只看开头几个字节就放行。
    const truncated = Buffer.from("%PDF-1.7\n%\xc7\xec\x8f\xa2\n1 0 obj\n<< /Type /Catalog", "latin1");
    await expect(inspectPdf(truncated)).rejects.toThrow(/Trying to parse invalid object/);
  });

  it("rejects a well-formed PDF with zero pages", async () => {
    const result = await executeScript({
      script: `
        const { PDFDocument } = require('pdf-lib');
        const fs = require('fs');
        (async () => {
          const doc = await PDFDocument.create();
          // 故意不 addPage()。pdf-lib 的 save() 默认在零页时自动插入一张空白页
          // (addDefaultPage: true,读 PDFDocument.js 源码确认),必须显式关掉才能
          // 真的产出一份零页 PDF——否则这条反证根本没法构造出待拒绝的输入。
          const bytes = await doc.save({ addDefaultPage: false });
          fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/empty.pdf', bytes);
          console.log('WROTE');
        })().catch((e) => { console.error(e.stack); process.exit(1); });
      `,
      timeoutMs: TIMEOUT_MS,
      preinstalledModulesDir: await flatModulesDir(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const bytes = Buffer.from(result.files[0]!.contentBase64, "base64");
    await expect(inspectPdf(bytes)).rejects.toThrow(/PDF has zero pages/);
  }, TIMEOUT_MS);
});
