/**
 * F979（design-delta skill-office-docs-node-runtime）—— `verification.md` V1-xlsx
 * + V1-CP 反证。同一形态：断言落在 `src/ooxml.ts` 的真解析上。
 *
 * ⚠ 只断言公式**文本**原样写入，不断言求值结果——contract §2 明确不做公式求值，
 * 求值交给打开文件的 Excel/LibreOffice。
 */
import { describe, expect, it } from "vitest";
import { executeScript } from "../src/execute-script.js";
import { flatModulesDir } from "./support/flat-modules.js";
import { inspectXlsx, unzip } from "../src/ooxml.js";

const TIMEOUT_MS = 60_000;

const SHEET_SCRIPT = `
const ExcelJS = require('exceljs');
const wb = new ExcelJS.Workbook();
const sheet = wb.addWorksheet('季度回顾');
sheet.addRow(['项目', '营收']);
sheet.addRow(['Q1', 100]);
sheet.addRow(['Q2', 118]);
sheet.getCell('B4').value = { formula: 'SUM(B2:B3)' };

wb.xlsx.writeFile(process.env.SKILL_SANDBOX_OUT_DIR + '/budget.xlsx')
  .then(() => console.log('WROTE_XLSX'))
  .catch((e) => { console.error(e.stack); process.exit(1); });
`;

describe("V1-xlsx 沙箱产出真实 .xlsx", () => {
  it("runs an exceljs script against the preinstalled module and returns valid OOXML", async () => {
    const result = await executeScript({
      script: SHEET_SCRIPT,
      timeoutMs: TIMEOUT_MS,
      preinstalledModulesDir: await flatModulesDir(),
    });

    expect(result.stderr, `script stderr:\n${result.stderr}`).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("WROTE_XLSX");

    expect(result.files).toHaveLength(1);
    const file = result.files[0]!;
    expect(file.name).toBe("budget.xlsx");

    const bytes = Buffer.from(file.contentBase64, "base64");
    expect(bytes.length).toBe(file.sizeBytes);

    const inspection = inspectXlsx(bytes);
    expect(inspection.sheetCount).toBe(1);
    // ⚠ 实测纠正过一版这里的断言:工作表**名字**('季度回顾')不进共享字符串表——
    // 它是 `xl/workbook.xml` 里 `<sheet name="…">` 的一个 XML 属性,`sharedStrings.xml`
    // 只收**单元格文本值**。原先按"CJK 文本理应出现在 sharedStrings"的直觉断言错了,
    // 已用真实产出的 workbook.xml 核对纠正。
    expect(inspection.sharedStrings).toContain("项目");
    expect(inspection.sharedStrings).toContain("营收");

    const entries = unzip(bytes);
    const workbookXml = entries.find((e) => e.name === "xl/workbook.xml")!.bytes.toString("utf8");
    expect(workbookXml).toContain("季度回顾");

    // 公式文本原样写入 sheet XML（不经共享字符串表，直接断言 zip 里的 sheet1.xml）。
    const sheetXml = entries.find((e) => e.name === "xl/worksheets/sheet1.xml")!.bytes.toString("utf8");
    expect(sheetXml).toContain("SUM(B2:B3)");
  }, TIMEOUT_MS);

  it("proves exceljs is preinstalled rather than fetched — no module dir means an honest failure", async () => {
    const result = await executeScript({ script: SHEET_SCRIPT, timeoutMs: TIMEOUT_MS });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("MODULE_NOT_FOUND");
  }, TIMEOUT_MS);
});

describe("V1-CP 反证：V1-xlsx 的断言必须能红", () => {
  it("rejects an empty file", () => {
    expect(() => inspectXlsx(Buffer.alloc(0))).toThrow(/no end-of-central-directory/);
  });

  it("rejects arbitrary non-zip bytes", () => {
    expect(() => inspectXlsx(Buffer.from("this is definitely not an xlsx", "utf8"))).toThrow(
      /no end-of-central-directory/,
    );
  });

  it("rejects a valid OOXML file that is not a workbook (a real .pptx)", async () => {
    const result = await executeScript({
      script: `
        const PptxGenJS = require('pptxgenjs');
        const pres = new PptxGenJS();
        pres.addSlide().addText('not a workbook', { x: 0.5, y: 0.5 });
        pres.writeFile({ fileName: process.env.SKILL_SANDBOX_OUT_DIR + '/not-a-sheet.pptx' })
          .then(() => console.log('WROTE'))
          .catch((e) => { console.error(e.stack); process.exit(1); });
      `,
      timeoutMs: TIMEOUT_MS,
      preinstalledModulesDir: await flatModulesDir(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const bytes = Buffer.from(result.files[0]!.contentBase64, "base64");
    expect(() => inspectXlsx(bytes)).toThrow(/does not declare spreadsheetml\.sheet\.main\+xml/);
  }, TIMEOUT_MS);
});
