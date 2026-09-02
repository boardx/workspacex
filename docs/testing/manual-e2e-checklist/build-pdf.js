// 生成《WorkspaceX 端到端核心流程手工测试清单》PDF（HTML + Chromium 排版）
// 用法：node build-pdf.js <输出.pdf> [--html 输出.html]
const fs = require("fs");
const path = require("path");
const { ENV_URL, modules, VERSION, DATE } = require("./content");

const OUT = process.argv[2] || "workspacex-e2e-manual-test-checklist.pdf";
const HTML_OUT = process.argv.includes("--html") ? process.argv[process.argv.indexOf("--html") + 1] : null;
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const totalCases = modules.reduce((a, m) => a + m.cases.length, 0);
const STAR = new Set(["A", "C", "D", "E", "H", "I", "K"]);
const modCode = (m) => m.title.replace("模块 ", "").split("　")[0];
const modName = (m) => m.title.replace("模块 ", "").split("　").slice(1).join("");

const css = `
@page { size: A4; margin: 18mm 14mm 20mm 14mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Zen Hei", sans-serif;
  font-size: 10.5pt; line-height: 1.6; color: #1f2933; margin: 0; }
h1 { font-size: 19pt; color: #1f3a5f; margin: 0 0 10pt; padding-bottom: 6pt; border-bottom: 2.5pt solid #1f3a5f; break-after: avoid; }
h2 { font-size: 14pt; color: #1f3a5f; margin: 16pt 0 8pt; break-after: avoid; }
h3 { font-size: 11.5pt; color: #2e5c8a; margin: 12pt 0 6pt; break-after: avoid; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 8pt; padding-left: 20pt; }
li { margin-bottom: 3pt; }
.chapter { break-before: page; }
.muted { color: #6b7280; font-size: 9pt; }
table { border-collapse: collapse; width: 100%; margin: 0 0 10pt; }
th, td { border: 0.6pt solid #c8ced6; padding: 5pt 6pt; vertical-align: top; text-align: left; }
th { background: #1f3a5f; color: #fff; font-weight: 600; font-size: 9.5pt; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
table.info td:first-child { background: #eaf1f8; font-weight: 600; width: 22%; white-space: nowrap; }
table.info td { font-size: 10pt; }
.note { background: #fff7e0; border-left: 4pt solid #e0a800; padding: 6pt 10pt; margin: 6pt 0 10pt; font-size: 9.5pt; border-radius: 0 3pt 3pt 0; }
.note b { color: #8a6100; }

/* 封面 */
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; }
.cover .brand { font-size: 40pt; font-weight: 700; color: #1f3a5f; letter-spacing: 1pt; text-align: center; margin-bottom: 4pt; }
.cover .title { font-size: 24pt; font-weight: 600; color: #1f3a5f; text-align: center; margin-bottom: 8pt; }
.cover .sub { font-size: 12pt; color: #6b7280; text-align: center; margin-bottom: 36pt; }
.cover .rule { width: 60mm; height: 3pt; background: #e0a800; margin: 0 auto 30pt; }
.cover table.info { width: 80%; margin: 0 auto; }
.cover table.info td:first-child { width: 28%; }

/* 目录 */
.toc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6pt 24pt; }
.toc-grid .head { font-weight: 700; color: #1f3a5f; margin-top: 8pt; grid-column: 1 / -1; }
.toc-item { display: flex; gap: 8pt; padding: 3pt 0; border-bottom: 0.4pt dotted #c8ced6; }
.toc-item .code { font-weight: 700; color: #1f3a5f; min-width: 22pt; }
.toc-item .n { margin-left: auto; color: #6b7280; font-size: 9pt; white-space: nowrap; }

/* 模块 */
.module { margin-top: 18pt; }
.module-head, table.info { break-inside: avoid; }
.module-head { break-after: avoid; }
.module-head { display: flex; align-items: baseline; gap: 10pt; border-bottom: 2pt solid #1f3a5f; padding-bottom: 5pt; margin-bottom: 8pt; }
.module-head .code { background: #1f3a5f; color: #fff; font-weight: 700; font-size: 12pt; padding: 1pt 8pt; border-radius: 3pt; }
.module-head h2 { margin: 0; font-size: 15pt; border: 0; }
.module-head .star { color: #e0a800; font-size: 13pt; }
.module-head .count { margin-left: auto; color: #6b7280; font-size: 9.5pt; }
.intro { color: #4b5563; margin-bottom: 8pt; }

/* 用例表 */
table.cases th:nth-child(1), table.cases td:nth-child(1) { width: 9%; }
table.cases th:nth-child(2), table.cases td:nth-child(2) { width: 37%; }
table.cases th:nth-child(3), table.cases td:nth-child(3) { width: 33%; }
table.cases th:nth-child(4), table.cases td:nth-child(4) { width: 9%; }
table.cases th:nth-child(5), table.cases td:nth-child(5) { width: 12%; }
table.cases td { font-size: 9.5pt; line-height: 1.5; }
table.cases tbody tr:nth-child(even) td { background: #f7f9fb; }
.cid { font-weight: 700; color: #1f3a5f; font-size: 10.5pt; }
.ctitle { color: #4b5563; font-size: 8.5pt; line-height: 1.35; margin-top: 2pt; }
ol.steps { margin: 0; padding-left: 14pt; }
ol.steps li { margin-bottom: 3pt; padding-left: 2pt; }
ul.expect { list-style: none; margin: 0; padding: 0; }
ul.expect li { position: relative; padding-left: 14pt; margin-bottom: 3pt; }
ul.expect li::before { content: ""; position: absolute; left: 0; top: 3pt; width: 8pt; height: 8pt; border: 0.8pt solid #4b5563; border-radius: 1.5pt; background: #fff; }
.result div { display: flex; align-items: center; gap: 4pt; margin-bottom: 4pt; white-space: nowrap; }
.result i { display: inline-block; width: 9pt; height: 9pt; border: 0.8pt solid #4b5563; border-radius: 1.5pt; background: #fff; }
.result .pass { color: #15803d; } .result .fail { color: #b91c1c; } .result .block { color: #a16207; }

/* 汇总与问题表 */
table.summary td:nth-child(1) { text-align: center; font-weight: 700; color: #1f3a5f; }
table.summary td:nth-child(3), table.summary td:nth-child(4), table.summary td:nth-child(5) { text-align: center; }
table.issues td { height: 34pt; }
.conclusion { border: 0.8pt solid #c8ced6; padding: 10pt 12pt; border-radius: 3pt; background: #f7f9fb; }
.conclusion div { margin-bottom: 6pt; }
.box { display: inline-block; width: 10pt; height: 10pt; border: 0.8pt solid #4b5563; border-radius: 1.5pt; background: #fff; vertical-align: -1pt; margin-right: 4pt; }
.sev { display: inline-block; padding: 0 6pt; border-radius: 3pt; color: #fff; font-weight: 600; font-size: 9pt; }
.sev.h { background: #b91c1c; } .sev.m { background: #d97706; } .sev.l { background: #4b5563; }
`;

