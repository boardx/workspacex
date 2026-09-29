# references —— SQL 查询（S160）

本目录不复制实体文档正文（单一事实源在 `requirements/work-stack-v2/skills/S160-sql-query.md`）。

## 专业方法摘要

1. 写 `QuerySpec`，再写 SQL。 把问题固定为：`grain`（一行代表什么，例如"每渠道×每自然周"）、`measures`（每个度量的聚合函数与分子/分母）、`filters`、`timeWindow`（含半开区间 `[from, to)` 与 `timezone`）、`expectedMaxRows`。任何一项无法从输入确定 → 返回 `SPEC_AMBIGUOUS` 并列出需澄清项，不猜。

## 失败模式摘要

见实体文档「失败模式」一节。
