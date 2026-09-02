// 生成《WorkspaceX 端到端核心流程手工测试清单》Word 文档
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel,
  AlignmentType, WidthType, ShadingType, BorderStyle, LevelFormat, PageBreak,
  TableOfContents, Header, Footer, PageNumber, VerticalAlign,
} = require("docx");

const FONT = "Microsoft YaHei";
const OUT = process.argv[2] || "workspacex-e2e-manual-test-checklist.docx";

// ---------- 基础构件 ----------
const run = (text, opts = {}) => new TextRun({ text, font: { ascii: FONT, hAnsi: FONT, eastAsia: FONT }, size: 21, ...opts });
const p = (text, opts = {}) => new Paragraph({ spacing: { after: 120, line: 320 }, ...opts, children: Array.isArray(text) ? text : [run(text, opts.runOpts || {})] });
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 }, children: [run(t, { bold: true, size: 32, color: "1F3A5F" })] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 }, children: [run(t, { bold: true, size: 26, color: "1F3A5F" })] });
const h3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 }, children: [run(t, { bold: true, size: 22, color: "2E5C8A" })] });
const bullet = (text) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 60, line: 300 }, children: Array.isArray(text) ? text : [run(text)] });
const numbered = (text, ref) => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 60, line: 300 }, children: Array.isArray(text) ? text : [run(text)] });
const note = (text) => new Paragraph({
  spacing: { before: 80, after: 160, line: 300 },
  shading: { type: ShadingType.CLEAR, fill: "FFF7E0", color: "auto" },
  border: { left: { style: BorderStyle.SINGLE, size: 24, color: "E0A800", space: 4 } },
  indent: { left: 200, right: 200 },
  children: [run("提示：", { bold: true }), run(text)],
});
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(children, width, opts = {}) {
  const kids = Array.isArray(children) ? children : [children];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: "auto" } : undefined,
    children: kids.map((k) => (typeof k === "string" ? p(k, { spacing: { after: 40, line: 280 }, runOpts: opts.runOpts }) : k)),
  });
}

// 通用两列信息表
function infoTable(rows, widths = [2400, 7200]) {
  return new Table({
    width: { size: widths[0] + widths[1], type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, widths[0], { fill: "EAF1F8", runOpts: { bold: true } }), cell(v, widths[1])] })),
  });
}

