# 身份 — Mermaid 节点 ⇄ Fabric 对象的稳定映射

## 节点/边 id 是唯一权威身份，跨三种表示不变

`DiagramNode.id` / `DiagramEdge.id`（`model.ts`）是整条数据链里**唯一**的稳定身份：
mermaid 解析出来的顶点 id、`FlowNode.nodeId`、`FlowEdge.edgeId`/`source`/`target`
全部复用同一个字符串，不为画布对象另发一套 UUID。

- **mermaid → IR**：`mermaid-parser.ts` 直接拿 mermaid db 的顶点/状态/参与者 id
  作为 `DiagramNode.id`（`readDb`/`classModelFromDb`/`stateModelFromDb`/
  `sequenceModelFromDb` 都是如此）；SVG 兜底路径（`structureFromSvg`）用
  `NODE_ID_RE` 从 `g.node` 的 `id` 属性反解出同一个逻辑 id
  （`...flowchart-<id>-<n>` / `classId-<id>-<n>` / `state-<id>-<n>`）。
- **IR → fabric**：`canvas-io.ts` 的 `renderToCanvas` 把 `DiagramNode.id` 原样
  写进 `FlowNode.nodeId`；`ConnectionManager` 全程按 `nodeId` 查找端点节点，
  从不按对象引用或数组下标匹配。
- **fabric → IR**：`FlowNode.toDiagramNode()`/`FlowEdge.toDiagramEdge()` 把
  `nodeId`/`edgeId` 原样吐回去，`extractModel()` 组装时用 `nodeId` 集合过滤
  "端点节点已被删除的悬挂边"。
- **IR → mermaid（导出）**：`mermaid-serializer.ts` 的 `sanitizeNodeId()` 会为
  **导出文本里的 token** 生成一个 mermaid 合法的安全 id（非字母数字字符替换成
  `_`），但这只影响序列化输出的 token 拼写，`idMap: Map<原始id, 安全id>`
  两边都保留，不改变 `DiagramNode.id` 本身——身份的权威值从不因为导出而改变。

## 子图（subgraph）与复合状态是派生身份，不是普通节点

- Flowchart 的 subgraph 会被 `buildSubgraphNodes()` 合成两个**locked**衍生节点：
  `subgraph:<sgId>`（背景框）与 `subgraphTitle:<sgId>`（标题文字），`sgId` 来自
  mermaid `getSubGraphs()` 的原始 id。导出时 `flowchartModelToMermaid` 反过来
  按几何包含关系（节点中心是否落在框内）重新计算成员归属，而不是读存量的
  `data.members` 列表——**拖节点进出框会真实影响导出结果**。
- 复合状态（`state X { ... }`）在 mermaid SVG 里渲染成
  `g.statediagram-cluster`，没有 `g.node`——它的内部子状态被"拉平"进普通节点
  列表（`stateModelFromDb` 里的 `pushState` 递归），但分组框本身**不导入**，
  也就没有对应的稳定身份对象。

## 序列化图形对象的类身份（`fabric.classRegistry`）

`FlowNode`/`FlowEdge` 各自声明 `static override type`（`'flowNode'`/`'flowEdge'`），
并 `classRegistry.setClass(...)` 注册。这是 fabric 自身的类型系统，与业务层的
`nodeId`/`edgeId` 是两回事：`classRegistry` 决定 `canvas.loadFromJSON()` 时
JSON 里 `type: "flowNode"` 该实例化成哪个类；`nodeId`/`edgeId` 决定"这是哪个
逻辑节点/边"。改动这两个类名会破坏历史序列化数据的反序列化，改动前需确认没有
持久化过的 canvas JSON 依赖旧类名。
