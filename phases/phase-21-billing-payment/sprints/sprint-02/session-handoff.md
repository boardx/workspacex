# Sprint 21/02 会话交接

当前唯一 in_progress 为 F02，owner coord-voice，对应 #5591。F01 证据已经验证且在 PR #5590；等待 doctor 修复 #5593 绿并合入 main。不得把 F01 或 harness 修复混入 F02 的 PR；当前分支基于 F01 f25bdd95e，F01 合入后需要按该 base 重新衔接 main。

F02 的完成契约和着色计划见 plans/F02.plan.md。部署未配置必须正常返回 enabledProviders=[]，不阻塞启动；匿名仅限该方法，其他账单接口复用 PrincipalGuard。所有凭据读取在基础设施，组合根仅接线，契约为 @repo/contracts/billing-credits 单源。
