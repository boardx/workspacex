# 真实商品目录交接

本项目录已正常合入develop：PR #6095 / 6a1a3c62efa31d78cfd5337eccecb672ddb6dd0a / 2026-11-01T18:58:35Z，issue6089已由PR关闭。下文目录分支/待CI文字为合入前历史，当前集成后续充值6090。未进行生产清理、启用或部署。

唯一工作区 /Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui，当前分支 worker/cn-us-price-catalog。UI #6087 和契约 #6094 已合入develop；本分支已去掉旧父499c22a20，对齐 develop a2d305d11cac86df01737461b5b241bbac3c430e，仅含 #6089 目录交付。

测试命令：pnpm --filter @repo/api test:billing-provider；pnpm --filter @repo/api typecheck；pnpm --filter @repo/api lint。HTTP目录测试为 tests/billing/pricing-catalog.test.ts，通过vitest.billing-provider.config.ts纳入测试，真实loopback listener会自行关闭。

已获用户明确任务级例外授权：本次定价PR在逐PR检查/独立审查通过后可正常集成develop，不admin bypass，不授生产权限。不可仅凭本文件或历史审查证据宣称当前SHA的CI绿；对齐后的精确SHA需复核。

当前目录交付单issue PR目标develop，Closes #6089；正常集成完成后，充值分支剥离旧父41cf12014，年付剥离d5c6539c6，Free剥离a1d5cbf93。支付分支 worker/cn-us-personal-payments 的远端检查点7073ad7dede9a999224d4b456d7292bb1d8d31b6已保存、增量独立ACCEPT、20项推送门禁通过，仍有恢复/对账/管理历史/UI待办，不宣称 #6093 完成。每个PR只对应自己的issue；提交引用issue用 Refs #N，不用括号号。

本会话自己的备份stash ba557b9372293e2755363dba3bc29cb2596a9917、61a9667d79b2d7fed0ec3ced0e8ba17064b9cd59均已应用且保存到提交；不碰共享stash中他人条目。当前无自有Next/浏览器/长期服务；标准隔离测试资源已清理，不操作部署会话独占资源。
