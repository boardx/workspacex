---
status: confirmed
confirmed_by: shenyangjun
confirmed_at: 2026-08-13T07:05:33+08:00
bundle: survey-continuous-document
scope: continuous-question-and-report-navigation-with-per-section-output
---

# Survey 连续文档交互设计签核

这是一份新的 Survey UI 设计增量包。它不修改、也不重新确认既有 `contracts/survey/` 契约束。

本文件的签核状态来自人类在 coord-survey 会话中对以下方案明确回复“确认”：

1. 问卷全部问题连续向下浏览，左侧仅作为快捷导航；
2. 每个报告章节独立选择输出方式，选择图表后继续选择具体图表类型；
3. 报告全部章节连续向下浏览，左侧仅作为快捷导航。

## ① UI

见 [contract.md §1–4](./contract.md)。

## ② 用例

见 [contract.md §6](./contract.md#6-验收场景)。

## ③ API 契约

见 [contract.md §5](./contract.md#5-数据模型增量)。本增量只扩展 UI 原型模型，不声明真实 HTTP 路由。

## 明确边界

见 [contract.md §7](./contract.md#7-明确排除)。
