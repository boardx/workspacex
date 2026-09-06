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

/**
 * 人类实测反馈（2026-08-30）：生成的文件已经能下载了，但最终回复里还整段贴着刚写
 * 的脚本——用户看到的是一屏代码，不是"我的文件在哪"。这条不是执行链路的问题（脚本
 * 确实成功跑了、文件确实产出了），是**最终回复内容**的问题：脚本对用户没有信息
 * 价值，执行完之后还留在回复里纯粹是噪音，把真正有用的"生成了什么文件"这句话淹没了。
 *
 * 放在四份 SKILL.md 共用，不是只放 pdf 那份——同样的模式（脚本执行成功后原样把
 * 代码复述一遍）对 docx/xlsx/pptx 三份同样成立，不是 pdf 独有的问题。
 */
const NO_CODE_IN_FINAL_REPLY =
  `脚本成功执行、文件生成之后，回复用户的最终消息里**不要再贴一遍这段脚本代码**——文件已经产出，用户要的是文件本身，重复贴代码只会让消息变得又长又难读，没有任何信息价值。最终回复只需要一两句话说清楚生成了什么内容、文件叫什么名字。`;

/**
 * 中文支持（2026-09-06 人类反馈：「excel/pdf/word/ppt 都要很好地支持中英文」）。
 *
 * docx / xlsx / pptx 三者都是 OOXML —— 文本以 UTF-8 存在 XML 里，中文本身**从来
 * 不会**变成乱码，与 PDF 完全不同（PDF 要把字形嵌进文件，所以那份 SKILL.md 里另有
 * 一整节讲嵌字体）。这三份这里唯一要交代的是**字体名**：OOXML 只记名字，字面由
 * 打开文件的软件提供，写一个中文机器上不存在的西文字体名会让中文走 fallback，
 * 排版忽宽忽窄。所以规则很短：要么别指定，要么指定一个中日韩机器上普遍存在的。
 */
const CJK_TEXT_NOTE = (howToSetFont: string) =>
  `中英文混排开箱即用：文件里的文本是 UTF-8，中文不会变成乱码，不需要嵌入字体（这
一点和 PDF 不同）。唯一要注意的是**字体名**——文档里只记名字，字面由打开文件的软件
提供：如果指定了一个中文机器上没有的西文字体（Calibri、Arial 之类），中文会退回
系统默认字体，同一段里宽窄不一。做法二选一：**不指定字体**（用软件默认，最省事），
或者指定一个中日韩系统上普遍存在的（Windows/WPS：\`微软雅黑\`、\`宋体\`、\`等线\`；
macOS：\`PingFang SC\`）。${howToSetFont}`;

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

## 中文支持

${CJK_TEXT_NOTE("docx 里设字体：`new TextRun({ text: '中文正文', font: '微软雅黑' })`。")}

## 明确做不到的事

- 不能编辑已存在的 \`.docx\`（只能从零创建一份新的）。
- 不支持修订记录（tracked changes）或批注。
- 不做页面级复杂排版（分栏、页眉页脚里的复杂域）。

如果用户的需求是"改一份已有文档"，如实说明这个 skill 只能从零创建，不能编辑存量
文件，请用户直接告诉你需要的完整内容。

## ⚠ 生成完成后，最终回复里不要贴代码

${NO_CODE_IN_FINAL_REPLY}

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

## 中文支持

${CJK_TEXT_NOTE("exceljs 里设字体：`cell.font = { name: '微软雅黑', size: 11 }`；中文列头记得把列宽调宽一点（`sheet.getColumn(1).width = 20`），否则会显示成 `####` 或被截断。")}

## 明确做不到的事

- 不能编辑已存在的 \`.xlsx\`（只能从零创建一份新的）。
- 不做公式求值校验——写进去的公式文本本身要写对。
- 不支持图表、数据透视表。

## ⚠ 生成完成后，最终回复里不要贴代码

${NO_CODE_IN_FINAL_REPLY}

## 预装说明

${COMMON_PREAMBLE("exceljs")}
`;

/**
 * design-delta `platform-owned-skills`（2026-08-27）—— 与上面三份同一条纪律：不碰
 * Anthropic 官方或社区 fork 的代码/提示词原文，用开源库（pptxgenjs，MIT 许可）原创
 * 撰写。F962（`skill-sandbox-execution`）已经交付了 pptx skill 的沙箱执行/隔离机制，
 * 但当时的 `SKILL.md` 正文是内联在测试/starter-pack 里的（见
 * `chat-skill-mount-produces-pptx-real-stack.test.ts` 的 `seedSkillVersion`），没有
 * 单独抽成常量——本次 backfill 是第一次需要一份"生产会真的用到"的正文，照同一份纪律
 * 补上，不重复声明一份不同的版本（测试夹具那份是精简过的最小正文，专供测试用，
 * 两者用途不同，不算同一事实两处声明）。
 */
