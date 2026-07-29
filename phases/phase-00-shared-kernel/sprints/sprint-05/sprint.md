# Sprint 00/05 — auth 最小可用切片：邀请码建组织+注册 → 邮箱登录 → 找回密码 → 一账号多组织。目标是让 devapp 从空壳变成能真登录

- **所属阶段**: Phase 00 (shared-kernel)
- **创建于**: 2026-07-29 10:30:29

## 本 sprint 目标
auth 最小可用切片：邀请码建组织+注册 → 邮箱登录 → 找回密码 → 一账号多组织。目标是让 devapp 从空壳变成能真登录

## 领取的 feature(引用自阶段权威清单,按 id)
- F19 (P1, auth) — 用 14 位邀请码创建组织并注册（一码一组织、事务性核销）+ 邮箱验证
- F20 (P1, auth) — 正式成员用工作邮箱+密码登录，失败提示防枚举，连续失败限速并锁定
- F21 (P1, auth) — 忘记密码找回四步，重置成功后吊销该账号全部既有会话
- F22 (P1, auth) — 一账号归属多组织 + 组织停用只读降级（仅管理员可导出，留存期后销毁）

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 00/05` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
