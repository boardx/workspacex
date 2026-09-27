---
status: pending
bundle: novice-progressive-disclosure
base_bundle: design-workbench
scope: detail-screen-progressive-disclosure-more-menu
covers: []
confirmed_by: ""
confirmed_at: ""
confirmed_via: ""
---

# design delta 签核 · 详情页渐进披露（「更多」菜单）

⚠ `status`、`confirmed_by`、`confirmed_at`、`confirmed_via` 只能由人类修改；agent 不代签
（ADR-023 / AGENTS.md「设计签核（三件、一处签）」）。**status 停在 pending**。

规范唯一来源：[`contract.md`](./contract.md)。验收口径：[`verification.md`](./verification.md)。

## 这份 delta 为什么存在
普通用户评测集量出详情页首屏 57 个可操作控件和一串术语。人类裁决「渐进披露」、用户范围「不懂设计的 PM / 运营」，
并在第一步合入后指示「继续做更多菜单」。实现与本签核同一个 PR，**签核后才合并**。

## ① UI
见 contract §2 的两张表。重点确认：首屏保留的 15 个是不是对的那 15 个；三处改名（交给开发排期 / 这一页多出几版对比 / 给开发看的代码）。

## ② 用例
见 verification V98–V102。

## ③ API 契约
不改。
