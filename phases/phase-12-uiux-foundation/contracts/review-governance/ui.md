# 契约束 `review-governance` — 签核①：UI（界面落点）

> ## ✅ 自检（可机械核对）：**本文件引用 3 张截图，目录下实际 3 张。**
>
> 目录：`phases/phase-12-uiux-foundation/ui-preview/review-governance/`
> 由 ui-prototyper 产出（脚本 `apps/web/scripts/shot-phase12-signoff.mjs`）。
>
> ⚠ 与 `accessibility-guardrails` 同一裁决（方案 A）：F14/F15 的评审对象是 chat 主屏、
> profile、org-admin 既有页面——本束材料是这几屏的「界面落点参考态」（整体布局），
> 不是正式评审截图本身（那是 F14/F15 落地时的评审产出）。

## 材料说明（界面落点参考态 · 整体布局）

- **chat 主屏整体布局**：取自对话主屏权威原型（同 `accessibility-guardrails` 束的来源；
  线上 `/chat` 未登录会跳 `/login`，需后端栈）。对应 `chat-main-fidelity-rubric.md` 十维
  评审的对象。
- **profile 页整体布局**：取自 `/profile/preview`（真实 `ProfileScreen` 组件 +
  `PreviewSessionProvider` 离线渲染）。
- **org-admin 页整体布局**：取自 `/org-admin/preview`（真实 `OrgAdminApp` 组件 + mock
  数据，默认落地屏）。profile / org-admin 两屏对应 `uiux-screenshot-review-profile-org.md`。

## 索引表

| 状态 | 文件名 |
|---|---|
| chat 主屏整体布局默认态 | uc-review-chat-main-default.png |
| profile 页整体布局默认态 | uc-review-profile-default.png |
| org-admin 页整体布局默认态 | uc-review-orgadmin-default.png |

> 覆盖 feature 与依据见 `design-signoff.md`（权威）。设计决定与待确认清单见
> `phases/phase-12-uiux-foundation/ui-preview/README.md`。
