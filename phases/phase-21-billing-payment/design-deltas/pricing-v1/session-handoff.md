# 中美定价 UI 会话交接

继续复用 `.worktrees/cn-us-pricing-ui`，不要再建 worktree，不切换共享 checkout。UI 已获用户确认（本会话 2026-11-01 明确回复采用）。下一步在 issue #6088 准备个人支付契约与用例签核；未签核 API 前不接真实支付，不运行旧订阅清理。商业规则见 `docs/superpowers/specs/2026-11-01-cn-us-pricing-design.md`。

## 查看与复验

- 启动：`NEXT_DIST_DIR=.next-pricing-ui pnpm --filter web exec next dev -p 3526`，访问 `http://localhost:3526/preview/pricing`。
- 浏览器验证：`pnpm --filter web exec playwright test --config playwright.pricing-preview.config.ts`。
- 类型：`pnpm --filter web typecheck`。
- 截图与待确认清单：`phases/phase-21-billing-payment/ui-preview/pricing-v1/README.md`。

Next 启动会自动给 tsconfig include 添加本地构建目录。此变更属于本地生成修改，提交前仅移除本 session 添加的这一项；不要撤销其他变化。

## 边界

模拟支付只显示成功演示，不增加余额；管理员修改仅 React 内存状态。预览的无权限状态不是后端授权证据。增员首期按剩余月度周期折算，Free 赠送到账后 30 天到期，两项均已由用户确认。

最新用户裁决：全部旧计费订单、订阅、余额和流水均为脏数据，全部清空，不迁移旧权益；此前保留余额/流水建议已被覆盖。尚未执行清理，须在后续明确测试/发布窗口同时处理Stripe外部自动续费及迟到回调版本屏障。生产资源归部署会话管理，本会话不接管。邮件 #6085 不在范围。

UI 确认后先补齐束级 UI／用例／API 契约及一致性复核，再按独立 issue／PR 实施个人支付、Team、Enterprise、迁移与发布。所有 PR 目标 develop；每次开发前 fetch 最新 main 和 develop。PR 的当前 CI 及 review 需实时读取，不能凭本文件断言全绿或已完成。

UI PR6087已获用户明确任务级授权：逐PR检查与独立审查通过后正常集成develop，不使用admin bypass。最新UI token修复需读取新SHA的全部检查（check-runs分页），不能用旧a954检查声称绿。所有后续commit用Refs #N，不在subject用括号issue号，避免队列误当PR号。端口3526已停止。
