---
status: confirmed
signoff_gate: contract-bundle chat-visualization · 第 ① 件 UI（增量）
confirmed_by: usam.shen@gmail.com
confirmed_at: "2026-08-13"
confirmed_via: "批准第一版口径：气泡内只读 fabric 渲染 + 最大化全屏可编辑（复用 CanvasStage）+ 保存落 canvas artifact + 错误态沿用 VZ-01 契约。"
---

# ① UI 签核**增量** —— chat 内 mermaid 图改 fabric.js 渲染 / 最大化 / 编辑 / 保存

> 交 coord-main「按备妥材料先行」，人类过目后补签（夜间全权，见 2026-08-11 通告）。
> 这是对已落地的 chat 可视化线（VZ-01 静态 SVG 渲染 · #1020/#1023、VZ-02 prompt 指引 · #1053）的
> **增量**：只改**同一张气泡内图**的渲染方式与交互，其余 chat / markdown 行为不变。
> 支撑材料（逐条设计取舍、七态映射、testid、已知瑕疵）见同目录 `design-note.md` 与 `README.md`——
> 本文件是**增量框**，不重复其内容。

## 变更点（人类 devapp 实测原话起）
「渲染的这个图，必须要可以**最大化**，必须是使用 **fabricjs** 渲染的，修改渲染以后的内容可以**保存**下来。
参考 packages/fabric-markdown 的实现，把体验移植过来。」

即把气泡内的图从 VZ-01 的**静态 SVG** 换成 **fabric.js 渲染**，且可**最大化全屏 → 编辑 → 保存**。

## 第一版口径（原型默认，逐条待人类拍板）
- 气泡内 = **fabric.js 只读渲染**（`selection:false`，防误拖）；右上角「最大化」入口。
- 最大化 = `fixed inset-0` 全屏**可编辑**画布，**复用既有 `CanvasStage`**（不新造渲染逻辑）。
- 最小工具条：**选择 / ＋节点 / 连线 / 删除 + 适应画布**（`CanvasStage` 另支持 便签/源码视图，本版未暴露——见决定 ③）。
- 保存 → 右栏显示**将被持久化的 mermaid 源**（`canvasToMarkdown` 产物）+ 落「已保存 · 时间」态；
  有新编辑置脏。**保存目标 = canvas artifact**（复用既有 land-as-artifact / canvas-doc 体系，不新造持久化通道）。
- 渲染改 fabric，但**错误态契约逐字沿用 VZ-01**：白名单闸门 + `mermaid.parse` + 诚实错误框 + 回显原文 + 不崩。

## 截图（本目录）
| 文件 | 场景 |
|---|---|
| `VZ-02-bubble-default.png` | 气泡内 fabric 只读渲染（用户诉求「必须用 fabricjs」） |
| `VZ-02-modal-editable.png` | 最大化 → 全屏可编辑画布（「必须可最大化」+「可编辑」） |
| `VZ-02-modal-after-edit.png` | 编辑后（＋节点，未保存 → 「有未保存的改动」） |
| `VZ-02-modal-saved.png` | 保存后（「已保存」+ 右栏将落盘的 mermaid 源） |
| `VZ-02-error-box.png` | 越界/语法错 mermaid → 诚实错误框，无破损画布、页面不崩 |

无鉴权预览路由：`/preview/chat-diagram-fabric?scene=fabric|error`（mock，不接后端）。

## 活实现与证据（非原型 mock 的部分）
- 新组件：`apps/web/components/chat/chat-diagram-fabric.tsx`（气泡内只读 fabric）、
  `chat-diagram-canvas-modal.tsx`（全屏可编辑 + 保存回环，复用 `components/canvas/canvas-stage.tsx`）。
