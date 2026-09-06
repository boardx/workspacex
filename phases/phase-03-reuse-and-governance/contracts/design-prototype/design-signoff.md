---
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-09-06T16:45:00Z"
bundle: design-prototype
scope: uc-17-8-prototype-canvas
covers: [B5.3]
---

# 原型画布（对话驱动的结构化组件树，整页重生成）—— 设计签核

规范来源：`phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md`
§B5.3（2026-09-06 人类决策推翻「仅登记不做」）· `packages/contracts/src/design-prototype.ts`
（本束新增词汇）+ `design-workbench.ts`（`DesignProject.prototype`）+ `design-ai-collab.ts`
（`DesignChatWriteback.prototype`，B5.2 改语义）。

**本文件的 `status` 归人类所有——agent 不得改**（ADR-023）。

---

## ⚠ 实现先行、等人类签核——如实写在这里

人类 2026-09-06 原话：「推翻之前的决策，实现结构化 JSON 组件树的原型需要，先做"整页重生成"、
之后再做增量修改。需要可以输出设计文档」。这是**三个已定的决策**（载体 / 分期 / 导出），
本束材料按它们写，实现与材料同一个 PR 交付，`status` 保持 `pending`，人类签核后 B5.3
才允许标 `passing`。与 `design-ai-collab` 束的先例相同。

**后果**：合入 `main` 后立即生效——模型配置齐全时对话可整页生成/重生成画布；存量项目
`prototype = []`，画布仍显示占位块，行为与之前一致。

---

## ① UI

见 [ui.md](./ui.md)，三张 `detail-prototype-*` 截图（同一屏 `detail-screen.tsx` 的画布区，
占位块 → 组件树）。改动点：
- 画布区 `PhoneCanvas` 占位块 → `PrototypeCanvas`（`prototype-canvas.tsx`）：有树渲染树，
  没树仍是占位块 + 一句引导语（`design-detail-phone-placeholder` / `design-detail-phone-tree`）。
- 发送中在对话面板底部多一行「正在生成，画布会整页重绘，可能需要一分钟……」
  （`design-detail-generating`）——模型现在要输出多页 JSON，30s 内不一定回得来。
- 顶栏新增「导出设计文档」（`design-detail-export-doc`）：客户端拼 Markdown 下载。
- 「已更新：…」多一个值「原型画布」。

## ② 用例

见 [usecases.md](./usecases.md)（UC-B5.3，验收线索 V10–V15）。重点是**失败模式**：
一页超限 ⇒ 整个 `prototype` 字段不写、其余字段照写；只改标签 ⇒ 旧树清空而不是错位。

## ③ API 契约

- `design-prototype.ts`：`PrototypeNode`（13 种原语闭集、递归、`.strict()`）、`PrototypeScreen`
  （`{frame, root}` + 深度/节点上限）、`DesignPrototypeWriteback`、`PROTOTYPE_SCHEMA_GUIDE`
  （给模型看的唯一一份原语说明，契约测试保证与闭集不漂移）。
- `design-workbench.ts`：`DesignProject.prototype: PrototypeNode[]`，不变量「长度 0 或 =
  `frames.length`」由 `superRefine` 门控。
- `design-ai-collab.ts`：`DesignWritebackField` 增 `prototype`；`DesignChatWriteback.prototype`。

**没有新路由**：写回仍走 `appendProjectChat`；导出在客户端完成（素材全在 `DesignProject` 里，
多一个接口只是多一份可漂移的副本）。

---

## 签核前请人类确认的三件

1. **载体 = 组件树，原语闭集 13 种**（`stack/card/navbar/text/button/input/image/list/divider/
   spacer/tabs/badge/avatar`）。表达力刻意受限——原型要的是结构与交互意图，不是像素还原。
   若签核时觉得少了某类原语（比如 `switch`/`bottom-nav`），加进闭集是一次契约改动 + 渲染表
   一行，不是重设计。
2. **`frames` 与 `prototype` 按位置耦合**（域模型 §2 I-8），而不是把标签塞进树里或反过来。
   理由：标签是既有事实源（B4 起），不搬家；只改标签 ⇒ 树清空，是「宁可没有也不错位」。
3. **超时 30s → 90s**，且失败仍退回固定回执不抛。若人类希望生成中可取消或改走流式，
   那是下一轮（增量修改）一起做的事，这里先不动。
