# Sprint 01/13 — F192 skill 双模型收敛（design-delta 选项②落地）

- **所属阶段**: Phase 01 (run-a-project)
- **创建于**: 2026-08-16 01:36:44

## 本 sprint 目标
F192 skill 双模型收敛（design-delta 选项②落地）

## 领取的 feature(引用自阶段权威清单,按 id)
- F192 (P2, skill) — Skill 双模型收敛：模型 A 为唯一权威写入口，模型 B 冻结只读（POST /skills 返回 410 + 移除“完全新建”入口，存量声明式契约不删不 404）

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 01/13` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