function infoTable(rows) {
  return `<table class="info">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>`;
}

function caseTable(cases) {
  const rows = cases.map((c) => `
    <tr>
      <td><div class="cid">${esc(c.id)}</div><div class="ctitle">${esc(c.title)}</div></td>
      <td><ol class="steps">${c.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></td>
      <td><ul class="expect">${c.expect.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></td>
      <td class="result"><div class="pass"><i></i>通过</div><div class="fail"><i></i>失败</div><div class="block"><i></i>阻塞</div></td>
      <td></td>
    </tr>`).join("");
  return `<table class="cases"><thead><tr><th>编号</th><th>操作步骤（照着做）</th><th>预期看到（逐条打勾）</th><th>结果</th><th>备注 / 问题编号</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function moduleBlock(m) {
  const code = modCode(m);
  return `<section class="module">
    <div class="module-head"><span class="code">${esc(code)}</span><h2>${esc(modName(m))}</h2>${STAR.has(code) ? '<span class="star" title="必测">★ 必测</span>' : ""}<span class="count">${m.cases.length} 条用例</span></div>
    ${m.intro ? `<p class="intro">${esc(m.intro)}</p>` : ""}
    ${infoTable([["进入方式", esc(m.entry)], ["使用账号", esc(m.account)], ["开始前确认", esc(m.precondition)]])}
    ${caseTable(m.cases)}
    ${m.note ? `<div class="note"><b>提示：</b>${esc(m.note)}</div>` : ""}
  </section>`;
}

const cover = `<section class="cover">
  <div class="brand">WorkspaceX</div>
  <div class="title">端到端核心流程 · 手工测试清单</div>
  <div class="sub">面向非技术测试人员 · 照着做、对照打勾、记录问题</div>
  <div class="rule"></div>
  ${infoTable([
    ["适用范围", "WorkspaceX 全站：登录/注册、组织成员、项目工作坊、对话、Skill、Agent、画布、录音转写、深度研究、访谈、问卷、任务、大脑、反馈与后台"],
    ["测试环境", `${esc(ENV_URL)}（以测试负责人给出的地址为准）`],
    ["用例数量", `${modules.length} 个模块，共 ${totalCases} 条用例`],
    ["预计用时", "完整走完约 1.5 个工作日；只走 ★ 必测模块约 3 小时"],
    ["文档版本", `${VERSION} · ${DATE}`],
    ["测试人", "&nbsp;"],
    ["测试日期", "&nbsp;"],
  ])}
</section>`;

const toc = `<section class="chapter">
  <h1>目录</h1>
  <div class="toc-grid">
    <div class="head">第 1 章　这份清单怎么用</div>
    <div class="toc-item"><span class="code">1.1</span>三种结果的含义</div><div class="toc-item"><span class="code">1.2</span>测试顺序</div>
    <div class="toc-item"><span class="code">1.3</span>遇到问题时怎么记录</div><div class="toc-item"><span class="code">1.4</span>严重程度怎么判断</div>
    <div class="toc-item"><span class="code">1.5</span>通用规则</div><div class="toc-item"></div>
    <div class="head">第 2 章　测试前准备</div>
    <div class="toc-item"><span class="code">2.1</span>环境与工具</div><div class="toc-item"><span class="code">2.2</span>测试账号</div>
    <div class="toc-item"><span class="code">2.3</span>角色说明</div><div class="toc-item"><span class="code">2.4</span>产品地图</div>
    <div class="head">第 3 章　核心流程测试用例</div>
    ${modules.map((m) => `<div class="toc-item"><span class="code">${esc(modCode(m))}</span>${esc(modName(m))}${STAR.has(modCode(m)) ? ' <span style="color:#e0a800">★</span>' : ""}<span class="n">${m.cases.length} 条</span></div>`).join("")}
    <div class="head">第 4 章　结果汇总　　　第 5 章　问题记录表</div>
  </div>
  <p class="muted" style="margin-top:14pt">★ = 必测主线（时间不够时优先做）。页码见每页页脚。</p>
</section>`;

const chapter1 = `<section class="chapter">
  <h1>1. 这份清单怎么用</h1>
  <p>你不需要懂技术。每条用例都由三部分组成：<b>操作步骤</b>告诉你点哪里、输入什么；<b>预期看到</b>告诉你正常情况应该出现什么；<b>结果</b>由你打勾。只要实际看到的和预期不一样，就算失败，记到最后一章的问题记录表里。</p>
  <h2>1.1 三种结果的含义</h2>
  ${infoTable([
    ["<span class='box'></span>通过", "每一条「预期看到」都出现了。"],
    ["<span class='box'></span>失败", "有任何一条预期没出现、出现了报错、白屏、一直转圈超过 2 分钟、或者数据刷新后消失了。"],
    ["<span class='box'></span>阻塞", "因为前面的步骤失败或环境问题（比如登录不了、没有 AI 模型），这条根本做不了。写清楚被什么挡住。"],
  ])}
  <h2>1.2 测试顺序</h2>
  <p>模块之间有依赖：后面的模块会用到前面创建的数据。请按 A → B → C → D … 的顺序做。每个模块开头的「开始前确认」说明了需要什么前置条件。</p>
  <h2>1.3 遇到问题时怎么记录</h2>
  <ol>
    <li>先截图：整个浏览器窗口都截进去，包括地址栏。文件名用「用例编号-序号」，例如 D-2-1.png。</li>
    <li>在用例表「备注」栏写下问题编号（BUG-01、BUG-02 …）。</li>
    <li>到第 5 章问题记录表填写：实际看到什么、怎么重现、截图文件名、严重程度。</li>
    <li>不要试图自己修复或绕过，也不要反复重试同一个失败步骤超过 2 次；记录后继续下一条。</li>
  </ol>
  <h2>1.4 严重程度怎么判断</h2>
  ${infoTable([
    ["<span class='sev h'>高</span>", "无法登录、数据丢失、点了按钮什么反应都没有、白屏、报错后无法继续。"],
    ["<span class='sev m'>中</span>", "功能能用但结果不对、提示文字错误、刷新后状态没保住。"],
    ["<span class='sev l'>低</span>", "排版错位、错别字、颜色不一致等不影响完成任务的问题。"],
  ])}
  <h2>1.5 通用规则</h2>
  <ul>
    <li><b>每做完一个会“保存”的操作（创建、改名、删除），都刷新一次浏览器，确认结果还在。</b>这是本清单最重要的检查点。</li>
    <li>所有“等待 AI”的步骤，最多等 2 分钟（深度研究最多 15 分钟）；超过就算失败。</li>
    <li>看到「加载中…」「正在读取…」是正常的，但不应超过 10 秒。</li>
    <li>凡是标着「预览」「原型」「Kitchen Sink」的页面，不在本清单范围内，不要测。</li>
  </ul>
</section>`;

const accounts = [
  ["管理员 admin", "dev-mode-admin@workspacex.test", "DevMode-Admin-Preset-2026!"],
  ["负责人 lead", "dev-mode-lead@workspacex.test", "DevMode-Lead-Preset-2026!"],
  ["顾问 consultant", "dev-mode-consultant@workspacex.test", "DevMode-Consultant-Preset-2026!"],
  ["合规 compliance", "dev-mode-compliance@workspacex.test", "DevMode-Compliance-Preset-2026!"],
];
const navMap = [
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
];

const chapter2 = `<section class="chapter">
  <h1>2. 测试前准备</h1>
  <h2>2.1 环境与工具</h2>
  ${infoTable([
    ["测试地址", `<b>${esc(ENV_URL)}</b>`],
    ["浏览器", "Chrome 或 Edge 最新版；建议用无痕窗口，避免旧登录状态干扰。"],
    ["设备", "带麦克风的电脑（模块 H 需要）；准备一张图片和一个大于 25MB 的文件（模块 D 需要）。"],
    ["邮箱", "一个能收信的新邮箱（模块 B 注册和邀请需要）。"],
    ["截图工具", "系统自带截图即可（Windows：Win+Shift+S；Mac：Cmd+Shift+4）。"],
  ])}
  <h2>2.2 测试账号</h2>
  <p>请向测试负责人索取账号。若环境已开启“开发模式预设账号”，可直接使用下表（4 个角色共用一个组织「Dev Mode Org」）：</p>
  <table><thead><tr><th style="width:22%">角色</th><th style="width:40%">邮箱</th><th>密码</th></tr></thead>
  <tbody>${accounts.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
  <div class="note"><b>提示：</b>同一个账号同时在两个地方登录，先登录的那边会被踢下线，这是设计如此，不是 bug。多人一起测时请分配不同账号。</div>
  <h2>2.3 角色说明</h2>
  ${infoTable([
    ["管理员", "能进「后台」，管理成员、Agent、Skill、模板、反馈。"],
    ["负责人", "能创建项目（工作坊）、作为引导师管理议程环节、绑定画布。"],
    ["顾问", "普通使用者：对话、研究、访谈、问卷。用来验证“没有权限的人不该能做某事”。"],
    ["合规", "参与 Skill 评审，作为第二审核人。"],
  ])}
  <h2>2.4 产品地图（认识左侧导航）</h2>
  <table><thead><tr><th style="width:16%">导航项</th><th style="width:24%">网址后缀</th><th>是做什么的</th></tr></thead>
  <tbody>${navMap.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
</section>`;

const chapter3 = `<section class="chapter">
  <h1>3. 核心流程测试用例</h1>
  <p>共 ${modules.length} 个模块、${totalCases} 条用例。带 <span style="color:#e0a800">★</span> 的模块是最核心的主线，时间不够时优先做：${modules.filter((m) => STAR.has(modCode(m))).map((m) => `${modCode(m)} ${modName(m)}`).join("、")}。</p>
  <p>每条用例的「预期看到」前面有小方框，逐条核对；全部满足才在「结果」栏勾「通过」。</p>
  <h2>模块一览</h2>
  <table class="summary"><thead><tr><th style="width:10%">模块</th><th>名称</th><th style="width:10%">用例数</th><th style="width:34%">进入方式</th></tr></thead>
  <tbody>${modules.map((m) => `<tr><td>${esc(modCode(m))}${STAR.has(modCode(m)) ? ' <span style="color:#e0a800">★</span>' : ""}</td><td>${esc(modName(m))}</td><td>${m.cases.length}</td><td class="muted">${esc(m.entry.split("；")[0].replace(/（地址.*?）/g, ""))}</td></tr>`).join("")}</tbody></table>
</section>
${modules.map(moduleBlock).join("")}`;

const chapter4 = `<section class="chapter">
  <h1>4. 结果汇总</h1>
  <p>全部做完后，把每个模块的通过/失败数填到这里，交给测试负责人。</p>
  <table class="summary"><thead><tr><th style="width:9%">模块</th><th>名称</th><th style="width:11%">用例数</th><th style="width:11%">通过</th><th style="width:13%">失败/阻塞</th><th style="width:22%">备注</th></tr></thead>
  <tbody>${modules.map((m) => `<tr><td>${esc(modCode(m))}</td><td>${esc(modName(m))}</td><td>${m.cases.length}</td><td></td><td></td><td></td></tr>`).join("")}
  <tr><td><b>合计</b></td><td></td><td><b>${totalCases}</b></td><td></td><td></td><td></td></tr></tbody></table>
  <h2>整体结论</h2>
  <div class="conclusion">
    <div><span class="box"></span>全部核心流程可用，可以交付</div>
    <div><span class="box"></span>有问题但主线可用</div>
    <div><span class="box"></span>主线被阻断，阻断在用例：__________________</div>
    <div style="margin-top:10pt">测试人签名：____________________　　日期：____________________</div>
  </div>
</section>`;

const chapter5 = `<section class="chapter">
  <h1>5. 问题记录表</h1>
  <p>一行一个问题。「实际看到什么」请写你眼睛看到的原话，例如“点发送后按钮变灰，30 秒没有任何回复”，不要写猜测的原因。</p>
  <table class="issues"><thead><tr><th style="width:10%">问题编号</th><th style="width:10%">用例编号</th><th style="width:29%">实际看到什么</th><th style="width:29%">重现步骤</th><th style="width:12%">截图文件名</th><th style="width:10%">严重程度</th></tr></thead>
  <tbody>${Array.from({ length: 14 }, (_, i) => `<tr><td>BUG-${String(i + 1).padStart(2, "0")}</td><td></td><td></td><td></td><td></td><td></td></tr>`).join("")}</tbody></table>
  <h2>附：写清一个问题的例子</h2>
  ${infoTable([
    ["问题编号", "BUG-01"],
    ["用例编号", "D-4"],
    ["实际看到什么", "拖入一张 2MB 的 jpg 图片后，预览条没出现，输入框上方也没有任何提示。"],
    ["重现步骤", "1. 登录负责人账号 → 2. 对话页新建对话 → 3. 把 jpg 拖进输入框。每次都能重现。"],
    ["截图文件名", "D-4-1.png"],
    ["严重程度", "<span class='sev m'>中</span>"],
  ])}
</section>`;

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>WorkspaceX 端到端核心流程手工测试清单</title><style>${css}</style></head>
<body>${cover}${toc}${chapter1}${chapter2}${chapter3}${chapter4}${chapter5}</body></html>`;

if (HTML_OUT) fs.writeFileSync(HTML_OUT, html);

(async () => {
  const { chromium } = require("playwright-core");
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({
    path: OUT, format: "A4", printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="width:100%;font-size:7.5pt;color:#888;padding:0 14mm;font-family:'Microsoft YaHei','Noto Sans CJK SC','WenQuanYi Zen Hei',sans-serif;display:flex;justify-content:space-between"><span>WorkspaceX · 端到端核心流程手工测试清单</span><span>${VERSION} · ${DATE}</span></div>`,
    footerTemplate: `<div style="width:100%;font-size:7.5pt;color:#888;text-align:center;font-family:'Microsoft YaHei','Noto Sans CJK SC','WenQuanYi Zen Hei',sans-serif">第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>`,
    margin: { top: "18mm", bottom: "20mm", left: "14mm", right: "14mm" },
  });
  await browser.close();
  console.log(`written ${path.resolve(OUT)} modules=${modules.length} cases=${totalCases}`);
})();
