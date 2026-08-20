# Sprint 10/01 — 现场协作编排首轮：视角切换器（F01）+ 环节状态条编排层复用（F03）——两个零依赖、无跨阶段硬阻断的 feature，先把 issue→分支→实现→verify→PR→合入 主 流程在这个新 phase 里跑通

- **所属阶段**: Phase 10 (live-collaboration-orchestration)
- **创建于**: 2026-08-20 10:37:56

## 本 sprint 目标
现场协作编排首轮：视角切换器（F01）+ 环节状态条编排层复用（F03）——两个零依赖、无跨阶段硬阻断的 feature，先把 issue→分支→实现→verify→PR→合入 主 流程在这个新 phase 里跑通

## 领取的 feature(引用自阶段权威清单,按 id)
- F01 (P1, viewer-role) — 视角切换器：主持台·全场 / 分组，含角色锁定与状态后缀
- F03 (P1, segment-engine) — 环节状态条现场呈现（复用 F963）+ 分组视角内的一致展示

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 10/01` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
