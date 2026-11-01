# 年付发放交接

刷新栈01f1e981b本轮实际复验：provider60/60、隔离PG45/45及API type/lint7/7通过，数据库peak5且cleanup0s；原有证据之外另存refreshed-*，不冒称P2已合或最终PR绿。当前保存证据，等实际前置合入后最终重基与精确审查。

2026-11-02依赖刷新：本地63d23e154以充值source48e04b39c为父，两个提交range-diff均与此前已审版本相同，独立静态复核ACCEPT；未重跑重数据库，不代表最终集成。P2 PR6098尚未实际合入；最终仍要剥离base48 onto实际develop并复验精确SHA。为避免合并候选遗漏新迁移，明确将本项两份SQL（personal_credit_terms及personal_credit_schedule）加入既有reviewedSuffix；当前仓库目录反例先1失败/1通过，补清单后2/2通过，未知/缺失/重复迁移门保留。此清单只定义fixture升级边界，不执行生产迁移/激活。

唯一工作区 /Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui；当前分支worker/cn-us-annual-credits，父d5c6539c6。该父及之前为UI/契约/目录/充值依赖，待按序集成develop后剥离，单独PR关联6091。

源：domain/billing/personal-credit-calendar.ts；infrastructure/billing/personal-credit-terms.ts及SQL；migration20261101230000。新表是已验证付款期限元数据，不是钱包。后续供应商接线必须可信验证支付归属，再用recordPaidPersonalTerm；不得直接暴露内部输入或时钟。Stripe续费复用原purchase_anchor与month_offset，不用短月份的period_start重设锚点。后台worker已在BillingModule注册；migration20261101233000增加可重建next_check_at提示，只有该提示字段可由app更新，原锚点仍决定发放。

测试证据完整落盘；最终provider60和PG45、API类型/lint、init快速通过。新16项PG包含101账户分页、双实例、错误隔离和提前调度不多发；独立worker/calendar9项通过。PG包装器已自动释放本次测试栈。本会话UI预览3526已停止，不碰他人容器/部署资源。

独立审查发现重复全历史月份查询P2，先红真实50SQL>8，批量校验既有窗口后修复并复审；保留快照不匹配拒绝，不能为性能跳过身份校验。后续exactSHA/rebase后仍需复核，不借旧SHA宣称CI通过。

UI PR6087旧候选的base-control-plane失败为两处text-foreground。已修复147f0a624104a050ce09cf330899c4f39cafa2e0，独立ACCEPT、Playwright5项及47静态门通过；新head CI仍须实时核对。check-runs必须完整分页，不能只看默认30条漏掉失败。保持normal queue，不盲重排队或绕门。
