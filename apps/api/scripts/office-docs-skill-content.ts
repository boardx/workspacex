/**
 * F979(design-delta skill-office-docs-node-runtime)—— 三份新 skill 的 `SKILL.md`
 * 正文,**原创撰写**(contract.md §0/§7 的授权结论:不碰 Anthropic 官方或任何社区
 * fork 的代码/提示词原文)。与 pptx skill 走同一条路——正文会被直接拼进 chat 的
 * system prompt(`message-roundtrip.ts` 头注),模型读它、决定写什么脚本、把脚本
 * 放进 ```run_script``` 代码块,由既有沙箱执行循环接管(`run-skill-script.ts`)。
 *
 * ⚠ 单独抽出这个文件,而不是把字符串直接写死在 starter-pack 导入脚本/测试里——
 * `office-docs-starter-pack-source-guard.test.ts`(V6)与将来任何构建 starter-pack
 * JSON 的脚本都要用**同一份**正文,不重复声明(本仓栽过五次的"同一事实两处声明")。
 */

const COMMON_PREAMBLE = (lib: string) =>
  `库已预装在沙箱镜像里，不要在脚本里执行 npm install / npm install ${lib} —— 沙箱运行时不出网，装不出来，写了只会先失败一次再报错，白白浪费一次重试。`;

export const DOCX_CREATE_SKILL_MD = `# Word 文档生成（docx-create）

用这个 skill 从零创建一份 Word 文档（\`.docx\`），适合报告、纪要、说明书这类以标题
+ 段落 + 列表 + 表格为主的结构化文档。

## 什么时候用

用户要一份可以直接打开编辑的 Word 文档，而不是聊天里的一段文字或 Markdown。

## 怎么做

用 \`docx\` 库（预装，Node.js）在沙箱里拼文档结构，写进
\`process.env.SKILL_SANDBOX_OUT_DIR\`，文件名以 \`.docx\` 结尾。基本形状：

\`\`\`js
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const fs = require('fs');

const doc = new Document({
  sections: [{
    children: [
      new Paragraph({ text: '标题', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun('正文内容')] }),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/output.docx', buf);
});
\`\`\`

支持：多级标题、段落、项目符号/编号列表、表格（\`Table\`/\`TableRow\`/\`TableCell\`）、
基础字符样式（加粗/斜体/字号/颜色）。

## 明确做不到的事

- 不能编辑已存在的 \`.docx\`（只能从零创建一份新的）。
- 不支持修订记录（tracked changes）或批注。
- 不做页面级复杂排版（分栏、页眉页脚里的复杂域）。

如果用户的需求是"改一份已有文档"，如实说明这个 skill 只能从零创建，不能编辑存量
文件，请用户直接告诉你需要的完整内容。

## 预装说明

${COMMON_PREAMBLE("docx")}
`;

export const XLSX_CREATE_SKILL_MD = `# Excel 表格生成（xlsx-create）

用这个 skill 从零创建一份 Excel 工作簿（\`.xlsx\`），适合数据表、清单、带公式的
简单统计表。

## 什么时候用

用户要一份可以在 Excel/WPS/LibreOffice 里直接打开的表格文件，而不是聊天里的
Markdown 表格。

## 怎么做

用 \`exceljs\` 库（预装，Node.js）建工作簿，写进
\`process.env.SKILL_SANDBOX_OUT_DIR\`，文件名以 \`.xlsx\` 结尾。基本形状：

\`\`\`js
const ExcelJS = require('exceljs');
const wb = new ExcelJS.Workbook();
const sheet = wb.addWorksheet('Sheet1');
sheet.addRow(['列A', '列B']);
sheet.addRow(['值1', 100]);
// 公式：exceljs 只把公式文本写进单元格，不做求值——结果由打开文件的软件算。
sheet.getCell('B3').value = { formula: 'SUM(B2:B2)' };

wb.xlsx.writeFile(process.env.SKILL_SANDBOX_OUT_DIR + '/output.xlsx');
\`\`\`

支持：多个 sheet、单元格样式（字体/填色/边框/数字格式）、常见公式的**文本写入**
（\`SUM\`/\`AVERAGE\`/\`COUNT\` 等，公式语法本身要写对，因为这里不校验、不求值）。

## 明确做不到的事

- 不能编辑已存在的 \`.xlsx\`（只能从零创建一份新的）。
- 不做公式求值校验——写进去的公式文本本身要写对。
- 不支持图表、数据透视表。

## 预装说明

${COMMON_PREAMBLE("exceljs")}
`;

export const PDF_CREATE_SKILL_MD = `# PDF 文档生成（pdf-create）

用这个 skill 从零创建一份 PDF 文件（\`.pdf\`），适合排版好的说明文档、简单报告、
带基础图形/表格线条的单页或多页文档。

## 什么时候用

用户要一份 PDF，而不是可编辑的 Word/Excel 文档。

## 怎么做

用 \`pdf-lib\` 库（预装，Node.js）逐页画文本/线条，写进
\`process.env.SKILL_SANDBOX_OUT_DIR\`，文件名以 \`.pdf\` 结尾。基本形状：

\`\`\`js
const { PDFDocument, StandardFonts } = require('pdf-lib');
const fs = require('fs');

(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  page.drawText('Title', { x: 50, y: 720, size: 24, font });
  page.drawText('Body text', { x: 50, y: 680, size: 12, font });

  const bytes = await doc.save();
  fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/output.pdf', bytes);
})();
\`\`\`

支持：多页、内置标准字体（Helvetica/Times/Courier 等）的文本排版、手工画线/画框
拼出简单表格、内嵌图片（PNG/JPG）。

## ⚠ 已知限制：内置字体不支持中文

pdf-lib 的内置标准字体只覆盖拉丁字符（WinAnsi 编码）。**用户要求中文正文时，如实
告知这个限制**（内置字体画不出中文，会显示成空白或乱码），不要硬着头皮画一份坏
文件。可以建议改用 docx 或 xlsx（两者都能正常处理中文），或者明确这次只能是
英文内容。

## 明确做不到的事

- 不能编辑/合并/拆分已存在的 PDF。
- 不支持表单域、OCR、数字签名。
- 内置字体不支持中文（见上）。

## 预装说明

${COMMON_PREAMBLE("pdf-lib")}
`;
