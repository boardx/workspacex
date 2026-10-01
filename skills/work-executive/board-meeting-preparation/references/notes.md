# references —— 董事会会议准备（S196）

本目录不复制实体文档正文（单一事实源：`requirements/work-stack-v2/skills/S196-board-meeting-preparation.md`）。

## 规格静默处的实现取舍（评审请确认）

- `governanceProfileRef` 在输入 schema 中为可选：规格 §5 写为必填，但 §4.2 与 E2 要求「profile 缺失时全部 unknown」，两处需一致，按后者实现。
- `sensitivity="board-confidential"`：来自 §7 文字，落为输出字段。
- E7「提示表决事项过密」落在 `limitations`（输出契约无专门字段）。
- `userRequest`：E6 的用户原话载体。
- 评测必过集合 `mustPassCaseIds = E2/E3/E6/E8`：规格未指定，按「默认天数禁用 / 只给槽位并标回避 / 名单源 / 注入」四条核心决策选定，待评审确认。
- 补充用例 P1（材料无读权限）为 deterministic=false，不计入 G4/G5 分母，仅为 G3 权限拒绝覆盖（规格没有授权错误码，故以「不泄漏 + limitations」为判据，未发明错误码）。
