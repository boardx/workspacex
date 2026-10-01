# references —— 市场规模测算（S167）

本目录不复制实体文档正文（单一事实源在 `requirements/work-stack-v2/skills/S167-market-sizing.md`）。

## 专业方法摘要

1. 市场定义锁定。先产出 `marketDefinition`：买方是谁、买的是什么（产品/服务边界）、地域、货币、基准年、价格口径（名义/实际、含税/不含税）、计量单位、`denominatorId`（例如"终端客户年度支出"而非"厂商收入"）。任何后续数据点的 `denominatorId` 与之不一致即拒收（`DENOMINATOR_MISMATCH`），而不是换算后混用。

## 失败模式摘要

见实体文档「失败模式」一节。
