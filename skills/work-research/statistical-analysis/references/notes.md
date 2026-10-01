# references —— 统计分析（S161）

本目录不复制实体文档正文（单一事实源在 `requirements/work-stack-v2/skills/S161-statistical-analysis.md`）。

## 专业方法摘要

1. 读闸门。要求 `validationRef` 指向 S158 报告：`gate="block"` → 直接 `UpstreamGateBlocked`；`gate="pass-with-caveats"` → 把 `requiredCaveats` 原样挂到每条结果的 `caveats`。没有 `validationRef` 只允许 `mode="ad-hoc"`（聊天直调），且所有结论 `allowedAssertion` 上限降一档。

## 失败模式摘要

见实体文档「失败模式」一节。
