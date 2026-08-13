# VZ-02 · 聊天内 mermaid 图 → fabric 渲染 / 最大化 / 编辑 / 保存

> ADR-023 签核第 ① 件（UI）材料。本文件是**支撑材料**，不是签核本身——
> 签核动作在束级 `design-signoff.md` 第 ① 节由**人类**完成，agent 不改 status。

## 用户诉求（devapp 实测原话）
「渲染的这个图，必须要可以最大化，必须是使用 fabricjs 渲染的，修改渲染以后的内容可以保存下来。
参考 packages/fabric-markdown 的实现，把体验移植过来。」

即：气泡内的图必须是 **fabric.js 渲染**（不是 VZ-01 的静态 SVG）、可**最大化**全屏、可**编辑**、编辑可**保存**。

## 做法（复用为主，几乎不新写渲染逻辑）
| 能力 | 复用的既有实现 | 本次新增 |
| --- | --- | --- |
| mermaid → 可编辑 fabric | `@repo/fabric-markdown` `markdownToCanvas` / `renderToCanvas` | — |
| fabric → mermaid（=「保存」的产物）| `canvasToMarkdown` / `canvasToMermaid` | — |
| 适配气泡尺寸 | `fitToContent` | — |
| 围栏包成 markdown | `wrapAsMermaidBlock` / `extractMermaidBlocks` | — |
| 全屏可编辑面（拖/改标签/＋节点/删除）| `CanvasStage`（`apps/web/components/canvas/canvas-stage.tsx`，原样复用）| — |
| 白名单闸门 + 诚实错误态 | VZ-01 `resolveDiagramType` + `mermaid.parse` | 错误框结构/testid/文案原样沿用 |
| 气泡内只读 fabric 渲染 | — | `ChatDiagramFabric`（新） |
| 最大化 → 全屏可编辑 + 保存回环 | — | `ChatDiagramCanvasModal`（新） |

数据流：`AiMessage → MarkdownMessage`（切段，VZ-01 逻辑不变）`→ ChatDiagramFabric`（气泡内只读 fabric）
`→ 点「最大化」→ ChatDiagramCanvasModal`（复用 `CanvasStage`，可编辑）`→「保存」`。

## 最大化 / 编辑 / 保存 UX
- **气泡内**：fabric 只读渲染（`selection:false` + 每个对象 `selectable/evented=false`），
  右上角「最大化」按钮（`chat-diagram-maximize`）。只读是刻意的——气泡里是预览，编辑走全屏，避免误拖。
- **全屏**：`fixed inset-0` 覆盖层（`chat-diagram-canvas-modal`），顶栏最小工具条
  `选择 / ＋节点 / 删除 + 适应画布`（镜像 `CanvasStage` 支持的 `tool`，未把 便签/连线 全搬来——
  保持「最小可编辑」）。ESC 关闭。
- **保存**（`chat-diagram-save`）：`CanvasStage` 每次画布变化经 `onMarkdownChange` 吐出「编辑后的
  markdown」（就是 `canvasToMarkdown` 输出，也就是要落盘的东西）。点保存 → 右栏
  （`chat-diagram-saved-source`）显示**将被持久化的 mermaid 源** + 落「已保存 · 时间」态
  （`chat-diagram-saved`）。有新编辑会把已保存态置脏（`chat-diagram-dirty`）。

## 保存目标决策：**canvas Artifact**（真实接线，非本原型范围）
- 原型**mock 持久化**：只演示存-回环（把 `canvasToMarkdown` 的产物摆出来 + 落「已保存」态），**不接后端**。
- 真实落点 = 既有 **canvas artifact / land-as-artifact / canvas-doc** 体系：保存时把这份编辑后的
  markdown（含 mermaid 围栏）落成一个 canvas artifact，挂在消息 / 项目下，后续可再打开继续编辑。
  这是与 `CanvasStage` 已有画布文档天然同构的落点，**不新造持久化通道**。
- 待人类确认：保存是「就地覆盖原消息里的图」还是「派生一个新的 canvas artifact」（见下「待确认」①）。

## 性能
- **每张图一张 fabric 画布是重对象**。已做惰性化：`IntersectionObserver`（`rootMargin:200px`）——
  图滚进视口才开始「校验 + 建画布 + 渲染」，一屏多图不会一次性建满。
- mermaid 是重依赖，只客户端可用 → 动态 `import('mermaid')`，SSR 不触碰（与 VZ-01 一致）。

## 关键工程决定（human/coord 复核重点）
### A. 「先判后挂」——避免 fabric + React 的 removeChild 崩页（实测栽过）
fabric 会把 `<canvas>` 包进它自己造的 `.canvas-container` div、加 upper-canvas 兄弟节点，**这些不是
React 建的**。若先挂 canvas、渲染后才发现语法错、再卸载 canvas 换错误框，React reconciler 撞上
fabric 的包裹节点 → 抛 `removeChild ... not a child of this node` → **整页崩塌**（scene=error 时
连 xychart 的错误框都一起消失）。
**修法**：状态机 `validating → (valid | error)`，**先**做白名单 + `mermaid.parse` 校验（此阶段不挂任何
canvas），只有 `valid` 才把 `<canvas>` 挂进 DOM。错误内容从头到尾不碰 fabric → 无包裹节点 → 不崩。

### B. `mermaid.parse` 语法闸门，而非依赖 fabric 的解析器
fabric 的 `mermaidToModel` 比 `mermaid.parse` **宽容**——残缺围栏会解析成「部分模型」而不抛错，
直接喂 fabric 会渲成半截/空白画布，违背「诚实错误态、绝不留破损画布」。故让 fabric **只**看到已过
`mermaid.parse` 的合法源，闸门口径与 VZ-01 完全一致（同一 mermaid、同 `securityLevel:'strict'`）。

## 已知瑕疵
1. **round-trip 里 `<` 被 HTML 转义 —— 保存路径已修（main agent 决定 ④）**：mermaid 标签 `< 18 个月?` 经画布往返
   被 `canvasToMarkdown` 序列化成 `&lt; 18 个月?`。保存边界 `decodeMermaidEntities`（`apps/web/lib/chat/decode-mermaid-entities.ts`）
   在落盘前解回，**saved 截图右栏源现为 `D1{"< 18 个月?"}`**（合法 mermaid），round-trip 反证测试 4 例绿。
   **残留（诚实标注）**：画布内节点标签的**显示**仍是 `&lt; 18 个月?`——那是 `markdownToCanvas`（渲染进 fabric）阶段
   的转义，与保存路径不同源。让显示也匹配需 fabric-markdown **包级**修复（牵动其他 canvas 消费者），本次刻意不做。
   落盘的源（真实持久化的那份）已正确;画布内 `&lt;` 是纯视觉残留。
2. 气泡内只读画布固定高 320px；超大图靠 `fitToContent` 缩放适配，极端复杂图可能偏小——真实接线可给
   「按内容自适应高度」上限。

## 四个设计问题 —— main agent 已定（2026-08-12 人类授权），逐条见同目录 `SIGNOFF-INCREMENT-fabric-canvas.md`
1. **保存语义** → 派生独立 canvas artifact（不覆盖原消息，保历史不可变）。
2. **气泡内只读** → 保持（编辑走最大化，防误拖）。
3. **工具条** → 加「连线」= 选择/＋节点/连线/删除;便签不上，源码视图 fast-follow。**已落原型**。
4. **`<` 转义** → 保存边界解转义。**已落原型**（见「已知瑕疵」①）。
> 设计取舍已拍定并落进原型;**签核（status → confirmed）仍是人类动作**，过目时可驳回任一条。
