# Sprint 00/03 — 两层角色本体落地：组织角色×团队 与 项目角色 归结到统一 acl_bindings，任一次鉴权都是两层交集且可解释；组织切换清空项目级上下文并按新组织重新求值

- **所属阶段**: Phase 00 (shared-kernel)
- **创建于**: 2026-07-29 01:18:31

## 本 sprint 目标
两层角色本体落地：组织角色×团队 与 项目角色 归结到统一 acl_bindings，任一次鉴权都是两层交集且可解释；组织切换清空项目级上下文并按新组织重新求值

## 领取的 feature(引用自阶段权威清单,按 id)
- F01 (P1, kernel-auth) — 两层角色本体：组织角色×团队 与 项目角色 落到统一 acl_bindings，任一次鉴权都是两层交集且可解释

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 00/03` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
