# ADR-119: Work Stack 评测与 G0–G6 发布门

- 状态: Proposed
- 适用层：项目实现（专属）
- 日期: 2026-09-28
- 关联：#4534 · `docs/proposals/PROP-WORK-STACK-001.md` · `requirements/work-stack-v2/`

## 背景
仓库有按领域的评测（`evals/skill-selection`、`evals/ic-review`、deep-agent golden、真实模型 lane），但没有通用的 suite/case/grader 模型和对比基线；Skill 试跑的 `fixtureExecution` 恒为 `not_run`。

## 决策
1. 每个实体一个套件：`evals/work-stack/<ID>/`，含 cases、grader（规则优先；需要时用 LLM 评审并做校准）、无 Skill 的通用 Agent 基线。
2. `pnpm harness eval --entity <ID>`：确定性 case 跑回环模型；真实模型走 `real-model-e2e` lane。
3. G0 身份 → G1 溯源/许可证 → G2 schema → G3 权限/注入 → G4 功能 → G5 对比基线 → G6 生产（遥测 + owner + 回滚），做成脚本 `lint-work-stack-gates.mjs`；门状态写回 `skill_catalog_entries`。
4. 只有 verified（过 G5）的 Skill 能被官方 Agent 绑定；G5 不比基线好就不能标 verified。

## 后果
- 「模板化但看起来完整」的实体无法进入 verified。
