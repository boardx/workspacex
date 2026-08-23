# 契约束 `review-governance` — 支撑材料：领域模型

覆盖 F13（评审证据结构化落盘）、F14（chat 主屏保真度评审达标）、
F15（profile/org-admin 保真度评审达标）、F16（全站终验收官）。
对应 `requirements/08-*.md`、`requirements/09-*.md`、`requirements/10-*.md`。

## 实体 / 值对象

- **ReviewRecord**：`{ target, reviewDate, rubric, dimensionScores: Record<string, number>,
  totalScore: number, deductionNotes: string[], issueRef?: string }`——落盘进
  `.harness/state/uiux-review-log.jsonl` 的一条记录。
- **FinalVerificationReport**：`{ lintDesign: "pass"|"fail", contrastCheck: "pass"|"fail",
  axeCore: "pass"|"fail", keyboardWalkthrough: "pass"|"fail", recomputedScores: Record<string, number> }`。

## 不变量

- **I-1**：`ReviewRecord` 一经写入，其 `dimensionScores` 与 `totalScore` 不得被追溯性改写；
  修正错误记录必须追加新条目而非覆盖旧值。
  - 断言形态：日志文件只追加（append-only），脚本层面禁止对已有行的 in-place 修改。
- **I-2**：`ReviewRecord.totalScore` 必须等于其 `dimensionScores` 按对应 rubric 权重计算的结果
  （不能手填一个与明细对不上的总分）。
  - 断言形态：校验脚本重新计算并比对。
- **I-3**：`FinalVerificationReport` 中任一字段为 `"fail"` 时，`F16` 不得被标记为 `passing`
  ——呼应 AGENTS.md「没有证据 = 没有完成」。
  - 断言形态：`harness verify` 门控读取该报告。
- **I-4**：`ReviewRecord.totalScore` 低于既定门槛（chat ≥9、profile/org ≥9）时，对应的
  `F14`/`F15` 不得被标记为 `passing`；门槛本身的调整只能由人类裁决（参照 #831/#728 先例），
  不能由 agent 自行下调。

## 明确不是不变量
- 「评分应该客观公正」——过程要求，不可断言，靠 AGENTS.md「打分只由 rev-uiux 角色做」的
  流程约束保证，不写进本节。

## ③ 件为什么不是 zod 契约文件（本束无对外 HTTP 面）
`.harness/state/uiux-review-log.jsonl` 是内部治理数据，不经 `packages/contracts/` 暴露
给前端消费，也没有对应的 HTTP 端点，因此没有 `packages/contracts/src/review-governance.ts`
的必要。本束的「契约」是评审记录的结构化校验脚本与阈值断言，逐条落在 `coverage.md` 的
可执行门控命令里。
