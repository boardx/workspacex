# Sprint 01/22 — plan-control 计划账本可编辑可确认可控制执行（F973-F978）

- **所属阶段**: Phase 01 (run-a-project)
- **创建于**: 2026-08-26 17:59:07

## 本 sprint 目标
plan-control 计划账本可编辑可确认可控制执行（F973-F978）

## 领取的 feature(引用自阶段权威清单,按 id)
- F973 (P1, plan-control) — 计划账本读模型与引擎快照落账：零计划是正常态、stepId 内容继承、phase/gate/progress 服务端派生
- F974 (P1, plan-control) — 三个编辑动作 + 并发不静默覆盖 + 孤儿约束可见：调序/删步/加约束/撤约束
- F975 (P1, plan-control) — 条件性确认门与计划送达：简单提问永不加门、复杂任务确认后 digest 可断言送达
- F976 (P1, plan-control) — 执行控制：暂停（可恢复）/ 恢复续跑 / 重试单步，每个动作留审计
- F977 (P1, plan-control) — 六态指示器与计划面板只读态：当前态可读不靠颜色、不暴露 write_todos
- F978 (P1, plan-control) — 编辑态 + 确认门 + 执行/失败态界面：确认门条件性从不入 DOM、失败态只两个恢复动作

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 01/22` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
