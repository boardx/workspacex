# Sprint 00/02 — 建后端内核：apps/api 洋葱四层 + 显式 SQL 迁移 + RLS 强制隔离（带反证）+ 三道运行时门控 + 契约 zod 直达后端 DTO，解除 F01~F13 的共同前置

- **所属阶段**: Phase 00 (shared-kernel)
- **创建于**: 2026-07-28 18:32:09

## 本 sprint 目标
建后端内核：apps/api 洋葱四层 + 显式 SQL 迁移 + RLS 强制隔离（带反证）+ 三道运行时门控 + 契约 zod 直达后端 DTO，解除 F01~F13 的共同前置

## 领取的 feature(引用自阶段权威清单,按 id)
- F18 (P1, kernel-api) — 后端内核可运行，且洋葱分层/RLS 强制/三道运行时门控由脚本机器把关而不是靠人自觉

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 00/02` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
