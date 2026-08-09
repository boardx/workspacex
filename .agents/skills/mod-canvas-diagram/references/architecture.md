# 架构 — Mermaid/Fabric 渲染管线怎么接起来

## 数据链（ADR-100 决策一/二/三）

```
Markdown 正文 ⇄ ```mermaid 围栏文本 ⇄ mermaid 内部 db / 渲染 SVG
              ⇄ DiagramModel（IR，packages/fabric-markdown/src/model.ts）
              ⇄ Fabric.js 画布对象（FlowNode / FlowEdge）
```

三段转换全部集中在 `packages/fabric-markdown/src/`，**这是本仓从 2026-07-30 起源码并入
（不是 npm 依赖）的第三方库**（ADR-100，状态 Proposed）：

- `mermaid-parser.ts` — `mermaidToModel(code)`：mermaid 文本 → `DiagramModel`。
  混合策略同 `@excalidraw/mermaid-to-excalidraw`：逻辑结构（id/label/形状/边）
  取自 mermaid **已弃用**的 `mermaidAPI.getDiagramFromText`，几何（坐标/宽高）
  取自渲染出的 SVG 属性（`translate()`/`width`/`height`/`points`/`r`），刻意
  不依赖 `getBBox`，因此几何抽取本身在 jsdom 下可单测（`extractNodeGeometry`/
  `extractClusterGeometry`/`extractSequenceGeometry` 都单独导出供测试）。
  `mermaid.render()` 本身需要真实浏览器（下面「验证」一节详述）。
- `mermaid-serializer.ts` — `modelToMermaid(model)`：`DiagramModel` → mermaid 文本，
  纯函数，**故意不写坐标**（mermaid 语法本身没有坐标位，见「陷阱」）。
- `model.ts` — `DiagramModel`/`DiagramNode`/`DiagramEdge` 类型定义，13 种 mermaid
  原生图 + `template`（工作坊画布模板）+ `usecase`（自定义 UML 用例围栏）共用
  同一套 IR。`validateModel()` 查引用完整性（边必须指向存在的节点、id 不重复）。
- `canvas-io.ts` — `renderToCanvas(model, canvas)` 把 IR 实例化成可编辑的
  fabric 对象；`extractModel(canvas)` 反向把画布现状读回 IR。`ConnectionManager`
  （`connection-manager.ts`）监听 `object:moving`/`object:modified`，把边的端点
  重新贴到节点边界上——fabric 本身没有"连接器"概念，这是本仓补的。
- `fabric-objects.ts` — `FlowNode`（Group：形状 + Textbox）、`FlowEdge`
  （自定义 `FabricObject`，`_render()` 里手写连线/箭头/文字底纹）。两者都注册进
  `fabric.classRegistry`，让 `canvas.toJSON()`/`loadFromJSON()` 能带着 `nodeId`/
  `shape`/`data` 等逻辑字段一起 round-trip。

## 与 `apps/web` 的关系

`apps/web`（Next.js 前端）通过 workspace 直连消费 `@repo/fabric-markdown`
（`main: ./src/index.ts`，没有产物构建这一层）。**没有独立的画布渲染服务**——
fabric 画布对象全部在浏览器端由这个包驱动，`mermaid.render()` 依赖真实浏览器
DOM（`getBBox` 文本测量），因此 mermaid 解析这条路径无法在 Node/API 侧跑。

## 与 `apps/api` 的关系：画布数据模型分两层，不要混

1. **画布模板注册表 / 绑定 / 实例固化**（`apps/api/src/{application,domain}/canvas/`，
   `apps/api/src/infrastructure/canvas/pg-canvas-template-repository.ts`）——
   这是**服务端持久化的**画布模板生命周期（草稿→试跑→发布→归档）、议程环节绑定、
   便签级 LWW 冲突处理。它不关心 fabric 对象的像素坐标。
2. **`DiagramModel`/fabric 渲染层**（`packages/fabric-markdown`）——运行在浏览器，
   服务端不解析、不渲染 mermaid。两层通过 `key`（模板注册表）和
   ````canvas`/`persona` 围栏（`packages/fabric-markdown/src/diagrams/template-engine.ts`）
   衔接：模板的分区结构、字段定义存在契约层（`@repo/contracts` 的 `canvas` 束），
   `templateToModel()` 把围栏文本转成同一套 `DiagramModel` IR 供画布渲染。

## 纯函数降级入口（ADR-100 决策三）

`src/templates-entry.ts` 是本仓新增的**纯 Node 入口**，只激活 19 个 A0 工作坊
模板，完全不触碰 `fabric`/`mermaid`——`apps/api` 的 canvas 契约测试（`key`/
`displayName` 相关）走这个入口，不需要 jsdom。
