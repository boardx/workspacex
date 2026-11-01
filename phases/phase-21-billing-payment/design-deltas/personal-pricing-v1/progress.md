# 个人支付契约设计进展

Issue #6088。仅 schema／用例／领域约束设计，未注册新 API、未连接真实支付或运行迁移。UI 已获用户确认，用户已确认修订后的用例/API并明确授权记录签核，现可逐项进入运行时实现。

已完成：新旧权益读取分离；目录、幂等 Checkout、Pro 月／年付款事实与月度 credit、Free 30 天赠送 schema；PC1–PC9 异常用例；覆盖矩阵；人工签核材料。

验证：先运行契约测试因 schema 文件缺失退出 1，再实现 schema；定向 7/7 通过，contracts 全量 129 文件／1247 测试通过，typecheck 与路由棘轮退出 0。只读审查发现并修正新旧读响应兼容与整年月额度误接受问题；复核独立重跑 7/7，无遗留问题。证据在 evidence/。

依赖：UI PR #6087 需按当前 head CI/review 集成 develop，避免后续契约 PR 混入另一 issue 的 UI diff。当前 worktree 保留同一份，分支 worker/cn-us-pricing-contract。不得另建 worktree 或改共享 checkout。

待完成：设计 PR 创建与检查，分独立运行时交付。旧清理、生产发布未执行。

2026-11-01 用户明确确认：旧订单、订阅、余额和流水全部为脏数据并清空；API/usecase 修订后再次确认并授权回填 design-signoff.md。没有执行生产重置。

2026-11-02：UI PR #6087 已正常合入 develop，merge SHA 25320a892a74ffa90c12e4169637a3be84ced661。契约分支重基于该 SHA，定向 schema 测试重新运行 7/7。用户明确授权本次定价任务在逐 PR 检查与独立审查通过后正常集成 develop；不使用 admin bypass，不含生产部署。当前仅准备 #6088 PR，运行时后续增量仍各自交付。

PR #6094 首轮 CI verify-control-plane 发现新增契约的三条同源代理缺失。本地严格 rewrite 门重现退出1；仅在 Next afterFiles 补 /billing/catalog、/billing/checkout、/billing/subscription/entitlement 三条精确代理，无通配或前端页面路由改动。严格 rewrite 门及 node --check 均退出0，证据 rewrite-red/green.txt；完整 PR checks 仍须等待新 head，不能以此次定向检查代替。
