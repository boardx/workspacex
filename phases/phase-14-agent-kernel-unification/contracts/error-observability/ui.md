# 契约束 `error-observability` — ① UI（签核面第 ① 件）

> **自检**：本文件引用 1 张截图，目录下实际 1 张。（2026-09-04 ui-prototyper 交付，签核用静态原型）

覆盖 feature：F13 F14 F15。判据单一事实源是 `requirements/05-error-observability.md`
的 R3/R4/R7/R8/R12（本文件只引用条目号，不重抄正文）。F13（`toFailure` 分类修复）与
F15（transcript 存储改造）**无独立界面**（纯后端），只有 F14 的前端错误卡片有屏。

## 一、本束需要哪几块屏

本束**不新建独立路由**。错误状态卡片是 `/chat` 消息流内联卡片，签核阶段承载于
`/preview/agent-kernel`（同前三束的说明）。

| 屏 | 一句话 | 对应需求 | 现状 |
|---|---|---|---|
| **S1 错误状态卡片** | `message` + `suggestedAction` 主展示，原始堆栈折叠区默认收起 | R3 步骤 5、R8 | 已建（原型） |

## 二、界面落点与稳定 `data-testid`

| 组件 | data-testid | 触发条件 |
|---|---|---|
| 错误卡片 | `agent-kernel-error-card` | run 状态 `failed` 且已产出人性化错误结构 |
| 人性化消息 | `agent-kernel-error-message` | 同上，主展示区 |
| 建议动作按钮组 | `agent-kernel-error-action-{retry,simplify,contact}` | 三种 `suggestedAction`（R3 步骤 3 至少覆盖此三种） |
| 详情折叠区 | `agent-kernel-error-details`，默认 `aria-expanded="false"` | 原始 `failureCode`/堆栈，仅 run 发起者可见（R5） |

## 三、已产出（截图）

| 编号 | 文件 | 对应上表 |
|---|---|---|
| 06 | `ui-preview/error-observability/06-error-card.png` | S1 |

## 四、缺口

- ⚠ 未产出：F15 审计接口（有权限角色读取完整 transcript）的界面——需求原文未要求前端
  界面，只要求"审计接口"，本轮不产出对应屏，如实记录。
- ⚠ 未产出：E3（transcript 因加密密钥不可用而"内容不可读"）的呈现——审计接口层面的
  错误提示，无独立截图，形态待人类在签核时确认。
