# 陷阱 — 读代码/测试过程中发现的真实坑

## 1. 坐标绝对不能进入 mermaid 序列化输出（最容易犯的回归）

`mermaid-serializer.ts` 的所有 `*ModelToMermaid` 函数都不读 `node.x`/`node.y`。
如果以后给序列化加新字段（例如某个"记住上次手动排布"的功能），**千万不要图省事
把坐标塞进 `modelToMermaid` 的输出**——`coords-not-written-back.test.ts`（F104）
会当场变红，且这条不变量是设计决策（mermaid 语法本身没有坐标位），不是待办。
需要保留布局用 fabric 原生 JSON（见「序列化」一节），不要复用 mermaid 文本这条
逻辑 round-trip 通道。

## 2. `getDiagramFromText` 已弃用，主版本升级会无声打断整条链路

ADR-100 明确记录：库的 mermaid 解析依赖 mermaid **已弃用**的
`mermaidAPI.getDiagramFromText`，"主版本一跳，整条数据链断，而不会有任何类型
错误提示——它会在现场工作坊切环节的那一秒才显形"。这是本仓把 `mermaid`/`fabric`
锁到**确切版本**（而非 caret）的直接原因（见 `packages/fabric-markdown/package.json`）。
升级这两个依赖前，必须先跑完整测试套件（上游 222 测 + `apps/api/tests/canvas`），
且升级本身要是一次显式、带证据的动作，不能是 `pnpm install` 的副作用。

## 3. Subgraph/复合状态的三级兜底匹配是启发式，不是精确解析

`buildSubgraphNodes()` 匹配 SVG 里的 cluster 框顺序是：① id 属性匹配 → ②
标题匹配 → ③ "哪个 cluster 包含的成员节点中心最多"（面积小的优先，处理嵌套）。
这是**防御性**代码，注释里自己写着"这是启发式，不是精确匹配"——如果 mermaid
未来改变 cluster 的 SVG 结构或 id 命名规则，这三级兜底可能全部失效而不报错，
只是产生错误的分组框位置。改这块代码时不要假设某一级匹配"应该总是命中"。

## 4. `participant`（sequence 图参与者）的坐标补偿容易搞反符号

`FlowNode` 构造器对 `shape === 'participant'` 做了一次坐标补偿：`top: data.y +
lifelineLen / 2`（因为 fabric Group 的中心点是"盒子+生命线"整体的几何中心，
而 `data.y` 语义上是**盒子**的中心）。`toDiagramNode()` 与 `fromObject()` 各自
要做**反向**补偿（`c.y - L/2`、`(object['top'] - L/2)`）。三处补偿方向必须两两
对称，`fabric-objects.ts` 里已有详细注释解释每一处的符号，改动前建议先写一个
round-trip 断言（渲染→提取→坐标应与输入一致）再动手，而不是靠读代码猜符号。

## 5. `key`/`displayName` 混用是真实发生过的风险类别，不是假设性担忧

`binding-uses-key-not-displayname.test.ts`（F100）的文件头原话："O-09 留下的
真实风险不是『displayName 写错』，而是**有人拿 displayName 去当 key 用**"——
后台列表显示的是 `displayName`（比如"business-model"），如果绑定面板或 AI 生成
的 ```` ```canvas ```` 围栏把它当 `key` 发出去（真实 key 是"bmc"），**只会在
运行时报错，不会有类型错误**。所有新写的绑定/实例固化/围栏解析代码都要走
`key`，`displayName` 只应出现在纯展示层。

## 6. mermaid 白名单只挡渲染，不挡书写/保存（容易被误解成"删除"）

`mermaid-whitelist.ts` 文件头显式声明"本文件故意没有任何删除或重写围栏代码块
的函数"——组织关掉某个图表类型的渲染开关后，已经写好的对应 ```` ```mermaid ````
代码块**仍然原样保存在 Markdown 里**，只是不再被渲染成画布对象。如果需要实现
"清理被禁用类型的代码块"这类功能，那是一个新能力，不是修复这个模块的 bug——
契约明确禁止这个端点具备这个能力。

## 7. `ADR-100` 状态仍是 Proposed，不是 Accepted

写这份 Skill 时确认 `docs/adr/ADR-100-fabric-markdown.md` 头部状态字段是
"Proposed"，且文中留了一处"须人类裁决"的偏离记录（`displayName` 该不该在库内
也加一列）。引用这份 ADR 作为权威依据时如实说明它尚未正式 Accepted，不要在
后续文档里默认它已经是定案。

本轮调研范围内未发现其他需要特别记录的真实踩坑（结构性冲突合并
`conflict-resolution.ts`/`backflow.ts` 未深入逐行读取，留给实际改动那块代码时
再补充）。

## 8. 流式增量文本里的围栏必然经历「半截」中间态——校验前先看 `closed`

issue #2298（真实截图证据）：`extractMermaidBlocks`（`packages/fabric-markdown/
src/markdown.ts`）对**未闭合**的围栏（逐 token 流式过程中随时可能是这个状态）
返回「到文档结尾为止」的半截 `code`，哪怕只收到半个模板 key、一个「## 分区」
标题都还没有。任何拿这段 `code` 当**已完成文档**去跑格式校验的调用方（如
`checkCanvasFence`/`mermaid.parse`），都会把「还没写完」误判成「写完了但格式
错」，在流式尚未结束时把用户带向终态红色报错卡——报错文案里的截断值（比如
`模板「ch」`）会暴露这是个中间态,而不是真的格式错误。

修法：`MermaidBlock` 现在带 `closed: boolean`；渲染组件（`ChatCanvasFabric`/
未来任何消费 `extractMermaidBlocks` 输出的新渲染分支）必须在 `closed === false`
时**跳过校验**、停在加载态，只有围栏真正闭合后才允许判定格式对错。新写一条
围栏消费路径时，检查它有没有读这个字段——`ChatDiagramFabric`（mermaid 分支）
截至本条写下时**尚未**接这个字段，同样的中间态误判风险原则上也存在，只是还
没有被截图实测证实，改 mermaid 分支时留意。
