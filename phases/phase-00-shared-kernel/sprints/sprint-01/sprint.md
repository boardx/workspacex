# Sprint 00/01 — 打通共享内核的地基与开工回路：两层角色落到 acl_bindings（F01，被 4 个 feature 依赖的最深前置），并用已实现的前端内核（F14）跑通 verify→证据→passing 这条路

- **所属阶段**: Phase 00 (shared-kernel)
- **创建于**: 2026-07-28 16:53:35

## 本 sprint 目标
打通共享内核的地基与开工回路：两层角色落到 acl_bindings（F01，被 4 个 feature 依赖的最深前置），并用已实现的前端内核（F14）跑通 verify→证据→passing 这条路

## 领取的 feature(引用自阶段权威清单,按 id)
- F01 (P1, kernel-auth) — 两层角色本体：组织角色×团队 与 项目角色 落到统一 acl_bindings，任一次鉴权都是两层交集且可解释
- F14 (P1, kernel-web) — 前端内核可运行，且设计规范由脚本机器把关而不是靠人自觉

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 00/01` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
