# references —— 趋势分析（S168）

本目录不复制实体文档正文（单一事实源在 `requirements/work-stack-v2/skills/S168-trend-analysis.md`）。

## 专业方法摘要

1. 序列契约核对。对每条输入序列确认：度量（`measure`）、单位、聚合方式（sum / mean / last / rate）、观测频率（D/W/M/Q/Y）、时区。`rate` 类（空置率、价差）禁止跨期求和；`last` 类（期末库存、在租面积）禁止对日内求均值。任一项缺失 → `SERIES_CONTRACT_INCOMPLETE`，不猜。

## 失败模式摘要

见实体文档「失败模式」一节。
