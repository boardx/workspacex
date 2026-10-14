# Sprint 21/02 会话交接

F02 已由 2026-10-11 官方 high_risk verify 自动升级 passing，owner coord-voice，对应 #5591，尚待 PR/CI/main 闭环。2026-10-14 已确认 F01 #5590 与审计修复 #5593 合入；F02 已独立 rebase 最新 main cbbdc3ef0，不再包含 F01 或 harness 修复差异。

最新兼容检查：执行 head 3a9ac358f，正式 backfill API15/contracts2、local parity/capabilities10、API lint/typecheck 全部退出0，新指纹日志 F02.verify.log；旧 high_risk 全量日志独立保存为 F02.pre-rebase.verify.log。backfill 不重跑 base，不把历史全量结果当作最新完整 CI 结果。隔离栈已清理。用户反馈入口缺失另由 #5714 修复；支付页面仍未交付，不冒充充值/订阅/token 消费闭环完成。

F02 的完成契约和着色计划见 plans/F02.plan.md。部署未配置必须正常返回 enabledProviders=[]，不阻塞启动；匿名仅限该方法，其他账单接口复用 PrincipalGuard。所有凭据读取在基础设施，组合根仅接线，契约为 @repo/contracts/billing-credits 单源。

2026-10-14 PR #5716 审查返工：真实子进程反例先3/3失败，证明父环境及显式spec.env都能传支付配置；现两个spawn入口统一在合并后按单源BILLING_PAYMENT_ENV_KEYS去除全部计费键，不影响合法本地override。新鲜实际Node子进程+既有进程/parity回归21/21绿、local-runtime类型绿，证据F02.child-env-*.log。当前passing由旧官方工具自动转换且不可手改；不等于已交付，最新返工CI仍待完成。状态定义与工具转换时机差异独立记录#5723，不在本业务PR改状态机。
