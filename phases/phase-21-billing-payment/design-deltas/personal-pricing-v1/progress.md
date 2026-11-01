# 个人支付契约设计进展

Issue #6088。仅 schema／用例／领域约束设计，未注册新 API、未连接真实支付或运行迁移。UI 已获用户确认，运行时仍遵循本增量签核门。

已完成：新旧权益读取分离；目录、幂等 Checkout、Pro 月／年付款事实与月度 credit、Free 30 天赠送 schema；PC1–PC9 异常用例；覆盖矩阵；人工签核材料。

验证：先运行契约测试因 schema 文件缺失退出 1，再实现 schema；定向 7/7 通过，contracts 全量 129 文件／1247 测试通过，typecheck 与路由棘轮退出 0。只读审查发现并修正新旧读响应兼容与整年月额度误接受问题；复核独立重跑 7/7，无遗留问题。证据在 evidence/。

依赖：UI PR #6087 需按当前 head CI/review 集成 develop，避免后续契约 PR 混入另一 issue 的 UI diff。当前 worktree 保留同一份，分支 worker/cn-us-pricing-contract。不得另建 worktree 或改共享 checkout。

待完成：设计 PR 创建与检查，用例／API 人工签核，然后分四个独立运行时交付。旧清理、生产发布未执行。