export const PPTX_CREATE_SKILL_MD = `# 演示文稿生成（pptx-create）

用这个 skill 从零创建一份 PowerPoint 演示文稿（\`.pptx\`），适合汇报、提案、课件
这类以标题 + 要点 + 简单图形为主的幻灯片内容。

## 什么时候用

用户要一份可以在 PowerPoint/WPS/Keynote 里直接打开、演示的幻灯片文件，而不是
聊天里的一段大纲或 Markdown 列表。

## 怎么做

用 \`pptxgenjs\` 库（预装，Node.js）逐页拼幻灯片，写进
\`process.env.SKILL_SANDBOX_OUT_DIR\`，文件名以 \`.pptx\` 结尾。基本形状：

\`\`\`js
const PptxGenJS = require('pptxgenjs');
const pres = new PptxGenJS();

const slide1 = pres.addSlide();
slide1.addText('标题页', { x: 0.5, y: 0.5, fontSize: 32, bold: true });

const slide2 = pres.addSlide();
slide2.addText('要点一\\n要点二\\n要点三', { x: 0.5, y: 0.5, fontSize: 18 });

pres.writeFile({ fileName: process.env.SKILL_SANDBOX_OUT_DIR + '/output.pptx' });
\`\`\`

支持：多页幻灯片、标题/正文文本框、基础形状与文本框样式（字号/加粗/颜色/对齐）、
简单表格（\`addTable\`）、内嵌图片（PNG/JPG）。

## 中文支持

${CJK_TEXT_NOTE("pptxgenjs 里设字体：`slide.addText('中文标题', { fontFace: '微软雅黑', fontSize: 32 })`。")}

## 明确做不到的事

- 不能编辑已存在的 \`.pptx\`（只能从零创建一份新的）。
- 不支持幻灯片切换动画、母版模板复用、演讲者备注之外的复杂版式。
- 不做图表数据可视化（如果用户需要图表，说明这个 skill 只能画简单表格/文本，
  建议改用更适合数据展示的方式）。

## ⚠ 生成完成后，最终回复里不要贴代码

${NO_CODE_IN_FINAL_REPLY}

## 预装说明

${COMMON_PREAMBLE("pptxgenjs")}
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

## ⚠ 脚本要短——篇幅本身会把这次生成拖到超时

沙箱执行前，这段脚本得先由你完整写出来；脚本越长（自定义换行函数、逐条手算坐标的
装饰性排版、大段配色/样式变量……），生成它所需的时间就越长，很容易撞上这轮对话的
超时上限，用户什么都拿不到。控制篇幅的具体做法：

- 别为了"一次性用一下"去写通用的文字换行/自动排版工具函数——按用户给定的内容直接
  手算好坐标即可，不追求可复用。
- 只画用户明确要的内容。没人要的装饰（渐变、图例、页脚版权行、多套配色变量……）
  不要加，这些是让脚本变长又不产生用户价值的常见来源。
- 内容较多、排版复杂的请求，优先拆成用户能接受的更简单版式，而不是写一份几百行的
  脚本去追求"看起来精致"。

## 中文（以及日文/韩文）：必须嵌入预装字体，不能用内置字体

pdf-lib 的内置标准字体（\`StandardFonts\`）只覆盖拉丁字符（WinAnsi 编码），拿它画中文
会直接抛错或画出乱码。**只要正文里有任何一个非拉丁字符，就走下面这条路**：沙箱里
预装了一份覆盖简繁中文 + 日文 + 韩文的字体，路径在环境变量
\`process.env.SKILL_SANDBOX_CJK_FONT\` 里，配合预装的 \`@pdf-lib/fontkit\` 嵌入：

\`\`\`js
const { PDFDocument } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');

(async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // subset: true —— 只把真正用到的字形写进 PDF，一页中英混排通常只有几 KB。
  const font = await doc.embedFont(fs.readFileSync(process.env.SKILL_SANDBOX_CJK_FONT), { subset: true });

  const page = doc.addPage([595, 842]); // A4
  page.drawText('季度经营回顾', { x: 50, y: 780, size: 24, font });
  page.drawText('营收同比增长 18%（含 English 混排）', { x: 50, y: 745, size: 12, font });

  fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/report.pdf', await doc.save());
})().catch((e) => { console.error(e.stack); process.exit(1); });
\`\`\`

要点：

- 这一份字体**中英文都能画**，中英混排直接用同一个 \`font\` 就行，不需要为拉丁字符
  另外嵌一个 Helvetica。
- 只有一种字重（没有真正的粗体/斜体字面）。要强调就用更大的字号、或者在文字下面画
  一条线，**不要**去 \`embedFont(StandardFonts.HelveticaBold)\` 再拿它画中文。
- \`SKILL_SANDBOX_CJK_FONT\` 万一没有值（未配置的环境），别硬画：如实告诉用户这套
  环境缺中文字体。
- 换行要自己算：中文字符没有空格可断，一行大概能放 \`(页宽 - 左右边距) / 字号\` 个
  汉字，按内容手动切几行即可，不要为此写通用排版函数（见上一节）。

## 明确做不到的事

- 不能编辑/合并/拆分已存在的 PDF。
- 不支持表单域、OCR、数字签名。
- 中文字体只有一种字重（无粗体/斜体字面），见上。

## ⚠ 生成完成后，最终回复里不要贴代码

${NO_CODE_IN_FINAL_REPLY}

## 预装说明

${COMMON_PREAMBLE("pdf-lib")}

## ⚠ 万一报 \`Cannot find module 'pdf-lib'\`（或 \`@pdf-lib/fontkit\`）

这不是脚本写错了，也不是这次没装成功——沙箱镜像要么有这个库要么没有，不存在
"装了一半"。遇到这个错误：

- **不要**重试、不要在脚本里加 \`npm install pdf-lib\`——沙箱运行时不出网，装不出来，
  重试只会原样再失败一次，白白耗掉这轮的时间预算。
- **不要**换用其他 PDF 库（比如 pdfkit、puppeteer）去绕过去——那些同样没有预装，
  只会换一个 MODULE_NOT_FOUND。
- 如实告诉用户："当前沙箱环境缺少生成 PDF 需要的运行库，暂时无法生成，需要请管理员
  检查/重新部署沙箱环境"，不要编造一个成功的结果或假装文件已生成。
`;
