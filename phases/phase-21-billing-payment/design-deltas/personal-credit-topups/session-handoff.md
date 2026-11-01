# 充值交接

唯一工作区 /Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui。P2基线41cf12014；提交和PR仅关联6090。依赖UI6087、契约6088、目录6089逐项集成后，将本分支去掉旧父41cf12014并rebase到develop；禁止混多个feature进PR。提交引用用Refs #6090，避免队列误解析括号issue号。

测试：pnpm --filter @repo/api test:billing-provider；pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/billing/reference-package-catalog.test.ts tests/billing/stripe-credit-checkout-pg.test.ts tests/billing/wechat-notify-crediting.test.ts；前端现有billing-cashier专项；API/Web typecheck及API lint。隔离测试包装器已清理自己的数据库资源。没有运行部署或线上重置。

生成SQL命令：pnpm exec tsx apps/api/scripts/generate-personal-credit-packages.ts，--check验证目录单源。未来改价必须新版本和新迁移，不能改已发布快照。独立只读审查已完成，发现的市场缺失放行问题已修复并复审51/51。

用户已明确授权本次定价PR在检查和独立审查通过后正常集成develop，无admin bypass，无生产部署权限。所有旧计费订单/订阅/余额/流水全清是已确认的后续发布窗口任务，不保留旧权益。
