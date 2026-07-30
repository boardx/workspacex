# fabric-markdown

Markdown 中的 Mermaid 流程图 ⇄ Fabric.js 可编辑画布对象的双向转换库。

- **正向**：从 Markdown 提取 ```` ```mermaid ```` 代码块 → 解析节点/边/布局 → 生成可拖动、可编辑的 fabric 对象（拖动节点时连线自动跟随）。
- **反向**：画布对象 → mermaid flowchart 语法 → 原位写回 Markdown 文档（逻辑结构级：节点、连线、标签、形状；布局由 mermaid 在下次渲染时重新计算）。

## 架构

双向都经过共享中间表示 `DiagramModel`：

```
Markdown ⇄ mermaid 文本 ⇄ DiagramModel ⇄ Fabric 画布对象
```

| 模块 | 职责 |
|---|---|
| `model.ts` | IR 类型（`DiagramModel` / `DiagramNode` / `DiagramEdge`）与校验 |
| `markdown.ts` | mermaid 围栏块提取 / 原位替换（纯函数） |
| `mermaid-parser.ts` | mermaid 文本 → IR：`mermaid.render()` 渲染 SVG 取几何 + 内部 db 取逻辑结构（含纯 SVG 降级路径） |
| `mermaid-serializer.ts` | IR → mermaid flowchart 文本（纯函数） |
| `fabric-objects.ts` | `FlowNode`（Group：形状+标签）与 `FlowEdge`（自定义 `_render` 绘制线/箭头/标签），已注册 `classRegistry`，canvas JSON 可往返 |
| `connection-manager.ts` | 监听 `object:moving`，节点移动时按边界锚点重算连线 |
| `canvas-io.ts` | IR ⇄ 画布实例化/提取 |

## 使用

```ts
import { Canvas } from 'fabric';
import { markdownToCanvas, canvasToMarkdown } from 'fabric-markdown';

const canvas = new Canvas('canvas');

// Markdown → 画布（需要浏览器环境，mermaid 依赖真实 DOM 做文本测量）
const { model } = await markdownToCanvas(markdownText, canvas);

// …用户在画布上拖动、编辑、增删节点与连线…

