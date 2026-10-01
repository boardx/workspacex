# 契约束 `agent-role` — ① UI（签核面第 ① 件）

> **自检：本文件引用 8 张截图，目录下实际 8 张。** 截图目录：`ui-preview/agent-role/`。
> feature_list 中只有 AG04 有 `design_ref`；escalate / handoff 卡片与管理「角色」区块**尚无截图**，列为签核缺口。

依据：`requirements/03-agent-role.md` R8；覆盖 feature 权威在 `design-signoff.md` `covers:`。

## 一、截图

| 截图 | feature | 展示 |
|---|---|---|
| `ui-preview/agent-role/agent-directory.png` | AG04 | 成员 Agent 目录：按 roleCategory 分组的 4 张官方角色卡片 |

## 二、界面落点

| 层级 | 路由 / 组件 | 目的 | 当前状态 |
|---|---|---|---|
| 成员目录 | `apps/web/app/agent/page.tsx`（新，`/agent`） | 分组卡片、分类筛选、搜索、开始对话 | 不存在 |
| 头像 | `apps/web/components/ui/avatar.tsx` | 支持 `illustration` key（`AvatarKey`），回退首字母 | 现仅首字母 |
| 管理详情 | `apps/web/app/admin/agent/[id]/page.tsx` 新增「角色」区块 | 头像选择、分类、白名单、委派/升级策略、能力就绪性清单 | 页面存在、区块不存在 |
| 聊天 escalate 卡片 | agent-interrupts 卡片族新增 | 事项、原因、决定输入、批准/驳回 | 无截图 |
| 聊天 handoff 卡片 | 新 | 目标角色头像 + 交接包摘要 + 确认/取消 | 无截图 |

## 三、稳定 `data-testid`（实现须遵守）

| 区域 | `data-testid` |
|---|---|
| 目录根 / 分组 / 卡片 | `agent-directory`、`agent-directory-group-<roleCategory>`、`agent-card-<agentId>` |
| 筛选 / 搜索 / 空态 | `agent-directory-filter-category`、`agent-directory-search`、`agent-directory-empty` |
| 卡片元素 | `agent-card-avatar`、`agent-card-official-badge`、`agent-card-workflows`、`agent-card-readiness`、`agent-card-start-chat` |
| 管理角色区块 | `agent-role-section`、`agent-role-locked-hint`、`agent-role-capability-<category>` |
| escalate / handoff | `interrupt-card-escalate`、`handoff-confirm-card`、`handoff-confirm`、`handoff-cancel` |

## 四、状态与文案

- 头像：`avatar=null` 或 key 不在集合 → 首字母（A3），不报错。
- 就绪：成员只见「可用 / 能力未就绪」（不列授权详情，R5）；`unknown` 局部提示。
- 官方 Agent 在管理侧白名单/策略只读，提示「克隆后可改」。
- 白名单拒绝：聊天可见「该角色不能发起此流程」。
- handoff 不可达引用：「无法展示此来源」。
- 无权：卡片不出现；直链 404 页。

## 五、签核缺口

1. escalate、handoff、管理「角色」区块无截图（建议追加 escalate 卡片、handoff 卡片、管理「角色」区块三张截图 并写回 feature_list `design_ref`）。
2. 空态、加载、`unknown` 就绪性、窄屏布局未出图。

## 附：七态截图（ui-prototyper 产出，`/preview/work-stack` 原型屏）

| 截图 | 状态 |
|---|---|
| `ui-preview/agent-role/AG04-agent-directory-default.png` | default |
| `ui-preview/agent-role/AG04-agent-directory-denied.png` | denied |
| `ui-preview/agent-role/AG04-agent-directory-depfail.png` | depfail |
| `ui-preview/agent-role/AG04-agent-directory-empty.png` | empty |
| `ui-preview/agent-role/AG04-agent-directory-invalid.png` | invalid |
| `ui-preview/agent-role/AG04-agent-directory-loading.png` | loading |
| `ui-preview/agent-role/AG04-agent-directory-success.png` | success |
