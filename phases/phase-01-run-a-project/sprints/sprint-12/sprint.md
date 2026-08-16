# Sprint 01/12 — F190 工具调用轨迹跨 run 回喂上下文

- **所属阶段**: Phase 01 (run-a-project)
- **创建于**: 2026-08-16 09:03:19

## 本 sprint 目标
F190 工具调用轨迹跨 run 回喂上下文

## 领取的 feature(引用自阶段权威清单,按 id)
- F190 (P1, chat) — 工具调用轨迹跨 run 回喂上下文（agent_run_steps 的 tool_call 摘要作为第四类历史来源注入，ModelCallPort 不动）

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 01/12` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
