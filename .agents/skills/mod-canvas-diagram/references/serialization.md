# 序列化 — canvas 状态怎么存/读

## 三种序列化，三种用途，不要混着用

1. **Fabric 原生 JSON**（`canvas.toJSON()` / `canvas.loadFromJSON()`）——完整的
   画布快照，含逐像素坐标、缩放、颜色覆盖。`FlowNode.toObject()`/`fromObject()`
   与 `FlowEdge.toObject()`/`fromObject()`（`fabric-objects.ts`）各自扩展了要
   一并序列化的业务字段（`nodeId`/`shape`/`label`/`members`/`methods`/
   `lifelineHeight`/`data`，边则另加 `edgeId`/`source`/`target`/`kind`/
   `label`/`sourceLabel`/`targetLabel`/`seqY`/`x1,y1,x2,y2`）。这是**唯一**
   带精确布局信息的表示——用于"另存布局快照"这类需要保留用户手动排布的场景
   （`apps/web` 的 `canvas-save-layout`，issue #194 verification 第 3 条）。
2. **`DiagramModel` IR**（`model.ts`）——`extractModel(canvas)` 从画布现状读出，
   `renderToCanvas(model, canvas)` 反向渲染。带坐标（`x`/`y`/`width`/`height`），
   但坐标在这一层是"当前渲染用的布局"，不是需要长期保真的权威数据。
3. **mermaid 文本**（`modelToMermaid` / `mermaidToModel`）——**逻辑层
   round-trip**，故意丢弃坐标：mermaid 语法本身没有坐标位，`modelToMermaid`
   从不输出任何 x/y 数值，重新导入时坐标由 mermaid 自动布局重新计算。这是
   Markdown 正文里持久化的表示。

## 关键不变量：坐标不写回 Markdown（R7 规则②，I-9）

`apps/api/tests/canvas/coords-not-written-back.test.ts`（F104）机械钉住这条：
即使把节点在画布上大幅拖动到任意坐标再导出，`modelToMermaid` 输出的文本里
**不得**出现任何拖动后（或拖动前）的坐标数值；两次渲染坐标不同的**逻辑等价**
模型，`modelToMermaid` 必须输出逐字节相同的文本（`expect(outB).toBe(outA)`）。
"重开后位置变了"不是 bug，是正确行为——不要以它为失败判据去改这套逻辑。

## Markdown ⇄ mermaid 围栏

`wrapAsMermaidBlock`/`extractMermaidBlocks`（`markdown.ts`）负责 mermaid 代码块
在 Markdown 正文里的围栏语法（```` ```mermaid ```` ... ```` ``` ````），纯字符串
操作，round-trip 到字节级相同（F103 的 ③ 号断言）。`canvasToMarkdown(canvas,
originalMarkdown)` 把导出的 mermaid 文本换回原 Markdown 的对应围栏，**围栏之外
的正文逐字不变**——不是"重新生成整份 Markdown"，是定点替换。

`apps/api/src/domain/canvas/mermaid-whitelist.ts` 复用同一个 `extractMermaidBlocks`
做围栏扫描（而不是自己再写一个正则），这是刻意的：两个 fence 解析器同时存在
正是本仓"同一事实两处声明"漂移过的模式，见 AGENTS.md。

## 13 种 mermaid 图 + 2 种自定义围栏语言

`DiagramKind` 枚举 13 种 mermaid 原生图（flowchart/class/state/sequence/er/
mindmap/gitgraph/gantt/journey/timeline/pie/quadrant/xychart）+ `template`
（```` ```canvas ````/```` ```persona ```` 围栏，工作坊画布模板）+ `usecase`
（```` ```usecase ```` 围栏，自定义 UML 用例语法，非 mermaid 原生）。
`apps/api/tests/canvas/roundtrip-13-mermaid-diagrams.test.ts`（F103）对 13 种
mermaid 图各取一份最小夹具，逐一断言序列化含正确图头、确定性、围栏 round-trip。

## 模板身份：`key` 是唯一权威，`displayName` 只在契约层

19 个内置工作坊模板的 `key` 冻结在库源码（`registerTemplate({ key: ... })`），
`displayName` 只声明在 `@repo/contracts` 的 `BUILTIN_CANVAS_TEMPLATES`，**不回灌
进库源码**（ADR-100 决策四，未在库内加 `display_name` 列是刻意的权衡，避免
"同一事实两处声明"）。所有绑定/实例固化/围栏语法一律以 `key` 为准，`.strict()`
的 zod schema 拒绝 `displayName` 混入契约层（见「陷阱」一节）。
