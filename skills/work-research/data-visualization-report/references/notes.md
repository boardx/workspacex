# references —— 数据可视化（S164）

本目录不复制实体文档正文（单一事实源在 `requirements/work-stack-v2/skills/S164-data-visualization.md`）。

## 专业方法摘要

1. 读上游闸门：若输入带 `validationGate`（S158 `DataValidationReport.gate`）为 `block`，立即返回 `UPSTREAM_GATE_BLOCKED`，不出图；为 `pass-with-caveats` 时，每条 `requiredCaveats` 必须原文进入对应图的 `annotations`。

## 失败模式摘要

见实体文档「失败模式」一节。
