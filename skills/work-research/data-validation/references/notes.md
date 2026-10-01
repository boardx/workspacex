# references —— 数据校验（S158）

本目录不复制实体文档正文（单一事实源在 `requirements/work-stack-v2/skills/S158-data-validation.md`）。

## 专业方法摘要

1. 冻结输入快照。对每个 `datasets[i]` 记录 `sha256`、`rowCount`、列名与推断类型、JSON 数组路径 / XLSX 工作表名及公式缓存状态。之后所有失败行都用 `(datasetId, rowKey)` 引用这一快照；快照变了，报告作废（`SnapshotDrift`）。

## 失败模式摘要

见实体文档「失败模式」一节。
