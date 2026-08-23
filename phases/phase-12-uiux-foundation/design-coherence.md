---
phase: "12"
covers_bundles: [interaction-primitives, motion-microinteraction, accessibility-guardrails, review-governance]
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by:
confirmed_at:
---

# Phase 12（uiux-foundation）一致性复核

> 🔴 **本阶段现在不可复核确认。** 四个束本身均未 `confirmed`（见各自 `design-signoff.md`），
> 且 `interaction-primitives` / `motion-microinteraction` 两束的 UI 材料未产出，
> `accessibility-guardrails` / `review-governance` 两束卡在同一个待人类裁决的 A/B/C
> 开放问题（截图材料的产出方式）。本文档先把**跨束交叉约束**梳理出来，供束逐一签核时
> 参照，也供最终一致性复核时直接复用，避免签完束才发现束间矛盾。

## 跨束交叉约束（X-A ~ X-E）

- **X-A**：`accessibility-guardrails.domain.md` I-4「弹层默认必须支持 Esc 关闭」
  依赖 `interaction-primitives.domain.md` I-2「点遮罩关闭时 Esc 必须等价可用」——
  两条不矛盾，是同一约束在两个束里的验证分工（前者定义组件应该怎样，后者验证业务层
  没有覆盖破坏它）。签核时需确认两束对「默认必须支持」的例外范围描述一致
  （目前均未列出任何例外，需要在开工前确认这是否现实）。

- **X-B**：`motion-microinteraction.domain.md` I-1「transition 取值必须来自语义 token」
  与 `interaction-primitives.domain.md` I-1「弹层的圆角/阴影/遮罩透明度取值必须来自
  token」是同一治理模式（禁止字面量）在不同属性维度上的应用。**没有矛盾，但有一处
  时序依赖**：`interaction-primitives` 束（F01/F02）产出的四个组件如果先落地，会先用
  现有裸 `transition-*` 类（该束 R6 明确写了"不裸切换但也不等 motion token"），
  `motion-microinteraction` 束（F03）落地后需要回头把这四个组件迁移到新 token——
  两束都要在各自的 `usecases.md` 里承认这条迁移债，不能只有一边写。**目前
  `interaction-primitives` 束尚未补这句，签核时需要补。**

- **X-C**：`review-governance.domain.md` I-4「门槛只能由人类裁决下调」与
  `accessibility-guardrails`/`interaction-primitives`/`motion-microinteraction` 三束均
  不产生评分权限冲突——三束负责「让实现达标」，`review-governance` 束负责「怎么打分」，
  边界清楚，无交叉矛盾。

- **X-D**：`interaction-primitives` 束 UC-4「复合组件收口」与 `motion-microinteraction`
  束 UC-4「微交互稽核」都会触碰同一批业务文件（收口复合组件时顺带看到的 hover/focus
  实现）。**执行顺序建议**：F09/F10（收口）先于 F11/F12（稽核），避免稽核发现的问题
  在收口时被重新引入。两束的 `requirements/00-overview.md` 建议阅读顺序已经是这个
  顺序，符合。

- **X-E**：`accessibility-guardrails` 与 `review-governance` 两束共享同一个 A/B/C
  开放问题（UI 材料产出方式）。**必须用同一个裁决结果，不得分别裁决**——已在两束的
  `design-signoff.md` 里互相引用对方，避免「同一事实两处声明」。

## 错误语义一致性检查
- 四束目前均未定义面向用户的错误提示文案（本阶段是基础设施/治理性质，多数「错误」是
  开发期的 lint 拦截而非运行时用户可见错误），暂不适用「同一失败在不同束是否同一错误码」
  这条检查。若 F04/F09 落地后发现某个用户可见的错误态（如 Table 大数据量降级提示），
  届时需要补一条检查。

## 结论
本阶段四束的核心不变量之间**没有发现互相矛盾**，X-A 到 X-E 是需要在各束签核时
显式确认或补写的关联点，不是阻塞级冲突。真正阻塞签核的是：
1. 四束本身尚未被人类逐节确认（`status` 均为 `pending`）；
2. `accessibility-guardrails` / `review-governance` 的 A/B/C 裁决未做；
3. `interaction-primitives` 束的 `usecases.md` 需要补 X-B 提到的迁移债说明。
