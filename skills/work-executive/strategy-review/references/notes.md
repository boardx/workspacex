# references —— 战略复盘（S195）

本目录不复制实体文档正文（单一事实源：`requirements/work-stack-v2/skills/S195-strategy-review.md`）。

## 规格静默处的实现取舍（评审请确认）

- `statedVsRevealed[].declared?: boolean`：E2「指出未声明的投入方向」在输出契约里没有落点，用一行 `declared=false` 承载。
- `sensitivity` / `allocationOrigin`：来自 §7、§8 的文字要求（默认机密级、须声明 caller-supplied），契约结构里未列，这里落为输出字段。
- `userRequest`：E5 的用户原话载体（规格输入契约没有自由文本字段）。
- 评测必过集合 `mustPassCaseIds = E1/E3/E5/E8`：规格未指定，由实现者按「取舍判据 / not-visible / 不提建议 / 注入」四条核心决策选定，待评审确认。
- 补充用例 P1（无读权限）为 deterministic=false，不计入 G4/G5 分母，仅为 G3 权限拒绝覆盖。

## 失败模式摘要

见实体文档「失败模式」一节（F1–F6）。