- 接线：`apps/web/components/chat/markdown-message.tsx` 把 mermaid 段从 VZ-01 的 `MermaidDiagram` 换成 `ChatDiagramFabric`。
- 渲染/序列化全部复用 `@repo/fabric-markdown`（`markdownToCanvas` / `canvasToMarkdown` / `fitToContent`），本次未新写渲染逻辑。
- 取证脚本：`apps/web/e2e/vz-fabric-shots.spec.ts` + `playwright.vzfabric.config.ts`（对预热 server 出上述 5 图）。
- 残留验证缺口：活链路（登录会话内真气泡渲染 fabric）需人不能代登的登录态，按通告 PR 前做真栈验证。

## 关键工程决定（human/coord 复核重点，详见 design-note A/B 节）
- **「先判后挂」**：先做白名单 + `mermaid.parse` 校验（此阶段不挂任何 canvas），只有 `valid` 才把 `<canvas>` 挂进 DOM。
  规避 fabric 造的 `.canvas-container` 包裹节点撞 React reconciler → `removeChild ... not a child` **整页崩塌**（实测栽过）。
- **惰性化**：`IntersectionObserver`（图滚进视口才建画布），一屏多图不一次性建满重对象。

## 四个设计问题 —— main agent 已定（2026-08-12 人类授权「main agent 来做决定」）
> 以下 4 条**设计取舍**由 main agent 拍定并已落进原型;**签核动作（status: pending → confirmed）仍是人类的**，
> 人类过目时若不认同任一条可驳回重议。

1. **保存语义 → 派生独立 canvas artifact（不覆盖原消息）**。AI 消息是不可变历史，就地覆盖会篡改
   「AI 说过的话」、破坏审计链;用户「保存下来」的本质是「留下来、以后继续编辑」，派生一个挂在项目/消息下的
   canvas artifact（复用既有 land-as-artifact/canvas-doc）正好满足，且不新造持久化通道。原图保留，保存产出
   带「派生自这条消息的图」溯源。**后端契约影响**：真实接线时补 canvas artifact 侧的「从 chat 消息派生」入口，不改现有 chat 契约。
2. **气泡内只读 → 保持**。气泡空间小、是对话流的一部分应稳定，直接可拖易误操作;编辑走最大化（预览→点开编辑的通行模式）。
3. **工具条 → 加「连线」，成为 选择 / ＋节点 / 连线 / 删除**。只能加删节点却不能连线，编辑流程图（最常见 mermaid 类型）
   能力残缺;`CanvasStage` 已支持 `edge`，暴露成本极低。便签（sticky）聊天图场景用不上，不上;**源码视图列 fast-follow**
   （高价值非阻塞）。**已落进原型**（`chat-diagram-tool-edge`，见 `VZ-02-modal-saved.png` 顶栏）。
4. **`<` 转义 → 修在 chat 保存边界（不动 fabric-markdown 包）**。保存前对将落盘的 mermaid 源解 HTML 实体
   （`decodeMermaidEntities`，`apps/web/lib/chat/decode-mermaid-entities.ts` + round-trip 反证测试 4 例）。
   **已落进原型**：saved 截图右栏源已是 `D1{"< 18 个月?"}`（解回），不再是 `&lt;`。
   **残留（诚实标注）**：**画布内节点标签的显示**仍是 `&lt; 18 个月?`——那是 `markdownToCanvas`（渲染进 fabric）
   阶段的转义，与保存路径不同源;让**显示**也匹配需 fabric-markdown **包级**修复（会牵动其他 canvas 消费者），
   本次刻意不做。**结论：落盘的源已正确（这是真实持久化的那份）;画布内显示的 `&lt;` 是纯视觉残留，待包级修复。**

## 与既有线一致性
- 白名单图类型（12 类）、`securityLevel:'strict'`、诚实错误框结构/testid/文案：**与 VZ-01 同一份**，未另起。
- 图内容仍是纯客户端渲染，无新数据依赖、无新角色分叉、**无契约变更**（保存目标定「派生新 artifact」时才需补 canvas 侧契约）。
