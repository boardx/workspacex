# references —— 情景分析（S013）

本目录不复制实体文档正文（单一事实源：`requirements/work-stack-v2/skills/S013-scenario-analysis.md`）。

## 规格静默处的实现取舍（评审请确认）

- 低影响驱动（如 E1 汇率 impact=2）在输出里只能是 `predetermined` 或 `critical-uncertainty` 二选一：实现为 `predetermined`（固定在基线取值）+ `basis="impact-uncertainty-score"`；规格没有第三种分类。
- E9「关键词 + LLM grader 双判」：LLM 半边没有实现（`llmJudge` 需校准样本，本批未提供），仅关键词规则判定。
- E12 是两个用例：E12（未挂载）与 E12B（证据不可见）；E13 是四个夹具：E13A–D（deterministic=false，规格 §11 已把 G5 口径限定为 E1–E12）。
- 「horizon 晚于所有 asOf」「consistencyHints 引用须存在」是跨字段比较，不写进 JSON Schema，由运行时校验覆盖。
- 评测必过集合 `mustPassCaseIds = E2/E4/E6/E7`：取自规格 §11 明文。
- 错误形状取规格 §6.2 的顶层 `{ code, ... }`（S195–S199 规格只给了错误码，使用 `{ error: { code } }` 包络）。
