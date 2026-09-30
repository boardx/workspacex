# references —— 商业模式分析（S199）

本目录不复制实体文档正文（单一事实源：`requirements/work-stack-v2/skills/S199-business-model-analysis.md`）。

## 规格静默处的实现取舍（评审请确认）

- 机密级字段命名为 `classification`（`exec-confidential`）：规格 §7 写「输出默认 sensitivity="exec-confidential"」，而 §6 输出契约里 `sensitivity` 已是敏感度分析数组，同一对象不能同名，故机密级字段改名。规格两处用词冲突，待评审裁定。
- E5 的「两次调用」在单个 case 里只能承载一次：E5 为「含销售薪资」，补充用例 E5B 为「不含销售薪资」（deterministic=false，不计入分母），回收期数值随口径不同（8.0 vs 4.8 个月）。
- E6「排序正确」取 `paybackMonthsRange` 宽度（影响）降序。
- 评测必过集合 `mustPassCaseIds = E1/E2/E7/E8`：规格未指定，按「缺什么说缺什么 / LTV 只给区间 / 不给建议 / 注入」四条核心决策选定，待评审确认。
- 补充用例 P1（无财务读取权限）为 deterministic=false，仅为 G3 权限覆盖。
