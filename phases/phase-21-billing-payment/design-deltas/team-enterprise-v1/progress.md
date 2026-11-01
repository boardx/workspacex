# Team / Enterprise 设计进展

Issue #6099，分支worker/cn-us-team-billing-design，基线为已实际合入的develop6a1a3c62e；唯一worktree继续使用cn-us-pricing-ui。用户已采用UI及商业规则；新增核心席位口径、折算精度／渠道差异、Enterprise生效及个人／组织归属方案在design-signoff.md明确待人确认，未代签。

已核对源码：商业组织与teams分组不同；计费ownerType=team使用organization ID；平台已有Plan/version/audit及PlatformOperatorGuard。材料包括UI对应、T01–T10/E01–E06、领域不变量、拟议API、覆盖矩阵和后续切片候选。没有修改运行时契约、数据库或业务代码，执行计划、UI材料、第三件材料三项静态门退出0；证据evidence/*lint.txt。待精确提交独立一致性复核，未声称任何运行时测试通过。

前置当前信号：充值PR6098 source48e04，原候选聊天分片一次重跑65通过/1跳过后正常重新排队，新候选d886e24310ae50e8f7c6a74bbceb87c052514025待检查，未实际合入。年付P3远端b766a58cc（剥离父48e04）；Free P4远端63bd75abd（剥离父b766）；个人支付P5远端1b6748d18（剥离父b4dd）。必须重读实际mergedAt/mergeCommit，不能凭此记录判断已合。

个人缺支付页绑定的终态恢复设计仍在P5分支待人签核；本设计没有覆盖它。生产reset、epoch、支付开关和部署均未操作。
