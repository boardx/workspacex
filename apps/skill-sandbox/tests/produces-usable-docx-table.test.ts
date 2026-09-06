/**
 * Word 表格必须带宽度（2026-09-06 实测，人类要求"Word/Excel/PPT 也测一遍中文"时发现）。
 *
 * 症状：照 SKILL.md 原样建的表，文字**全对**（中文、生僻字、数字、英文都没问题），
 * 但 Word 按 `auto` 布局排——中文列被挤成**一字一行的竖条**，整张表没法看。
 * 这不是中文的问题（英文表也会中招），但中文更容易触发：一个汉字比一个字母宽得多。
 *
 * ⚠ 判据落在**产出文件的 OOXML** 上，不是"库调用时有没有传参数"：
 *   `w:tblW`（表宽）与 `w:gridCol`（列宽栅格）必须真的出现在 document.xml 里。
 *   docx 库的参数名改过、默认值也变过，只有落到文件里的那份 XML 才是用户看到的东西。
 *
 * 反证：同一段脚本去掉宽度，断言必须变红。
 */
import { describe, expect, it } from "vitest";
import { executeScript } from "../src/execute-script.js";
import { flatModulesDir } from "./support/flat-modules.js";
import { unzip } from "../src/ooxml.js";

const TIMEOUT_MS = 60_000;

const docxScript = (withWidth: boolean) => `
const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType } = require('docx');
const fs = require('fs');

const cell = (text) => new TableCell({
  ${withWidth ? "width: { size: 33, type: WidthType.PERCENTAGE }," : ""}
  children: [new Paragraph(text)],
});

const doc = new Document({
  sections: [{
    children: [
      new Table({
        ${withWidth ? "width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [3000, 2000, 2000]," : ""}
        rows: [
          new TableRow({ children: ['指标', '本季', '同比'].map(cell) }),
          new TableRow({ children: ['营业收入（万元）', '1,284', '+18%'].map(cell) }),
        ],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/table.docx', buf);
  console.log('WROTE');
});
`;

/**
 * 从 .docx（OOXML zip）里取 `word/document.xml`。
 *
 * ⚠ 用既有的 `src/ooxml.ts` 的 `unzip`，不在这里再写一份 zip 解析——本仓栽过五次的
 *   "同一事实两处声明"。（第一版自己手写了一遍，还把 raw deflate 用成了 zlib 流，
 *   直接抛错。）
 */
function documentXml(bytes: Buffer): string {
  const entry = unzip(bytes).find((e) => e.name === "word/document.xml");
  if (!entry) throw new Error("找不到 word/document.xml —— 这不是一份合法的 .docx");
  return entry.bytes.toString("utf8");
}

async function buildTable(withWidth: boolean): Promise<string> {
  const result = await executeScript({
    script: docxScript(withWidth),
    timeoutMs: TIMEOUT_MS,
    preinstalledModulesDir: await flatModulesDir(),
  });
  expect(result.exitCode, result.stderr).toBe(0);
  const file = result.files.find((f) => f.name === "table.docx");
  expect(file).toBeTruthy();
  return documentXml(Buffer.from(file!.contentBase64, "base64"));
}

describe("Word 表格：中文列不许被挤成一字一行", () => {
  it("照 SKILL.md 教的写法建表，产出的 OOXML 里有表宽与列宽栅格", async () => {
    const xml = await buildTable(true);
    // 表宽：没有它 Word 按 auto 排，列宽由内容"猜"，中文列必被挤扁。
    expect(xml).toContain("<w:tblW");
    expect(xml).toMatch(/w:type="pct"/);
    // 列宽栅格：给出每列的实际宽度。
    expect(xml).toContain("<w:gridCol");
    // 内容仍然是对的（中文没有变成乱码），顺带锁一下。
    expect(xml).toContain("营业收入（万元）");
  }, TIMEOUT_MS);

  it("反证：不给宽度时，上面那两条断言必须落空（这正是实测到的坏文档）", async () => {
    const xml = await buildTable(false);
    const hasWidth = xml.includes("<w:tblW") && /w:type="pct"/.test(xml);
    expect(
      hasWidth,
      "不给宽度也生成了表宽声明 —— 那本条门控就没有在测真正的差别",
    ).toBe(false);
  }, TIMEOUT_MS);
});
