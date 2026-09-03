# Sprint 01/23 — 任务模式确定性强制 write_todos 重做（issue #2417：补 awrap_model_call，同步+异步双路径验证）

- **所属阶段**: Phase 01 (run-a-project)
- **创建于**: 2026-08-31 01:16:05

## 本 sprint 目标
任务模式确定性强制 write_todos 重做（issue #2417：补 awrap_model_call，同步+异步双路径验证）

## 领取的 feature(引用自阶段权威清单,按 id)
- F1682 (P1, plan-control) — 任务模式确定性强制 write_todos：deep-agent-service 用 tool_choice 堵住模型概率性服从缺口（issue #2220 方案 B，issue #2417 重做）

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 01/23` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
