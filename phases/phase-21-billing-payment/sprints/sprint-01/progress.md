# 进度日志 — Sprint 21/01

## 当前已验证状态
- 代码检出：`/Users/shenyangjun/.codex/worktrees/eaa4/workspacex`。
- 标准启动：`pnpm turbo run dev --filter=web --filter=@repo/api`。
- 当前目标：F01 六表迁移，issue #4883；未宣称整个支付闭环完成。
- F01 状态由 `feature_list.json` 和 `harness verify` 权威判定；完整高风险门控失败：凭据扫描的五处主线测试夹具命中（前置修复 #5550）。

## 2026-10-10 恢复支付开发
- 人类直接要求参考 BoardX 后端与前端完成微信、Stripe 支付及 token 使用，优先于 readiness 队列；队列外原因已写 #4883。
- 人类授权跳过协调凭据、网关租约；本地 owner 为 `agt_01KZRABFDHJ0WD5MP3C5TCR79M`，不占用 `coord-voice` 席位。
- 从 `origin/worker/dev-billing-21-billing-schema@460df4e88` 恢复 F01 迁移/测试到最新 main，不复制无关代码、registry 或历史 passing。
- 初次反证：没有迁移时 14/14 因缺少账本表失败；恢复并补强后隔离真实 Postgres 16/16 通过。
- 补强：实际执行 SQL 两次、种子及钱包保留、DDL 事务回滚、跨组织与无组织 RLS、全部十个快照字段、人工发放空白留痕拒绝。
- API typecheck 与 lint 退出 0；证据：`evidence/F01.schema.log`。高风险完整门控退出 1，结果见 `evidence/F01.verify.log` 为准。
- token 增量人类已确认：1 credit = 1000 tokens；0.01 credit 向上取整；调用前预留、真实 usage 幂等结算、余额不足拒绝新调用、个人/组织分账；Stripe 不自动赠送充值额度。消费契约尚待完整物化与签核流程，禁止混入 F01 PR。

- 独立评审指出 grant 应强制 source_type=admin_grant；反证新增后实测 1 failed/15 passed，补 CHECK 后 16/16，再留证据。

## 前置验证实际结果
- #5550 修复及 F01 两分支均已推送；本地 push hook typecheck/lint 通过。
- 前置全量 quick 失败（8 项）；七文件定向重跑 497/497 通过。harness 失败于 unchanged-main 的颜色 token 错误和过期基线。完整输出保存为 evidence/prerequisite-5550.*.log。
- #5550 创建草稿 PR 的确认及 token 完整书面草案复核等待人类回复。F01 不变更 passing。

2026-10-10 元数据修正：owner 使用人类提供且 registry 已登记的 role_id coord-voice（不占协调席位）；历史日志中的 agent ID 保留为当时执行证据。sprint 收敛到 F01，其余未认领占位功能不提前领入。
