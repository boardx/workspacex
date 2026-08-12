---
status: pending
signoff_gate: contract-bundle chat-visualization · 第 ① 件 UI（增量）
awaiting: 人类补签（agent 不改 status）
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
- 最小工具条：**选择 / ＋节点 / 删除 + 适应画布**（`CanvasStage` 另支持 便签/连线/源码，本版未暴露）。
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

## 待人类拍板（签核第 ① 件时逐条看，任一条改动都可能牵后端契约）
1. **保存语义**：编辑后保存是「**就地覆盖**原 AI 消息里的这张图」还是「派生一个**独立 canvas artifact**」？
   本原型两种都能承接（未接后端），但定这条才能画后端契约。
2. **气泡内只读是否符合预期**：目前气泡内不可直接拖动、编辑一律走最大化。若要气泡内轻量微调需另议（与「误拖」权衡）。
3. **最小工具条范围**：是否把 `连线 / ＋便签 / 源码视图` 也搬进最大化面（`CanvasStage` 都支持，仅未暴露）。
4. **round-trip 保真瑕疵**：saved 截图右栏 `D1{"&lt; 18 个月?"}` —— `<` 被 HTML 转义（`fabric-markdown` 序列化器既有行为，
   非本次引入）。确认真实保存前需在序列化层解转义。

## 与既有线一致性
- 白名单图类型（12 类）、`securityLevel:'strict'`、诚实错误框结构/testid/文案：**与 VZ-01 同一份**，未另起。
- 图内容仍是纯客户端渲染，无新数据依赖、无新角色分叉、**无契约变更**（保存目标定「派生新 artifact」时才需补 canvas 侧契约）。
