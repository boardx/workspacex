# 契约束 `plan-permissions` — ① UI（签核面第 ① 件）

> **自检**：本文件引用 2 张截图，目录下实际 2 张。（2026-09-04 ui-prototyper 交付，签核用静态原型）

覆盖 feature：F06 F07 F08。判据单一事实源是 `requirements/03-plan-mode-permissions.md`
的 R3/R4/R5/R8/R12（本文件只引用条目号，不重抄正文）。

## 一、本束需要哪几块屏

本束**不新建独立路由**。全部落点在 `/chat` 主屏内联卡片/弹层，签核阶段承载于
`/preview/agent-kernel`（同 `streaming-transport` 束的说明）。

| 屏 | 一句话 | 对应需求 | 现状 |
|---|---|---|---|
| **S1 计划确认卡片** | 结构化 todo 列表，可编辑/删除单项，底部「确认执行/取消」 | R3 步骤 1-3、R8 | 已建（原型） |
| **S2 工具权限确认弹层** | 展示「agent 想做什么、为什么」+ 四档决策按钮 | R3 步骤 5、R8 | 已建（原型） |

## 二、界面落点与稳定 `data-testid`

| 组件 | data-testid | 触发条件 |
|---|---|---|
| 计划确认卡片 | `agent-kernel-plan-confirmation-card` | run 状态 `awaiting_plan_confirmation` |
| 计划步骤（可编辑） | `agent-kernel-plan-step`（含 `-edit` `-delete` 子锚点） | 同上，逐条 todo |
| 确认执行按钮 | `agent-kernel-plan-confirm` | 用户点击确认 |
| 取消按钮 | `agent-kernel-plan-cancel` | 用户点击取消（R4 A1） |
| 工具权限弹层 | `agent-kernel-tool-permission-dialog` | run 状态 `awaiting_tool_permission` |
| 四档决策按钮 | `agent-kernel-tool-permission-{once,run,forever,deny}` | 用户四选一（R3 步骤 5） |

## 三、已产出（截图）

| 编号 | 文件 | 对应上表 |
|---|---|---|
| 01 | `ui-preview/plan-permissions/01-plan-confirmation-card.png` | S1 |
| 03 | `ui-preview/plan-permissions/03-tool-permission-card.png` | S2 |

## 四、缺口

- ⚠ 未产出：E1（用户长时间未响应确认/权限弹层）对应的「待你确认」入口提醒（角标/通知）
  截图——本轮原型只展示弹层本身，未展示提醒入口的视觉形态，待人类签核时确认是否要补。
- ⚠ 未产出：E2（编辑计划引入不合法内容，如删除必要前置步骤）的内核提示 UI——需求原文
  只说"内核应能识别并给出提示"，未指定具体呈现位置，属于待细化的失败态，如实标注。
