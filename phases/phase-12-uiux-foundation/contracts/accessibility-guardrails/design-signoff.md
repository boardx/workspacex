---
bundle: accessibility-guardrails
phase: "12"
covers: [F05, F06, F07, F08]
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by:
confirmed_at:
---

# 契约束 `accessibility-guardrails` 设计签核

> ## 🔴 本束现在不可签核。请不要把 `status` 改成 `confirmed`。
>
> **① 🔴 UI 材料未产出，且有一处需要人类决策（见下方 A/B/C）。**
> 本束四个 feature 都**不引入新界面**——chat/profile/org-admin 是 phase-01 已上线的
> 既有页面，本束只做行为修复（键盘可达）与不可见标注（aria/alt）。
>
> 按 `.harness/instructions/contract-design.md` 的规则，`ui-preview/` 材料**不允许
> 跨 phase 复用**（「chained/跨 phase 均 fail closed」），而 phase-12 是新阶段，
> 没有自己的 chat/profile/org-admin 截图集。这意味着即便本束不改视觉，仍然需要
> 在本 phase 下产出一套材料才能过 `lint-ui-material.mjs`。**这不是我能替你决定的
> 流程选择**，列出三个选项供裁决：
>
> - **A（推荐，人类 2026-08-23 已选定）**：在本 phase 补拍这几个页面的截图。
> - B：把这四个 feature 移出 has_ui 阶段——未选。
> - C：改 `lint-ui-material.mjs` 本体新增豁免声明——未选。
>
> **✅ 已裁决：方案 A。** 人类 2026-08-23 选定。落地口径的一处澄清（agent 补充，
> 非新裁决）：F05-F08 的**修复本身还没做**，所以现在能拍的是「界面落点」参考态——
> chat 发消息区/会话列表、profile 资料编辑表单、org-admin 权限弹层的**当前默认状态**
> 截图，用于确认「① UI：界面落点对不对」这一层签核问题（是不是这几个页面/组件）。
> **不是**「修复后」对比图——那组 before/after 证据属于 F05-F08 各自 feature 落地时
> 的验收产出（写进对应 issue/PR），不是本次签核材料的一部分，两者时间点不同、不要混淆。
> 已在 `ui-material-map.json` 声明目录，ui-prototyper 产出后回填 `ui.md` 索引。
>
> **② ✅ usecases.md / domain.md / coverage.md 已备齐。**
>
> **③ N/A — 本束无后端 API 契约面。**

## 人类签核时请重点确认
- **① UI**：ui-prototyper 产出「界面落点参考态」截图后，核对是不是本束要修改行为的
  正确页面/组件（不是核对修复效果——修复效果在各 feature 落地时另外验收）。
- **② 用例**：UC-3「AMBIGUOUS_SEMANTIC」分支——图片语义难以描述时是否允许留空 alt
  并只依赖相邻文字，还是必须强制写出（哪怕不完美）？两种都有可访问性专家支持，
  本文档默认「配合上下文，不强行编造」，需要你确认这个默认站不站得住。
- **支撑材料**：`domain.md` I-4 的门槛值（`totalScore` 判定属于 review-governance 束，
  但 I-1 的「弹层默认必须支持 Esc」在本束——如果某个已知场景需要例外，请现在指出。
