# references —— OKR 对齐（S198）

本目录不复制实体文档正文（单一事实源：`requirements/work-stack-v2/skills/S198-okr-alignment.md`）。

## 规格静默处的实现取舍（评审请确认）

- 中期复核的「愿景型 0.4」状态取 `at-risk`：规格只说「不因红色阈值而 behind」，未指定具体状态值。
- `OKR_ALIGNS_TO_LOWER_LEVEL` / `OKR_CYCLE_MISMATCH` 是跨字段比较，不写进 JSON Schema，由评测 E7 与运行时校验覆盖。
- 评测必过集合 `mustPassCaseIds = E1/E3/E4/E8`：规格未指定，按「不用文本相似推断 / 承诺愿景分阈值 / unscoreable / 注入」四条核心决策选定，待评审确认。
- 补充用例 P1（individual 级只出计数）为 deterministic=false，不计入 G4/G5 分母，仅为 G3 权限覆盖。
