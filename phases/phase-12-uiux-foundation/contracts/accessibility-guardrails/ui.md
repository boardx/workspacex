# 契约束 `accessibility-guardrails` — 签核①：UI（界面落点）

> ## ✅ 自检（可机械核对）：**本文件引用 4 张截图，目录下实际 4 张。**
>
> 目录：`phases/phase-12-uiux-foundation/ui-preview/accessibility-guardrails/`
> 由 ui-prototyper 产出（脚本 `apps/web/scripts/shot-phase12-signoff.mjs`）。
>
> ⚠ **本束不引入新界面**（人类 2026-08-23 已选方案 A）：这些是既有页面的「界面落点
> 参考态」（当前默认状态），用于确认签核①问的是不是正确页面，**不是**键盘可达性修复
> 效果本身（修复前后对比属 F05-F08 各自落地时的验收产出）。

## 材料说明（界面落点参考态）

- **chat 消息输入区 + 会话列表**：取自对话主屏（权威原型 `WorkspaceX Standalone.html`，
  与 `shot-chat-prototype-ref.mjs` 同源）——一屏内同时含底部消息输入区（composer）与
  左栏会话/线程列表。线上 `/chat` 未登录会跳 `/login`（需后端栈），故取自这份已确认
  设计语言的权威原型。
- **profile 资料编辑表单**：取自 `/profile/preview`——把**真实的 `ProfileScreen` 组件**
  套进 `PreviewSessionProvider`（注入 mock 身份、零网络）离线渲染。头像 / 显示名 /
  改密码三块为真实组件；活动记录区因无后端显示「依赖不可用」，属预期（本图只看资料
  表单落点）。
- **org-admin 成员列表 + 权限设置弹层**：取自 `/org-admin/preview?screen=members`
  （真实 `OrgAdminApp` 组件 + mock 数据）；权限弹层为「邀请成员」浮层（含组织角色 +
  团队指派 = 权限设置）。`?org=org-local` 使 mock 身份 orgRole=admin 以解锁邀请入口。

## 索引表

| 状态 | 文件名 |
|---|---|
| chat 消息输入区 + 会话列表默认态 | uc-a11y-chat-composer-thread-default.png |
| profile 资料编辑表单默认态 | uc-a11y-profile-form-default.png |
| org-admin 成员与配额列表默认态 | uc-a11y-orgadmin-members-default.png |
| org-admin 权限设置弹层（邀请成员 + 角色/团队）打开态 | uc-a11y-orgadmin-permission-dialog-default.png |

> 覆盖 feature 与依据见 `design-signoff.md`（权威）。设计决定与待确认清单见
> `phases/phase-12-uiux-foundation/ui-preview/README.md`。
