# 充值交接

唯一工作区 /Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui，当前worker/cn-us-credit-topups。UI6087、契约6094、目录6095均已合入develop；本分支已去掉旧父41cf12014，对齐6a1a3c62efa31d78cfd5337eccecb672ddb6dd0a。业务代码只含6090，提交和PR仅Closes6090；附更新已合入目录的验收状态。提交引用用Refs #6090，避免队列误解析括号issue号。

测试：pnpm --filter @repo/api test:billing-provider；pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/billing/reference-package-catalog.test.ts tests/billing/stripe-credit-checkout-pg.test.ts tests/billing/wechat-notify-crediting.test.ts；前端现有billing-cashier专项；API/Web typecheck及API lint。隔离测试包装器已清理自己的数据库资源。没有运行部署或线上重置。

生成SQL命令：pnpm exec tsx apps/api/scripts/generate-personal-credit-packages.ts，--check验证目录单源。未来改价必须新版本和新迁移，不能改已发布快照。独立只读审查已完成，发现的市场缺失放行问题已修复并复审51/51。

用户已明确授权本次定价PR在检查和独立审查通过后正常集成develop，无admin bypass，无生产部署权限。所有旧计费订单/订阅/余额/流水全清是已确认的后续发布窗口任务，不保留旧权益。

新基线已复验provider51、隔离PG27、cashier51和SQL生成--check。后续精确SHA审查、20项推送门禁、PR CI及正常集成；不可把历史审查当当前SHA授权。充值集成后年付剥离旧d5c6539c6、Free剥离旧a1d5cbf93。

支付分支worker/cn-us-personal-payments远端检查点346223a734f54782140c992fa4a0b1d0223f82c3已增量ACCEPT、20推送门禁。最新恢复worker/400迁移/PG队列WIP精确stash在db6797c407cf645750b0e1de008955928f8609d5（描述pricing-payment-recovery-runtime-before-topup-integration），含worker3、队列PG7及session fallback针对1已绿，尚未完整type/lint或BillingModule接线。提本PR后可切回支付分支，按该完整hash apply恢复继续；不要pop共享stash或动他人条目。旧自有61a966/ba557备份也保留。不新建第二个worktree。

PR #6098 的 billing-cashier-glue 首次失败定位为浏览器用例仍选择已停用的旧一元 SKU pkg-cn-100。修订为从权威目录选择 CN 10,000 credit 产品，断言旧 SKU 不可选、订单金额/币种/额度精确匹配，并保留真实取消请求、支付商关单、PG CLOSED 及零入账断言。隔离真实浏览器两文件共11项通过（117.96秒），峰值连接7、清理成功；见 evidence/browser-current-package.txt 与 customer-cancel-current-package.png。该截图含测试专用历史 fixture；不作为最终定价 UI 签核材料。修正待精确SHA审查和CI，未合入。
