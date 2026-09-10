# MAAU Canvas：画布骨架 · 活动图写法 · A3 版式规格

四部分：① 文字画布的固定骨架；② ④ Workflow 的 mermaid 活动图写法；③ A3 信息图的版式规格与
HTML 骨架；④ 截图转 A3 PDF 的脚本骨架。骨架里的引导问句是给你自己看的，不要抄进回复。

## 一、文字画布骨架

### MAAU 名称

一句话概括这个最小智能体协作单元。名字要能让没参加会议的人看懂它在替谁做什么事。

### ① Intent（意图）

自问：我们要创造什么价值？为什么值得做？如何定义成功？

- **目标（Goal）**：一到两句，说清这个单元要达成的业务结果，不是要用什么技术。
- **价值（Value）**：为什么值得做——省了谁的什么、换来了什么。
- **成功指标（Success Metrics）**：2-4 条**可衡量**的指标，每条带口径（怎么算、跟谁比、
  多久看一次）。写不出口径的指标不要放进来，那是口号不是指标。

### ② User（用户）

自问：用户是谁？他们面临哪些需求或痛点？什么结果最重要？

- **用户**：具体到角色和场景，不写“所有员工”这种等于没写的范围。
- **需求**：他们要达成什么。
- **痛点**：今天卡在哪，卡的是时间、质量、成本还是信心。

### ③ Agent Team（人 + Agent）

自问：需要哪些角色？哪些工作由 Agent 完成？哪些必须由人完成？边界在哪？

| 角色 | 职责 | 是否 Agent | 决策边界 |
|---|---|---|---|

“决策边界”写的是**这个角色不能自己拍板的那一类决定**，以及越界时把事交给谁——写不出
边界的角色说明职责还没想清楚。表后单独一行：

**协作模式：** 一句话说明人与 Agent 的接力方式（谁起头、谁把关、在哪一步交回给人）。

### ④ Workflow（工作流）

一个 ```mermaid 活动图（写法见第二节），后接两张清单：

- **自动化节点**：无人值守就能跑完的步骤。
- **人工确认节点**：必须有人点头才能继续的步骤，每条附一句“为什么这一步不能自动”。

两张清单的并集必须等于流程里的全部步骤，不能有步骤两边都不在。

### ⑤ Context（上下文）

- **知识库**：需要哪些沉淀下来的资料/规范/历史案例。
- **数据源**：需要读哪些系统的哪些数据，读的是实时还是快照。
- **工具**：需要哪些工具能力（能对应到真实工具名就写真实工具名）。

### ⑥ Validation（闭环验证）

1. **能否执行？** 能不能完整跑完一次真实业务任务？说明理由；跑不完就点名卡在哪一步、缺什么。
2. **能否创造价值？** 列出可衡量指标（效率提升 / 成本降低 / 质量提升 / 收入增长 /
   用户满意度提升，按实际情况取用），每条写明**如何衡量**——基线从哪来、多久回看一次。
3. **能否持续进化？** 本次执行能沉淀哪些组织资产：Prompt / Workflow / SOP / Knowledge /
   Agent / Template / Best Practice / 数据资产。写清楚沉淀物存在哪、谁维护。

### 一句话总结

一句话描述这个 MAAU。

## 二、④ Workflow 的 mermaid 活动图写法

用 `flowchart TD`（`flowchart` 在渲染白名单内，聊天面板会把它渲染成图）。约定：

- 起止用体育场形 `([开始])` / `([结束])`。
- 普通步骤用方角 `[动宾短语]`，一步只做一件事。
- 判断用菱形 `{条件?}`，出边标 `-->|是|` / `-->|否|`。
- **自动化节点 class `auto`，人工确认节点 class `human`**，用 `classDef` 上色：
  自动化蓝、人工确认橙。这两种颜色在文字画布、SVG、A3 信息图里必须一致。

```
flowchart TD
  S([开始]) --> A1[接收会议转录]
  A1 --> A2[提炼 MAAU 六要素]
  A2 --> H1[人工确认边界与指标]
  H1 --> A3[生成画布与信息图]
  A3 --> E([结束])
  classDef auto fill:#E8F1FF,stroke:#2F6FED,stroke-width:1.5px,color:#123;
  classDef human fill:#FFF1E3,stroke:#E4801D,stroke-width:2px,color:#3A2200;
  class A1,A2,A3 auto;
  class H1 human;
