# fabric-markdown 可视化改进需求文档 v1.0

> 目标：所有 13 种 mermaid 图 + 19 个画布模板达到「专业工具」级观感与操作体验。
> 本文档是 10 个并行改造任务的唯一需求来源；设计令牌统一从 `src/theme.ts` 引用，禁止散落硬编码颜色。

## 0. 全局设计系统（theme.ts，已就位）

- **中性色**：ink `#1e293b`（主文字/边框）、inkSoft `#64748b`（次要文字）、line `#cbd5e1`（弱分隔）、paper `#ffffff`、canvasBg `#f8fafc`
- **主色**：primary `#4f46e5`，primarySoft `#eef2ff`（默认节点底）
- **分类色板 PALETTE（8 色，饱和度统一）**：indigo `#818cf8`、pink `#f472b6`、green `#4ade80`、amber `#fbbf24`、sky `#38bdf8`、red `#f87171`、violet `#a78bfa`、teal `#2dd4d4`；对应浅底 PALETTE_SOFT（同序 `#e0e7ff #fce7f3 #dcfce7 #fef3c7 #e0f2fe #fee2e2 #ede9fe #ccfbf1`）
- **便利贴**：黄 `#fef3c7`/边 `#f59e0b`，可轮换 soft 色板
- **字体阶梯**：标题 18 bold / 分区名 14 bold / 节点正文 13 / 辅助 11；行高 1.35
- **形状规范**：节点圆角 8；卡片圆角 6；描边 1.5（强调 2）；节点内边距 ≥10
- **阴影**：节点/卡片统一 `shadow: {color:'rgba(15,23,42,0.10)', blur:6, offsetY:2}`（fabric Shadow；装饰/背景框不加）
- **连线**：默认二次贝塞尔曲线（曲率系数 0.25，可退化直线）；线色 inkSoft；箭头随线色

## 1. 系统性必修项（优先级最高）

- **S1 自动适配视图**：`canvas-io.ts` 新增 `fitToContent(canvas, {padding: 40, maxZoom: 1})`——按对象包围盒 setViewportTransform 缩放平移，使整图恰好可见；`renderToCanvas` 结束时自动调用。demo 提供「适配」「100%」「＋/－缩放」按钮 + 滚轮缩放 + 空格/右键拖拽平移（fabric viewport）。
- **S2 曲线连接**：`FlowEdge._render` 支持 `curved`（默认 true，通过 data 或构造开关）——二次贝塞尔（控制点=中点法向偏移 0.18×长度）；标签/箭头沿曲线切线取向。ConnectionManager 不变（仍传两端点）。
- **S3 视觉层级**：所有节点用 theme 令牌；主体节点带阴影；locked 装饰无阴影、低对比。

## 2. mermaid 图逐项改进

| 图 | 问题 | 改进要求 |
|---|---|---|
| flowchart | 单色扁平 | 形状按语义着色：起止(stadium)=green soft、判断(diamond)=amber soft、普通=primarySoft；阴影+圆角 8 |
| classDiagram | 分栏平淡 | 类名栏底色 primarySoft、加粗居中；成员区左对齐已好；卡片阴影 |
| state | 起止点小 | 起点/终点尺寸 ×1.3；状态框 stadium 风格化（圆角 10）|
| sequence | 生命线弱 | 参与者盒底色轮换 PALETTE_SOFT；消息标签底色 paper+细边；生命线 line 色 |
| er | 实体=类框 | 实体名栏加 teal soft 底；关系线基数标签加白底 chip |
| **mindmap（重点）** | 根节点溢出、无层级、直线、超界 | ①根=大胶囊(stadium 170×56、primary 底白字、fontSize 16 bold)；②一级分支各占 PALETTE 一色（节点 soft 底+同色边、连线同色）、子节点继承分支色淡化；③布局：右侧扇形分层（level 间距 240、叶子间距 72、父居子中点），整树垂直居中；④连线曲线必开 |
| gitgraph | 分支无标识 | 每分支一色（点+出边同色）；每泳道左侧加分支名 text 标签 + 泳道浅底横条 decoration；merge 点用菱形色点 |
| gantt | 无时间轴 | 顶部加月份/日期刻度 text 行 + 竖网格线（细 rect）；任务条按 section 轮换 PALETTE_SOFT + 同色深边；条内标签左对齐 |
| journey | 已可 | 评分色已好；卡片加阴影；section 胶囊底色用 PALETTE_SOFT 轮换 |
| timeline | 已可 | 时期胶囊按序轮换色；事件卡阴影 |
| pie | 已好 | 标签在窄扇区外移（span<0.35rad 时标签放半径 1.15 处+同色文字）；加图例列（右侧色块+名值） |
| quadrant | 已可 | 四象限底色改 PALETTE_SOFT 前 4 色 25% 透明感（直接用更浅色）；点半径 10+白描边 2 |
| xychart | 已可 | 柱加圆角(rx 3)+阴影；折线点白芯色环；y 轴加 3 条水平网格线（细 rect line 色） |

