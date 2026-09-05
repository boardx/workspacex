# Sprint 14/01 — 地基 sprint：内核统一网关转发（F01）

- **所属阶段**: Phase 14 (agent-kernel-unification)
- **创建于**: 2026-09-04 20:22:49

## 本 sprint 目标
地基 sprint：内核统一网关转发（F01）

## 领取的 feature(引用自阶段权威清单,按 id)
- F01 (Pundefined, kernel-unification) — apps/api 退化为薄网关：转发 run 到内核、旁路写账本、删除自有执行分支

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 14/01` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