// 画布 → Markdown（原位替换原文档中的 mermaid 块）
const newMarkdown = canvasToMarkdown(canvas, markdownText);
```

更细粒度的 API：`mermaidToModel` / `modelToMermaid`（mermaid 文本级）、`renderToCanvas` / `extractModel`（画布级）、`extractMermaidBlocks` / `replaceMermaidBlock`（markdown 级）。

### 画布编辑能力

- 拖动节点，连线自动跟随（直线路由 + 形状边界锚点：矩形/菱形/圆各有精确交点计算）。
- `node.setLabel()` / `edge.setLabel()` 修改标签（demo 中双击触发）。
- 新建 `FlowNode` / `FlowEdge` 加入画布即可参与导出；删除节点时由调用方级联删除关联边（见 demo）。

## 支持范围

**flowchart 流程图**
- `flowchart TD/TB/LR/RL/BT`（`graph` 同理）。
- 节点形状：`[矩形]`、`(圆角)`、`([胶囊])`、`{菱形}`、`((圆形))`；其余形状降级为矩形。
- 边：`-->`、`---`、`-.->`、`==>` 及 `|标签|`。

**classDiagram UML 类图**
- 类框带三分栏渲染（类名 / 属性 / 方法），成员完整往返。
- 关系：继承 `<|--`（空心三角）、实现 `..|>`、组合 `*--`（实心菱形）、聚合 `o--`（空心菱形）、依赖 `..>`（虚线箭头）、关联 `-->`、普通连线 `--`；方向自动归一（标记始终画在 target 端）。
- 关系标题（`: label`）与两端基数（`"1" --> "*"`）双向保留。

**stateDiagram-v2 状态图**
- 起点/终点（`[*]`）：起点渲染为实心圆点、终点为靶心，双向往返。
- 状态与带标签转移（`A --> B : 事件`）。
- `state "描述" as id` 声明：显示描述文本、导出时保留 id 与描述。

**sequenceDiagram 序列图**
- 参与者：`participant A as 别名`，渲染为参与者框 + 虚线生命线。
- 消息：实线 `->>`、虚线回复 `-->>` 及消息文本。
- 画布上参与者可水平拖动，消息线跟随生命线；导出时消息按纵向位置排序、参与者按横向位置排序。
- note / loop / activation（`+`/`-`）等控制语法暂不支持，解析时忽略。

**其余 9 种图表类型（插件架构，`src/diagrams/`）**

| 类型 | 关键字 | 画布表达与编辑语义 |
|---|---|---|
| 实体关系图 | `erDiagram` | 实体 = 分栏框（属性行），关系线双端标注基数符号（`\|\|`/`o{` 等），往返保留基数与 IDENTIFYING/NON_IDENTIFYING 线型 |
| 思维导图 | `mindmap` | 层级树节点 + 父子连线；导出按边重建缩进树，形状（圆/方/圆角）保留 |
| Git 分支图 | `gitGraph` | 提交 = 圆点（按分支分行、按 seq 排列）；导出重放 branch/checkout/commit/merge 命令序列 |
| 甘特图 | `gantt` | 任务 = 时间轴横条（26px/天），日期存 data；导出按 section 分组还原 |
| 用户旅程 | `journey` | 任务卡（评分/角色存 data），按 section 分组导出 |
| 时间线 | `timeline` | 时期 + 事件卡；导出重建 `时期 : 事件 : 事件` 行 |
| 饼图 | `pie` | 条目卡（name/value），标题/showData 存 meta |
| 四象限图 | `quadrantChart` | 象限背景 + **可拖动数据点：导出坐标按画布位置重算**（0-1 归一，保留 2 位小数） |
| XY 图表 | `xychart-beta` | 系列标签 + 值卡网格；导出按类目顺序重建 `bar [..]` / `line [..]` |

**工作坊画布模板（```` ```canvas ```` + `模板: <key>`，共 19 个）**

声明式模板引擎（`src/diagrams/template-engine.ts`）：模板 = 一份布局数据（TemplateSpec），解析/渲染/便利贴归区/序列化全部复用。文本语法：`字段: 值` + `## 段落` + `- 便利贴`。覆盖《工作坊模板 A0》全部 19 页：用户画像（`persona`，另有 ```` ```persona ```` 别名围栏）、PESTEL、SWOT、同理心地图、JTBD、用户旅程图、价值主张画布、Ad-Lib 宣言、商业模式画布、MVP 实验画布、戏剧金字塔、汉堡沟通、三地平线、HMW、黄金圈、三视角、故事板、AI 战略画布、AI 商业模型画布。自定义模板可通过 `registerTemplate(spec)` 注册。

**用户画像模板（```` ```persona ````，即 `模板: persona`）**

| 能力 | 说明 |
|---|---|
| 文本语法 | 头部 `字段: 值`（姓名/性别/年龄/区域/教育水平/职位/行业/家庭情况/收入水平）+ `## 段落名` + `- 便利贴内容`（裸段落自动合并为一张贴） |
| 画布模板 | 标题 + 信息栏（字段值双击编辑）+ 6 个锁定分区框（用户描述/目标和需求/行为与偏好/痛点和挑战/动机/影响因素，支持额外自定义段落） |
| 便利贴 | 黄色卡片自适应文本高度（CJK 逐字换行）；「＋便利贴」新增；**拖入哪个分区框，导出就归入哪个段落**（几何包含判定，框外贴归入最近框） |

不支持（解析时忽略）：subgraph、classDef/style、注解 `<<interface>>`、泛型、命名空间、gantt 的 milestone/crit 标记、gitGraph 的 cherry-pick 等高级指令。全部类型的双向转换验收记录见 [BACKLOG.md](BACKLOG.md)。

## 已知取舍

- mermaid 必须在真实浏览器中运行（`getBBox` 文本测量），本库解析侧同样要求浏览器环境；纯函数层（markdown/序列化）可在 Node 中使用。
- 反向转换为逻辑结构级：画布坐标不写入 mermaid（其语法不支持坐标），重新导入时由 mermaid 自动布局。
- 逻辑结构取自 mermaid 内部 `getDiagramFromText`（已弃用 API）：锁定 mermaid 主版本使用，并内置纯 SVG 解析降级路径。
- fabric v7 默认 center origin：`left/top` 即对象中心，本库全部按此约定实现。

## 开发

```bash
npm install
npm run dev    # demo: http://localhost:5173
npm test       # vitest 单测（纯函数层 + SVG 几何提取 fixture）
npm run build  # 库构建（ESM + d.ts）
```
