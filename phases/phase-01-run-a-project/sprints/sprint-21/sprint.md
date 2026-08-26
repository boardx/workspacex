# Sprint 01/21 — agent-interrupts 契约内核与三张中断卡（F212-F216）

- **所属阶段**: Phase 01 (run-a-project)
- **创建于**: 2026-08-26 17:08:37

## 本 sprint 目标
agent-interrupts 契约内核与三张中断卡（F212-F216）

## 领取的 feature(引用自阶段权威清单,按 id)
- F212 (P1, agent-interrupts) — 三种 HITL 中断的契约内核：agent-interrupts.ts zod 骨架 + 跨语言工具名门控 + ARGS_MAX_CHARS 豁免 + 部署投影扩容
- F213 (P1, agent-interrupts) — 目标复述卡（confirm_intent）：执行前复述理解+≥2条假设，未确认不执行任何工具；可继续或改假设
- F214 (P1, agent-interrupts) — 参数补全表单（fill_params）：AI 猜测字段高亮+依据，逐字段可改；改动走 full-rerun/ledger-only 两态（诚实降级）
- F215 (P1, agent-interrupts) — 多方案对比卡（choose_option）：2–3 张等宽卡固定三项对照，选中即 resume（optionId 回指）
- F216 (P1, agent-interrupts) — 中断决策统一守卫：8 错误码 fail-closed（权限/kind不符/失效/畸形/审计写不进）+ XC-59 反证 PlanPhase 不被误判为审批

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 01/21` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
