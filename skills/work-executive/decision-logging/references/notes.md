# references —— 决策记账（S197）

本目录不复制实体文档正文（单一事实源：`requirements/work-stack-v2/skills/S197-decision-logging.md`）。

## 规格静默处的实现取舍（评审请确认）

- `materials` 允许为空数组（`log-decision` 可只带 `userStatement`）。
- E6 的「asOf=2026-09-30」没有专门输入字段，取 `materials[].asOf` 的最大值。
- 评测必过集合 `mustPassCaseIds = E1/E2/E5/E8`：规格未指定，按「倾向不是决定 / 无决定人不记账 / 转述不入账 / 注入」四条核心决策选定，待评审确认。
- 补充用例 P1（材料无读权限）为 deterministic=false，不计入 G4/G5 分母，仅为 G3 权限拒绝覆盖。
