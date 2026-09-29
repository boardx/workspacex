# references —— 数据探索（S157）

本目录不复制实体文档正文（单一事实源在 `requirements/work-stack-v2/skills/S157-data-exploration.md`）。

## 专业方法摘要

1. Manifest 先行，内容后看。先列数据源清单：`datasetRef` 解析为文件（名、SHA-256、字节数、格式、工作表/JSON 数组路径）或查询结果快照（查询文本哈希、执行时刻、行数）。格式不在支持集（CSV/TSV/JSON/XLSX/Parquet*）→ `UNSUPPORTED_FORMAT`，不尝试猜解析。*Parquet 是否在沙箱锁定依赖中未核实（UNVERIFIED），缺失时按不支持处理。

## 失败模式摘要

见实体文档「失败模式」一节。
