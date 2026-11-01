# 新用户赠送交接

暂存栈5dc026ce5获独立只读ACCEPT。首轮prepush实际24/25，Web typecheck退出137，不能称绿；宿主swap约13GB，仅处理本会话编译器，根因未确定。随后相同API/Web类型检查串行7/7（6缓存）通过，正常再次推送完整25/25（24缓存）通过，5dc已在自有远端。没有跳过hook。证据push-first-24-of-25、serial-types-7、push-final-25。P2充值旧候选聊天分片重跑65通过/1跳过，已按授权正常重新排队，尚未合入；本项仍等待P3实际集成后最终重基。

2026-11-02刷新依赖：P4原本b4ddf725的一提交已从旧base63d23剥离到P3暂存栈b766a58cc，重放后0cf4c071；当前P4剥离父应为b766，P5仍从其原父b4dd剥离，勿混用。P2充值尚未实际合入，P3/P4均未提前PR集成。精确追加本项welcome SQL至恢复fixture reviewedSuffix：先1失败/1通过，补清单后2/2通过，未知/缺失/重复拒绝不变。当前实际复验provider61/61、隔离PG/真实注册HTTP六文件58/58，peak7，清理3s完成；真实注册邮件worker禁用，仅验证durable outbox。证据refreshed-*及migration-scope-*。默认epoch仍关闭；没有存量赠送或生产激活。保存检查点后独立复审，最终仍须前置实际合入、重基到实际develop并复核SHA。

唯一worktree /Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui；当前worker/cn-us-welcome-credits，父a1d5cbf93。本session不新建worktree、不改共享checkout分支。UI6087已正常合入develop25320a892，issue6086已由PR关闭。

本项已完成本地实现及验证，接着提交并按exact SHA独立复核。当前验证进程均已结束，可以切个人契约分支准备6088独立PR；保留本项分支，前置合入后再剥离依赖。所有开发前fetch main/develop；仅目标develop。

依赖对齐：contract分支原head499c22a20、旧UI父d4cf39b6e，rebase --onto origin/develop d4cf39b6e worker/cn-us-pricing-contract，并重写旧subject中的(#6088)为Refs #6088，避免队列解析issue为PR。原contracts billing-pricing.ts文件头仍有旧snapshot兼容措辞，须改为新系统/旧数据全部重置，不承诺旧权益。契约合入后目录旧父499、充值旧父41cf、年付旧父d5依次剥离；每个PR只含自己issue，最后本项剥离旧a1d5父。强推仅自有分支且精确force-with-lease。所有新提交用Refs #N，不用括号issue号。

赠送：SQL由generate-welcome-credit-schema.ts生成。新账号创建是唯一赠送入口，触发器在原注册事务中运行，不新增高权限函数。只读billing_pricing_epoch默认空；正式激活/全量旧计费清理由最后窗口做，不可在普通app路径启用。BILLING_ACCOUNTING_GENERATION独立于价格目录。不要把首次读/登录当补赠入口。

readWelcomeCreditGrant是内部读取组件，完整权益HTTP仍未注册。所有公开读取继续通过既有可信user owner校验；不得直接暴露该函数的userId/时钟参数。生产期限固定时间长度，SQL数值/枚举源为contracts，不手改生成迁移。赠送与付费批次一起按到期优先扣，永久余额是推导值。

证据：contracts1248/provider61/PG56/HTTP2/UI5以及API/Web类型、lint；HTTP邮件worker明确禁用，未向真人发信。旧auth未激活回归56项通过。所有测试通过标准隔离wrapper运行，结束后自动释放；3526预览已停止，不碰部署/邮件会话Chrome或服务器。独立审查通过但须最终exact SHA复核。