## 3. 画布模板逐项改进（template-engine + 三组 spec）

**引擎级（所有模板生效）**：
- 分区框：标题改为「顶部色条」——框顶部一条 28px 高的浅色横条（PALETTE_SOFT 按分区序轮换）+ 深色分区名居左（engine 生成 section 时输出附加装饰或由 fabric labelAlign 'top' 强化为 data.titleBar 特性，实现方式自定但需在 engine 内统一）；框体白底 line 色边 1.5、圆角 6
- 便利贴按分区轮换底色（同分区同色：黄/粉/绿/蓝循环），贴纸带阴影+左上小折角感可省略
- 字段值下加下划线（text 节点 data.underline → fabric Textbox underline），空占位 `——` 改灰色
- 标题行：主标题 20 bold + 名字 primary 色

**逐模板**：
- persona/jtbd/storyboard/hmw：header 高度自适应字段行数；字段两行间距均衡（已好，微调）
- empathy：重排为经典 X 型五区（上=想的与感受到的 全宽、左=听到的、右=看到的、中=说的与做的、下两块=痛点/收益），中心圆头像 decoration 放大 90px，整体居中对称，消除右侧溢出
- swot：四象限分别用 green/red/sky/amber soft 底色条
- bmc/ai-strategy/ai-bmc：格子标题色条按「伙伴/活动/价值/关系/客户」语义分组着色；底部两条用中性灰条
- journey-map：5 泳道左侧加竖排泳道名色块（替代顶部标题），行底交替极浅灰
- value-proposition：方/圆装饰加粗到 stroke 2、方区三框与圆区三框分别用 sky/amber soft 色条；中间 ⇄ 放大
- freytag：加金字塔折线 decoration（用 4-5 段细长旋转 rect 不可行则用阶梯状细 rect 段近似的山形基线），6 框按剧情起伏微调 y 展现弧线感
- burger：汉堡装饰改 3 层圆角 rect + 芝麻点（小 circle×5），层色 amber/brown 近似色；5 层框左端与汉堡层高对齐
- golden-circle/three-lenses：圆装饰配 PALETTE_SOFT 三色半透明底（直接浅色实底即可）；右侧框标题条同色呼应
- three-horizons：三列顶部加 H1/H2/H3 色条（green/amber/sky）；右侧三框同色呼应

## 4. Demo 重设计（demo/index.html + main.ts）

**布局**：三栏——左侧 240px 模板库侧栏（分类分组：流程与结构 / 数据图表 / 工作坊画布，列表项=名称+小图标 emoji，点击即载入示例并**自动转换到画布**）；中间画布区（占满）；右侧可折叠 Markdown 面板（360px，含「应用到画布」「从画布更新」两按钮）。
**顶部工具栏**：Logo+标题 | 画布操作组（＋节点 ＋便利贴 连线 删除）| 视图组（适配 100% ＋ －）| 导出组（复制 Markdown）。
**交互**：滚轮缩放（以指针为中心）、Alt/空格拖拽平移、双击编辑保留、选中对象 Delete 键删除；切换示例自动 fitToContent；状态栏保留（左：状态信息，右：当前模板名+缩放比）。
**观感**：浅灰画布底+细网格保留；工具栏白底细分割线；按钮统一 8px 圆角、hover 态；侧栏当前项高亮 primarySoft。
**空态**：初始载入自动展示流程图示例（无需手动点击）。

## 5. 验收标准（每个任务必须满足）

1. `npx tsc --noEmit` 零错误；对应测试文件全绿（视觉常量变化允许改断言，但逻辑断言不得删除）
2. 双向转换字节级 round-trip 不回归（改视觉不改语义/坐标导出逻辑；坐标可变但导出内容不变）
3. 所有颜色从 `src/theme.ts` 引用
4. 不修改本任务文件清单之外的文件
