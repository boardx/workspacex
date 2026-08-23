---
bundle: accessibility-guardrails
phase: "12"
covers: [F05, F06, F07, F08]
status: confirmed           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: usamshen
confirmed_at: 2026-08-23T14:30:00+08:00
---

# 契约束 `accessibility-guardrails` 设计签核

> ## ✅ 三件材料均已备齐，可以签核。
>
> **① ✅ UI 材料已产出（方案 A 已落地）。** `ui-preview/accessibility-guardrails/` 下
> 4 张「界面落点参考态」截图：chat 消息输入区+会话列表、profile 资料编辑表单、
> org-admin 成员列表、org-admin 权限设置弹层打开态。`lint-ui-material.mjs` 报 `4/4` 全绿。
> **不是**「修复后」对比图——那组 before/after 证据属于 F05-F08 各自 feature 落地时
> 的验收产出，不是本次签核材料的一部分。
>
> ⚠ **签核时请重点核对来源**：线上 `/chat`、`/profile` 都卡在登录门后需要完整后端栈，
> UI 先行阶段不依赖后端，所以 chat 取自权威原型 `WorkspaceX Standalone.html`，
> profile 是新建的离线预览页 `/profile/preview`（套的是**真实** `ProfileScreen` 组件 +
> mock 身份，`/profile` 生产逻辑未改一字），org-admin 用已有的 `/org-admin/preview`
> （`?org=org-local` 解锁权限弹层）。这些替代来源是否满足「① UI：确认是正确页面」
> 这个签核目的？如果你认为必须是带真实后端的线上页面才算数，需要另外排一次带后端栈的取证。
>
> **② ✅ usecases.md / domain.md / coverage.md 已备齐。UC-3 AMBIGUOUS_SEMANTIC 默认值
> 人类 2026-08-23 已确认**：图片语义难以一句话描述时留空 alt + 靠相邻文字说明，不强行
> 编造 alt 文案。
>
> **③ N/A — 本束无后端 API 契约面。**

## 人类签核时请重点确认
- **① UI**：核对 4 张截图是不是本束要修改行为的正确页面/组件；确认「权威原型 +
  离线预览页 + preview 路由」这套替代来源能否满足「确认正确页面」这个签核目的
  （不是核对修复效果——修复效果在各 feature 落地时另外验收）。
- **② 用例**：UC-3「AMBIGUOUS_SEMANTIC」分支——图片语义难以描述时是否允许留空 alt
  并只依赖相邻文字，还是必须强制写出（哪怕不完美）？两种都有可访问性专家支持，
  本文档默认「配合上下文，不强行编造」，需要你确认这个默认站不站得住。
- **支撑材料**：`domain.md` I-4 的门槛值（`totalScore` 判定属于 review-governance 束，
  但 I-1 的「弹层默认必须支持 Esc」在本束——如果某个已知场景需要例外，请现在指出。
