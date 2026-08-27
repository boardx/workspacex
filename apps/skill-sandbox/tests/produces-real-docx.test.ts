/**
 * F979（design-delta skill-office-docs-node-runtime）—— `verification.md` V1-docx
 * + V1-CP 反证。同 `produces-real-pptx.test.ts` 同一形态：断言全部落在
 * `src/ooxml.ts` 的真解析上（解 zip、验 Content_Types、解 `word/document.xml`、
 * 读 `<w:t>` 文本节点），不用"文件大小 > 0"这类断言。
 */
import { describe, expect, it } from "vitest";
import { executeScript } from "../src/execute-script.js";
import { flatModulesDir } from "./support/flat-modules.js";
import { inspectDocx } from "../src/ooxml.js";

const TIMEOUT_MS = 60_000;

/**
 * 刻意写成"模型将来会写出来的脚本"的形态：`require('docx')`（预装，不 npm install），
 * 写进 `SKILL_SANDBOX_OUT_DIR`。
 */
const DOC_SCRIPT = `
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const fs = require('fs');

const doc = new Document({
  sections: [{
    children: [
      new Paragraph({ text: '季度回顾', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun('营收同比增长 18%')] }),
      new Paragraph({ text: '下一步', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun('把 Word 生成接上真实执行')] }),
    ],
  }],
});

Packer.toBuffer(doc)
  .then((buf) => {
    fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/report.docx', buf);
    console.log('WROTE_DOCX');
  })
  .catch((e) => { console.error(e.stack); process.exit(1); });
`;

describe("V1-docx 沙箱产出真实 .docx", () => {
  it("runs a docx script against the preinstalled module and returns valid OOXML", async () => {
    const result = await executeScript({
      script: DOC_SCRIPT,
      timeoutMs: TIMEOUT_MS,
      preinstalledModulesDir: await flatModulesDir(),
    });

    expect(result.stderr, `script stderr:\n${result.stderr}`).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("WROTE_DOCX");

    expect(result.files).toHaveLength(1);
    const file = result.files[0]!;
    expect(file.name).toBe("report.docx");

    const bytes = Buffer.from(file.contentBase64, "base64");
    expect(bytes.length).toBe(file.sizeBytes);

    const inspection = inspectDocx(bytes);
    const text = inspection.textRuns.filter((t) => t.trim() !== "");
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("季度回顾");
    expect(text).toContain("把 Word 生成接上真实执行");
  }, TIMEOUT_MS);

  it("proves docx is preinstalled rather than fetched — no module dir means an honest failure", async () => {
    const result = await executeScript({ script: DOC_SCRIPT, timeoutMs: TIMEOUT_MS });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("MODULE_NOT_FOUND");
  }, TIMEOUT_MS);
});

describe("V1-CP 反证：V1-docx 的断言必须能红", () => {
  it("rejects an empty file", () => {
    expect(() => inspectDocx(Buffer.alloc(0))).toThrow(/no end-of-central-directory/);
  });

  it("rejects arbitrary non-zip bytes", () => {
    expect(() => inspectDocx(Buffer.from("this is definitely not a docx", "utf8"))).toThrow(
      /no end-of-central-directory/,
    );
  });

  it("rejects a valid OOXML file that is not a Word document (a real .pptx)", async () => {
    // 复用 pptx 那条脚本产出一个真实、结构合法的 OOXML zip——但它是 presentation
    // 不是 document，证明 inspectDocx 真的在检查"是不是 Word"，不是"是不是任何 zip"。
    const result = await executeScript({
      script: `
        const PptxGenJS = require('pptxgenjs');
        const pres = new PptxGenJS();
        pres.addSlide().addText('not a word doc', { x: 0.5, y: 0.5 });
        pres.writeFile({ fileName: process.env.SKILL_SANDBOX_OUT_DIR + '/not-a-doc.pptx' })
          .then(() => console.log('WROTE'))
          .catch((e) => { console.error(e.stack); process.exit(1); });
      `,
      timeoutMs: TIMEOUT_MS,
      preinstalledModulesDir: await flatModulesDir(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const bytes = Buffer.from(result.files[0]!.contentBase64, "base64");
    expect(() => inspectDocx(bytes)).toThrow(/does not declare wordprocessingml\.document\.main\+xml/);
  }, TIMEOUT_MS);
});
