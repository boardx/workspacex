# MAAU Canvas：canvas 围栏 · 顺序图 · 画布骨架 · A3 版式规格

五部分：① canvas 围栏写法（默认交付）；② 工作流顺序图写法（默认交付）；③ 六节内容骨架
（两种交付共用的思考框架）；④ A3 信息图版式规格；⑤ 截图转 A3 PDF 的脚本骨架。骨架里的
引导问句是给你自己看的，不要抄进回复。

## 〇、canvas 围栏写法（默认交付 ①）

```` ```canvas ```` 围栏，首行 `模板: maau`，接两个表头字段，再接六个 `## 分区`。
每条要点单独一行 `- `，一条就是一张便签。

```
模板: maau
MAAU 名称: <一句话概括这个最小智能体协作单元>
一句话总结: <一句话描述这个 MAAU>

## 意图 Intent
- 目标：<要达成的业务结果，不写用什么技术>
- 价值：<省了谁的什么、换来了什么>
- 指标：<可衡量，带口径：怎么算、跟谁比、多久看一次>

## 用户 User
- 用户：<具体到角色和场景>
- 需求：<他们要达成什么>
- 痛点：<今天卡在哪>

## 人与 Agent 分工
- <角色>：<职责> #blue          ← Agent 用 #blue
- <角色>（人）：<职责与决策边界> #pink   ← 人用 #pink

## 工作流 Workflow
- 自动：<步骤>
- 人工确认：<步骤> #pink

## 上下文 Context
- 知识库：… / 数据源：… / 工具：…

## 闭环验证 Validation
- 能执行：… / 有价值：… / 能进化：…
```

硬约束（都是引擎的真实行为，不是风格偏好）：

- **分区名逐字用上面这六个**，不要加 ①②③ 序号。分区名匹配的最后一级兜底只剥「末尾连续
  的纯 ASCII token」，写成 `## ① 意图` 会三级全落空、那一格渲染成空白。序号由画布上的
  位置表达（左→右、上→下）。
- **每格 6-9 条封顶**。分区框放不下的便签会被截掉（引擎按框高算容量、超出直接丢），
  不是缩小也不是分页。宁可精简，不要写满。
- **便签颜色只用 `#blue`/`#pink`**（Agent / 人），其余留默认黄。颜色标签写在每行末尾。
- 一条便签一句话。长句拆成两条，不要靠标点串成一行。

## 一、工作流顺序图（默认交付 ②）

另一个 ```` ```mermaid ```` 围栏，`sequenceDiagram`。**参与者 = ③ 那一格的角色**，逐字一致；
**消息 = ④ 那一格的步骤**，一一对应。

```
sequenceDiagram
  autonumber
  participant U as 业务负责人（人）
  participant A as 方案架构师（人）
  participant T as 转录整理 Agent
  participant C as 画布生成 Agent
  U->>T: 提交会议转录
  T->>T: 提炼 MAAU 六要素
  T-->>A: 交出带（推断）标注的初稿
  Note over A: 人工确认：边界与指标
  A->>C: 确认后的六要素
  C-->>U: MAAU 画布与顺序图
  Note over U: 人工确认：价值判断
```

约定：

- **人工确认节点一律用 `Note over <参与者>: 人工确认：…`**——顺序图没有配色 class，
  `Note` 是唯一能在时间轴上标出"这里停下来等人"的原生表达。
- Agent 自己做完一步用自反消息 `X->>X: …`；交回给人用虚线 `-->>`。
- 参与者名字里的括号用全角（），不要用半角（会被 mermaid 当语法）。
- 加 `autonumber`，步骤号与 ④ 那一格的清单顺序对得上。



## 二、六节内容骨架（两种交付共用）

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

## 二·附：④ Workflow 那一格放什么

那一格是**清单**，不是图：`- 自动：<步骤>` / `- 人工确认：<步骤> #pink`，与第一节顺序图的
消息一一对应、顺序一致。工作流只有一处权威——顺序图；这一格是它在便签形态下的索引，
不是第二种画法。两边对不上就是两份事实。

## 三、A3 版式规格（HTML，按需交付）

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
  <footer class="foot">④ 的工作流顺序图 mermaid 源码（可粘贴到聊天/画布渲染）：<pre>{{mermaid 源码}}</pre></footer>
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

### ④ 的内联 SVG 画法（顺序图的静态简化）

A3 是一张纸，画不了带生命线的完整顺序图（参与者一多就横向溢出）。这里画的是**同一串
步骤的纵向简化**：顺序、自动/人工着色、条数都与顺序图逐条对应，只是把"谁发给谁"降维成
块内的一行小字（`发起方 → 接收方`）。页脚附完整的 sequenceDiagram 源码，谁要看交接关系
就去看那份——**不要**在 A3 上另画一套与顺序图不一致的流程。

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

## 四、截图 → A3 PDF（沙箱 execute，pdf-lib 预装，按需交付）

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