// 用例表：编号 / 操作步骤 / 预期看到 / 结果 / 备注
const CW = [820, 3700, 3120, 760, 1200];
function caseTable(cases) {
  const header = new TableRow({
    tableHeader: true,
    children: ["编号", "操作步骤（照着做）", "预期看到（对照打勾）", "结果", "备注 / 问题编号"].map((t, i) =>
      cell(t, CW[i], { fill: "1F3A5F", runOpts: { bold: true, color: "FFFFFF" } })),
  });
  const rows = cases.map((c) => {
    const steps = c.steps.map((s, i) => p([run(`${i + 1}. `, { bold: true }), run(s)], { spacing: { after: 40, line: 280 } }));
    const expect = c.expect.map((e) => p([run("□ "), run(e)], { spacing: { after: 40, line: 280 } }));
    return new TableRow({
      cantSplit: false,
      children: [
        cell([p([run(c.id, { bold: true })], { spacing: { after: 40 } }), p(c.title, { spacing: { after: 0, line: 260 }, runOpts: { size: 18, color: "555555" } })], CW[0]),
        cell(steps, CW[1]),
        cell(expect, CW[2]),
        cell([p("□ 通过", { spacing: { after: 40 } }), p("□ 失败", { spacing: { after: 40 } }), p("□ 阻塞", { spacing: { after: 0 } })], CW[3]),
        cell("", CW[4]),
      ],
    });
  });
  return new Table({ width: { size: CW.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: CW, rows: [header, ...rows] });
}

// 模块块：标题 + 入口/前置 + 用例表
function moduleBlock(m) {
  const out = [h2(m.title)];
  if (m.intro) out.push(p(m.intro));
  out.push(infoTable([
    ["进入方式", m.entry],
    ["使用账号", m.account],
    ["开始前确认", m.precondition],
  ]));
  out.push(p(""));
  out.push(caseTable(m.cases));
  if (m.note) out.push(note(m.note));
  out.push(p(""));
  return out;
}

// ---------- 内容（见 content.js）----------
const { ENV_URL, modules } = require("./content");

// ---------- 结果汇总表 ----------
function summaryTable() {
  const W = [900, 3600, 1100, 1100, 1100, 1800];
  const header = new TableRow({ tableHeader: true, children: ["模块", "名称", "用例数", "通过", "失败/阻塞", "备注"].map((t, i) => cell(t, W[i], { fill: "1F3A5F", runOpts: { bold: true, color: "FFFFFF" } })) });
  const rows = modules.map((m) => {
    const [code, ...rest] = m.title.replace("模块 ", "").split("　");
    return new TableRow({ children: [cell(code, W[0]), cell(rest.join(""), W[1]), cell(String(m.cases.length), W[2]), cell("", W[3]), cell("", W[4]), cell("", W[5])] });
  });
  const total = modules.reduce((a, m) => a + m.cases.length, 0);
  rows.push(new TableRow({ children: [cell("合计", W[0], { runOpts: { bold: true } }), cell("", W[1]), cell(String(total), W[2], { runOpts: { bold: true } }), cell("", W[3]), cell("", W[4]), cell("", W[5])] }));
  return new Table({ width: { size: W.reduce((a, b) => a + b), type: WidthType.DXA }, columnWidths: W, rows: [header, ...rows] });
}

// ---------- 问题记录表 ----------
function issueTable() {
  const W = [900, 1100, 2600, 2600, 1300, 1100];
  const header = new TableRow({ tableHeader: true, children: ["问题编号", "用例编号", "实际看到什么", "重现步骤", "截图文件名", "严重程度"].map((t, i) => cell(t, W[i], { fill: "1F3A5F", runOpts: { bold: true, color: "FFFFFF" } })) });
  const rows = Array.from({ length: 12 }, (_, i) => new TableRow({ children: [cell(`BUG-${String(i + 1).padStart(2, "0")}`, W[0]), cell("", W[1]), cell("", W[2]), cell("", W[3]), cell("", W[4]), cell("", W[5])] }));
  return new Table({ width: { size: W.reduce((a, b) => a + b), type: WidthType.DXA }, columnWidths: W, rows: [header, ...rows] });
}

// ---------- 组装文档 ----------
const totalCases = modules.reduce((a, m) => a + m.cases.length, 0);

const cover = [
  p("", { spacing: { before: 2400 } }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run("WorkspaceX", { bold: true, size: 56, color: "1F3A5F" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run("端到端核心流程 · 手工测试清单", { bold: true, size: 40, color: "1F3A5F" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 800 }, children: [run("面向非技术测试人员 · 照着做、对照打勾、记录问题", { size: 24, color: "666666" })] }),
  infoTable([
    ["适用范围", "WorkspaceX 全站：登录/注册、组织成员、项目工作坊、对话、Skill、Agent、画布、录音转写、深度研究、访谈、问卷、任务、大脑、反馈与后台"],
    ["测试环境", `${ENV_URL}（以测试负责人给出的地址为准）`],
    ["用例数量", `${modules.length} 个模块，共 ${totalCases} 条用例`],
    ["预计用时", "完整走完约 1.5 个工作日；只走「必测」路径（第 3 章标 ★ 的模块）约 3 小时"],
    ["文档版本", "v1.0 · 2026-09-02"],
    ["测试人", "____________________"],
    ["测试日期", "____________________"],
  ], [2400, 7200]),
  pageBreak(),
];

const toc = [
  h1("目录"),
  new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-2" }),
  p("（打开文档后若目录为空：在目录上点右键 → 更新域 → 更新整个目录。）", { runOpts: { size: 18, color: "888888" } }),
  pageBreak(),
];

const chapter1 = [
  h1("1. 这份清单怎么用"),
  p("你不需要懂技术。每条用例都由三部分组成：「操作步骤」告诉你点哪里、输入什么；「预期看到」告诉你正常情况应该出现什么；「结果」由你打勾。只要实际看到的和预期不一样，就算失败，记到最后一章的问题记录表里。"),
  h2("1.1 三种结果的含义"),
  infoTable([
    ["□ 通过", "每一条「预期看到」都出现了。"],
    ["□ 失败", "有任何一条预期没出现、出现了报错、白屏、一直转圈超过 2 分钟、或者数据刷新后消失了。"],
    ["□ 阻塞", "因为前面的步骤失败或环境问题（比如登录不了、没有 AI 模型），这条根本做不了。写清楚被什么挡住。"],
  ]),
  h2("1.2 测试顺序"),
  p("模块之间有依赖：后面的模块会用到前面创建的数据。请按 A → B → C → D → E … 的顺序做。每个模块开头的「开始前确认」表格说明了需要什么前置条件。"),
  h2("1.3 遇到问题时怎么记录"),
  numbered("先截图：整个浏览器窗口都截进去，包括地址栏。文件名用「用例编号-序号」，例如 D-2-1.png。", "steps1"),
  numbered("在用例表「备注」栏写下问题编号（BUG-01、BUG-02 …）。", "steps1"),
  numbered("到第 5 章问题记录表填写：实际看到什么、怎么重现、截图文件名、严重程度。", "steps1"),
  numbered("不要试图自己修复或绕过，也不要反复重试同一个失败步骤超过 2 次；记录后继续下一条。", "steps1"),
  h2("1.4 严重程度怎么判断"),
  infoTable([
    ["高", "无法登录、数据丢失、点了按钮什么反应都没有、白屏、报错后无法继续。"],
    ["中", "功能能用但结果不对、提示文字错误、刷新后状态没保住。"],
    ["低", "排版错位、错别字、颜色不一致等不影响完成任务的问题。"],
  ]),
  h2("1.5 通用规则"),
  bullet("每做完一个会“保存”的操作（创建、改名、删除），都刷新一次浏览器，确认结果还在。这是本清单最重要的检查点。"),
  bullet("所有“等待 AI”的步骤，最多等 2 分钟（深度研究最多 15 分钟）；超过就算失败。"),
  bullet("看到「加载中…」「正在读取…」是正常的，但不应超过 10 秒。"),
  bullet("凡是标着「预览」「原型」「Kitchen Sink」的页面，不在本清单范围内，不要测。"),
  pageBreak(),
];

const chapter2 = [
  h1("2. 测试前准备"),
  h2("2.1 环境与工具"),
  infoTable([
    ["测试地址", `${ENV_URL}`],
    ["浏览器", "Chrome 或 Edge 最新版；建议用无痕窗口，避免旧登录状态干扰。"],
    ["设备", "带麦克风的电脑（模块 H 需要）；准备一张图片和一个大于 25MB 的文件（模块 D 需要）。"],
    ["邮箱", "一个能收信的新邮箱（模块 B 注册和邀请需要）。"],
    ["截图工具", "系统自带截图即可（Windows：Win+Shift+S；Mac：Cmd+Shift+4）。"],
  ]),
  h2("2.2 测试账号"),
  p("请向测试负责人索取账号。若环境已开启“开发模式预设账号”，可直接使用下表（4 个角色共用一个组织「Dev Mode Org」）："),
  new Table({
    width: { size: 9600, type: WidthType.DXA }, columnWidths: [1600, 4000, 4000],
    rows: [
      new TableRow({ tableHeader: true, children: ["角色", "邮箱", "密码"].map((t, i) => cell(t, [1600, 4000, 4000][i], { fill: "1F3A5F", runOpts: { bold: true, color: "FFFFFF" } })) }),
      ...[
        ["管理员 admin", "dev-mode-admin@workspacex.test", "DevMode-Admin-Preset-2026!"],
        ["负责人 lead", "dev-mode-lead@workspacex.test", "DevMode-Lead-Preset-2026!"],
        ["顾问 consultant", "dev-mode-consultant@workspacex.test", "DevMode-Consultant-Preset-2026!"],
        ["合规 compliance", "dev-mode-compliance@workspacex.test", "DevMode-Compliance-Preset-2026!"],
      ].map((r) => new TableRow({ children: r.map((t, i) => cell(t, [1600, 4000, 4000][i])) })),
    ],
  }),
  note("同一个账号同时在两个地方登录，先登录的那边会被踢下线，这是设计如此，不是 bug。多人一起测时请分配不同账号。"),
  h2("2.3 角色说明"),
  infoTable([
    ["管理员", "能进「后台」，管理成员、Agent、Skill、模板、反馈。"],
    ["负责人", "能创建项目（工作坊）、作为引导师管理议程环节、绑定画布。"],
    ["顾问", "普通使用者：对话、研究、访谈、问卷。用来验证“没有权限的人不该能做某事”。"],
    ["合规", "参与 Skill 评审，作为第二审核人。"],
  ]),
  h2("2.4 产品地图（认识左侧导航）"),
  new Table({
    width: { size: 9600, type: WidthType.DXA }, columnWidths: [1800, 2200, 5600],
    rows: [
      new TableRow({ tableHeader: true, children: ["导航项", "网址后缀", "是做什么的"].map((t, i) => cell(t, [1800, 2200, 5600][i], { fill: "1F3A5F", runOpts: { bold: true, color: "FFFFFF" } })) }),
      ...[
        ["对话", "/chat", "和 AI 团队聊天、附文件、挂载 skill"],
        ["项目", "/projects", "工作坊列表与工作台（七个标签页）"],
        ["研究", "/research", "深度研究：从主题到带引用的完整报告"],
        ["访谈", "/itv", "数字专家访谈：快捷访谈与五步批量访谈"],
        ["录音", "/rec", "实时录音转写与历史管理"],
        ["问卷", "/studio/survey", "问卷资源库与五步工作台、发布回收、分析"],
        ["大脑", "/brain", "组织知识库与决策台账"],
        ["任务", "/tasks", "任务看板 · 我的今天"],
        ["后台", "/admin", "Agent 目录、Skill 目录、模型、MCP、画布模板、成员配额、反馈"],
        ["头像菜单", "/profile、/org-admin", "个人资料、组织管理、退出登录"],
      ].map((r) => new TableRow({ children: r.map((t, i) => cell(t, [1800, 2200, 5600][i])) })),
    ],
  }),
  pageBreak(),
];

const chapter3 = [
  h1("3. 核心流程测试用例"),
  p("带 ★ 的模块是最核心的主线，时间不够时优先做：★A 登录、★C 项目、★D 对话、★E Skill、★H 录音、★I 研究、★K 问卷。"),
  p("每条用例的「预期看到」前面有 □，逐条核对；全部满足才在「结果」栏勾「通过」。"),
];
for (const m of modules) chapter3.push(...moduleBlock(m));
chapter3.push(pageBreak());

const chapter4 = [
  h1("4. 结果汇总"),
  p("全部做完后，把每个模块的通过/失败数填到这里，交给测试负责人。"),
  summaryTable(),
  p(""),
  h2("整体结论"),
  p("□ 全部核心流程可用，可以交付　　□ 有问题但主线可用　　□ 主线被阻断（写明阻断在哪个用例）：____________"),
  pageBreak(),
];

const chapter5 = [
  h1("5. 问题记录表"),
  p("一行一个问题。「实际看到什么」请写你眼睛看到的原话，例如“点发送后按钮变灰，30 秒没有任何回复”，不要写猜测的原因。"),
  issueTable(),
  p(""),
  h2("附：写清一个问题的例子"),
  infoTable([
    ["问题编号", "BUG-01"],
    ["用例编号", "D-4"],
    ["实际看到什么", "拖入一张 2MB 的 jpg 图片后，预览条没出现，输入框上方也没有任何提示。"],
    ["重现步骤", "1. 登录负责人账号 → 2. 对话页新建对话 → 3. 把 jpg 拖进输入框。每次都能重现。"],
    ["截图文件名", "D-4-1.png"],
    ["严重程度", "中"],
  ]),
];

const doc = new Document({
  creator: "WorkspaceX QA",
  title: "WorkspaceX 端到端核心流程手工测试清单",
  styles: {
    default: { document: { run: { font: { ascii: FONT, hAnsi: FONT, eastAsia: FONT }, size: 21 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 32, bold: true, color: "1F3A5F" }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 26, bold: true, color: "1F3A5F" }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 22, bold: true, color: "2E5C8A" }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 560, hanging: 280 } } } }] },
      { reference: "steps1", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 560, hanging: 280 } } } }] },
    ],
  },
  features: { updateFields: true },
  sections: [{
    properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run("WorkspaceX · 端到端核心流程手工测试清单 · v1.0", { size: 16, color: "888888" })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run("第 ", { size: 16, color: "888888" }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "888888", font: FONT }), run(" 页 / 共 ", { size: 16, color: "888888" }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "888888", font: FONT }), run(" 页", { size: 16, color: "888888" })] })] }) },
    children: [...cover, ...toc, ...chapter1, ...chapter2, ...chapter3, ...chapter4, ...chapter5],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log(`written ${OUT} (${buf.length} bytes), modules=${modules.length}, cases=${totalCases}`);
});
