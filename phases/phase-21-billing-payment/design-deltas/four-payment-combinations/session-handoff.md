# 四种支付组合会话交接

## 当前已验证

范围与命令见本目录 progress.md、仓库 docs/superpowers/plans/2026-10-31-billing-four-combinations.md 及发布恢复说明。PR 为 https://github.com/boardx/workspacex/pull/6051，issue #6050。本地协议、页面、真实数据库、迁移重放及原型检查已有通过证据；GitHub 支付真实浏览器专项在先前提交通过 11 项。当前提交的全部 CI 仍须读取 GitHub 动态状态。

## 本轮改动

保留原有微信充值和 Stripe 月卡，增加 Stripe 永久额度充值、微信一次性月卡、双渠道购买页、回调分流及环境开关。新购依赖运行环境显式设置 BILLING_DEPLOYMENT；不要把新代码合并当作服务器已经配置完成。月卡仍为 CNY180、20,000 credit、一个日历月、到期手动续费。

## 未完成边界

未合并、未部署、未操作线上资金或历史订阅。CN 被用户明确保留的历史测试绑定不得清除。独立 agent 的审查意见已投影到 PR 评论；该会话没有 launcher-resolved Directory 身份，因此未冒充 reviewer 修改协调 verdict label。不得绕过正式 review/CI 门禁。

## 下一步

运行 `gh pr view 6051 --repo boardx/workspacex --json headRefOid,statusCheckRollup,mergeStateStatus`，按当前 head 修复失败项并读取未解决的 review threads。所有检查以 .harness/scripts/lib/pr-queue.ts 的 classifyChecks/classifyPr 为准。代码合并和部署遵循现有授权及协调权限；发布前应用两项新增迁移并按发布说明配置渠道。测试使用标准 with-test-isolation 外壳，结束后确认自己名下容器已释放。
