---
status: confirmed
bundle: survey-resource-library
scope: survey-and-template-library-entry-and-routing
confirmed_by: usam.shen@gmail.com
confirmed_at: "2026-08-13"
confirmed_via: "coord-survey 会话内已确认两张 UI 图及交互方向，本次于 coord-main 复核确认属实。"
---

# Survey 资源库入口设计签核

本文件记录新的 Survey UI 设计增量，不修改既有 `contracts/survey/` 契约束。

人类已经在 coord-survey 会话中确认两张 UI 图及以下交互方向；仓库规则要求
`status` 由人类签核者修改，agent 保持为 `pending`。

## ① UI

见 [contract.md §1–6](./contract.md)。

## ② 用例

见 [contract.md §7](./contract.md#7-验收场景)。

## ③ API 契约

见 [contract.md §8](./contract.md#8-api-契约边界)。本增量不声明真实 HTTP 路由。

## 明确边界

见 [contract.md §9](./contract.md#9-明确排除)。
