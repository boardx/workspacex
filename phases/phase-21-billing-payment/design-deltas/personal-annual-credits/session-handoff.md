# 年付发放交接

唯一工作区 /Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui；当前分支worker/cn-us-annual-credits，父d5c6539c6。该父及之前为UI/契约/目录/充值依赖，待按序集成develop后剥离，单独PR关联6091。

源：domain/billing/personal-credit-calendar.ts；infrastructure/billing/personal-credit-terms.ts及SQL；migration20261101230000。新表是已验证付款期限元数据，不是钱包。后续供应商接线必须可信验证支付归属，再用recordPaidPersonalTerm；不得直接暴露内部输入或时钟。Stripe续费复用原purchase_anchor与month_offset，不用短月份的period_start重设锚点。后台扫描worker尚未接线。

测试证据完整落盘；最终provider57和PG41、API类型/lint、init快速通过。PG包装器已自动释放本次测试栈。本会话UI预览3526已停止，不碰他人容器/部署资源。

独立审查发现重复全历史月份查询P2，先红真实50SQL>8，批量校验既有窗口后修复并复审；保留快照不匹配拒绝，不能为性能跳过身份校验。后续exactSHA/rebase后仍需复核，不借旧SHA宣称CI通过。

UI PR6087的merge-group base-control-plane失败源于pricing-purchase-dialog.tsx无效text-foreground token。之前只查询check-runs默认30条漏看该失败；已取完整分页和日志。先修此UI并通过normal queue，再进行依赖PR；绝不反复盲重排队或绕门。
