---
status: confirmed
bundle: prototype-board
base_bundle: design-prototype
scope: free-canvas-board-primitive-sticky-shape-link-cursor
covers: []
confirmed_by: "usamshen"
confirmed_at: "2026-09-27T18:10:00+08:00"
confirmed_via: "chat 2026-09-27：「签核通过，合并 #4373，继续做更多菜单」"
---

# design delta 签核 · 自由画布原语 board

⚠ `status`、`confirmed_by`、`confirmed_at`、`confirmed_via` 只能由人类修改；agent 不代签
（ADR-023 / AGENTS.md「设计签核（三件、一处签）」）。签核由人类在对话中给出（见 `confirmed_via` 原话），由 agent 按 `human-decision-packaging.md` 规则二回填，经本 PR 的人类 review 合入生效。

规范唯一来源：[`contract.md`](./contract.md)。验收口径：[`verification.md`](./verification.md)。

## 这份 delta 为什么存在

人类在 devapp 实测做白板产品，四页都画不出白板本身（原语里没有自由画布），原话「感觉无法理解我的意思」。
人类在三个方案里裁决「新增 board 原语」。实现与本签核同一个 PR 交付，**签核后才合并**。

## ① UI

截图（真实模型生成、真实渲染器）：[`ui-preview/multiplayer.png`](./ui-preview/multiplayer.png)、[`ui-preview/connect.png`](./ui-preview/connect.png)。

重点确认：
- 便签的六种纸色、署名放右下角、连线中点的小标签——够不够像白板？
- 协作者光标 = 主色指针 + 名字胶囊。
- 属性面板里画布内容**只读**（显示几项、指向对话），不开坐标编辑框——接受吗？

## ② 用例

见 [verification.md](./verification.md) **V91–V97** 与真实模型验收：白板用例每轮 2/4 页用上 board；非画布用例 0 页滥用。

## ③ API 契约

**不加路由、不改数据库、不加错误码。** 组件闭集 +1（`board`），图标闭集 +1（`cursor`），属性面板字段类型 +1（`structured`）。
PPT 导出暂不画连线（范围外，见 contract §3）。