```

节点标签**不要**带引号、分号、括号里的换行；中文标签里的圆括号用全角（）。

## 三、A3 版式规格（HTML）

单文件、全内联、< 2MB。竖向 A3，屏幕上固定 **1280 × 1810 px**——这个比例正是
297:420（1 : 1.4142），所以满页截图直接就是 A3 比例，嵌进 PDF 不会变形；打印时同一张纸
换成 `297mm × 420mm`，版式不变。

```html
<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>MAAU Canvas</title>
<style>
  :root{
    --auto:#2F6FED; --auto-bg:#E8F1FF; --human:#E4801D; --human-bg:#FFF1E3;
    --ink:#101828; --muted:#5B6472; --line:#D7DCE3; --paper:#FFFFFF; --band:#0F2E5C;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#8A94A6;font-family:"Noto Sans SC","PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif;color:var(--ink)}
  .sheet{width:1280px;height:1810px;background:var(--paper);display:grid;
         grid-template-rows:auto auto auto minmax(0,1fr) auto auto; /* 见下方"为什么行高不写死" */
         grid-template-columns:1fr 1fr;gap:18px;padding:36px 40px}
  .band{grid-column:1/-1;background:var(--band);color:#fff;border-radius:10px;padding:22px 28px;display:flex;flex-direction:column;justify-content:center}
  .band h1{font-size:36px;line-height:1.2;font-weight:700}
  .band p{margin-top:8px;font-size:16px;opacity:.85}
  .panel{border:1px solid var(--line);border-radius:10px;padding:18px 20px;overflow:hidden;display:flex;flex-direction:column}
  .panel.wide{grid-column:1/-1}
  .panel h2{font-size:19px;font-weight:700;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid var(--band)}
  .panel h3{font-size:13px;color:var(--muted);margin:10px 0 4px;letter-spacing:.04em}
  .panel li,.panel td,.panel p{font-size:14px;line-height:1.55}
  ul{padding-left:18px}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#F4F6F9;font-size:13px}
  .flow{display:grid;grid-template-columns:400px 1fr;gap:20px;flex:1;min-height:0}
  .flow svg{width:100%;height:100%}
  .tag{display:inline-block;border-radius:999px;padding:1px 9px;font-size:12px}
  .tag.auto{background:var(--auto-bg);color:var(--auto);border:1px solid var(--auto)}
  .tag.human{background:var(--human-bg);color:var(--human);border:1px solid var(--human)}
  .infer{color:var(--muted);font-style:italic}
  .foot{grid-column:1/-1;border-top:1px solid var(--line);padding-top:10px;font-size:11px;color:var(--muted);overflow:hidden}
  .foot pre{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;line-height:1.35}
  @media print{
    @page{size:A3 portrait;margin:0}
    body{background:#fff}
    .sheet{width:297mm;height:420mm;padding:9mm 10mm}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style></head><body><div class="sheet">
  <header class="band"><h1>{{MAAU 名称}}</h1><p>{{一句话总结}}</p></header>
  <section class="panel"><h2>① Intent 意图</h2>…</section>
  <section class="panel"><h2>② User 用户</h2>…</section>
  <section class="panel wide"><h2>③ Agent Team 人 + Agent</h2><table>…</table><p><strong>协作模式：</strong>…</p></section>
  <section class="panel wide"><h2>④ Workflow 工作流</h2>
    <div class="flow"><svg viewBox="0 0 520 {{H}}" preserveAspectRatio="xMidYMid meet">…</svg>
      <div><h3>自动化节点</h3><ul>…</ul><h3>人工确认节点</h3><ul>…</ul></div></div></section>
  <section class="panel"><h2>⑤ Context 上下文</h2>…</section>
  <section class="panel"><h2>⑥ Validation 闭环验证</h2>…</section>
  <footer class="foot">④ 的活动图 mermaid 源码（可粘贴到画布渲染）：<pre>{{mermaid 源码}}</pre></footer>
</div></body></html>
```

**为什么行高不写死**：写死过一版 `140px 300px 300px 520px 268px 120px`（六行正好凑满
1810 − padding − gap），实测渲染下来 ①②⑤⑥ 四个面板全部溢出被 `overflow:hidden` 裁掉——
真实内容的高度不是拍脑袋能算准的。现在五行按内容 `auto`、④ 那行 `minmax(0,1fr)` 吃掉剩余
空间；④ 里的活动图是 `viewBox` + `preserveAspectRatio`，分到多少高度都自动缩放。
**写完务必自己确认一次没有面板被裁**（面板的 `scrollHeight > clientHeight` 即为被裁）。

排版纪律：

- 面板放不下就**精简文字**，不要让内容溢出被 `overflow:hidden` 裁掉，也不要改 `.sheet` 的
  高度——1810px 是 A3 比例的来源，改了截图就不是 A3 了。全部 `auto` 行加起来超过 1810 时
  `minmax(0,1fr)` 会被压成 0、④ 的图消失，这也是"内容太多"的信号，要回去精简，不是加高。
- 每处推断用 `<span class="infer">（推断）</span>`，与文字画布一一对应。
- 自动化/人工两种颜色在 SVG、清单标签、③ 表格里必须是同两个变量，不要各写各的色值。

### ④ 活动图的内联 SVG 画法

在 `viewBox="0 0 520 H"` 里从上往下画，`preserveAspectRatio="xMidYMid meet"` 会把它自动
缩放到面板大小，所以**节点多少都不用改面板高度**。

- 起止：`<rect x="130" y="..." width="260" height="44" rx="22">`，填充 `#F4F6F9`、描边 `#98A2B3`。
- 步骤：`<rect x="90" y="..." width="340" height="52" rx="8">`，自动化用 `fill="#E8F1FF" stroke="#2F6FED" stroke-width="1.5"`，
  人工确认用 `fill="#FFF1E3" stroke="#E4801D" stroke-width="2"`。
- 文字：`<text x="260" y="节点中心+5" text-anchor="middle" font-size="15">`，超过 16 个字先精简，不要缩字号到看不清。
- 箭头：竖线 `<line x1="260" x2="260" stroke="#98A2B3" stroke-width="1.5" marker-end="url(#a)">`，
  在 `<defs>` 里定义一个三角 `marker id="a"`。
- 纵向节奏：起止块 44 高，步骤块 52 高，块间距 26。`H = 44 + 26 + N*(52+26) + 44`。
- 右下角放一行图例：蓝=自动化，橙=人工确认。

## 四、截图 → A3 PDF（沙箱 execute，pdf-lib 预装）

`browser_take_screenshot({fullPage:true})` 返回的 `workspacePath` 形如
`/workspace/browser-<64位 hex>.png`。把它原样填进下面的 `SHOT`，**不要自己拼路径**。

```js
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const SHOT = '/workspace/browser-<截图返回的真实路径>.png';
const OUT = '/workspace/web-artifact/maau-canvas.pdf';
// 竖向 A3 的 PDF 点尺寸（1pt = 1/72 inch）：297mm × 420mm。
const W = 841.89, H = 1190.55;
(async () => {
  const doc = await PDFDocument.create();
  const png = await doc.embedPng(fs.readFileSync(SHOT));
  // 满幅铺满：截图是 1280×1810，与 A3 同比例，所以直接拉满不会变形。
  // 比例对不上说明版式没按 1280×1810 写——回去改 HTML，不要在这里裁或留白凑数。
  const ratio = png.width / png.height, target = W / H;
  if (Math.abs(ratio - target) > 0.01) throw new Error('screenshot is not A3 portrait: ' + png.width + 'x' + png.height);
  doc.addPage([W, H]).drawImage(png, { x: 0, y: 0, width: W, height: H });
  fs.writeFileSync(OUT, await doc.save());
  console.log('PDF_OK', fs.statSync(OUT).size);
})();
```

脚本要短：只做“读 PNG → 嵌一页 → 写文件”。别在这里重画版式、别加水印和页脚——那些属于
HTML，写在这里等于同一份版式声明两次。
