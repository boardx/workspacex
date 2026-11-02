# Team / Enterprise 当前设计进展

Issue6099 / Draft6101，唯一worktree为本会话cn-us-pricing-ui；分支worker/cn-us-team-billing-design。Team runtime尚未开始，design-signoff pending/covers[]。不执行生产reset、epoch激活或部署。

用户2026-11-02已确认：升级Enterprise保留已付Team计划至原paidPeriodEnd，停止未来续费，额外Enterprise额度仍手动添加。规范在domain.md，原答复记录见human-decisions.md；B1已解除，不再等待此问题，也不把业务答复扩张为整束签核。

个人P5 PR6103已于2026-11-02T01:00:14Z正常合入develop 1f63fb1144a3b4df865fa88d62161303140ad164，6093由PR关闭。fetch及ancestor退出0；72个合入前启动的check均在合入前完成允许结论，post-merge7项单独统计。证据personal-prerequisite-merged，未将此前本地full主动停止exit1改写为PASS。

Team从c04上12提交重基到实际P5：源码检查点299fc7a274273543298ecb56ba2353fbb8532f33，range-diff全=；独立临时index将原Team全量delta作用于P5，整树与该检查点精确相同eadb9e221dece7fdcaaf6c6a94b31252a9751029。后续新增日历修正是该检查点之外的明确增量，不把旧整树证明冒充当前无变化。actual-p5-base保存quick init、全contracts1372/UI65/browser5/typeslint9原始通过结果。

已物化核心输入、Team付费期、quote、目录、组织权益/月授予、已付订阅历史、手动额度输入/收据、支付恢复/首期收据。原型消费目录/quote/权益/历史/增员收据/手动额度；没有真实计费HTTP，所有结果是演示。平台摘要、升级操作/结果/错误/operations尚待完成，之后正式一致性复核及一次整束人签。

支付结果检查点299的独立复审P2已修：实际paidAt决定首期月窗，不能迟处理时换到下一月复活旧首期；付费期、quote和grant也绑定原UTC锚点。先6红/118绿，旧个人calendar函数逐字移动至共享billing-credit-calendar，API旧路径只转发同一函数/类型。新定位函数覆盖月底/闰日/等价时区。calendar-review-fix下定向132、全contracts1386、UI65、原个人API/真实PG94、typeslint9、browser5通过；PG及browser各自动清理0秒。此轮未实现真实Team worker，也未迁移total_granted。

人类决定已物化EnterprisePrepaidTeamPolicy闭集，升级body不能覆盖政策/制造期限；UI确认说明保留计划且不预发剩余9月，余额不因演示升级增加。先核心1红32绿/界面1红6绿，随后全contracts1388和UI66通过；最终policy版本types/browser仍在单独核对，未用前一轮结果冒称重跑。证据prepaid-human-decision。

真实Team销售前仍须落实所有成员入口的容量锁/并发，以及total_granted两位精度迁移和所有授予/读取路径适配。Enterprise已付9窗继续、每窗仅一次、原截止后停止等E03反例目前是coverage.md中的runtime验收计划，不能把schema/模拟文案测试称为已通过这些业务链路。

当前未提交的日历修复与业务决定增量需保存最终证据、精确SHA独立复审，再以远端旧head1b79b19d0371a24aa1092c072a5ee54f1904fc04为精确lease正常push重基后的分支。旧Draft检查点ACCEPT不覆盖新增量；不合入未完成草案。

最终政策版本serial API/web types/lint9及browser5均通过，browser零计费HTTP、cleanup0秒；原始输出已保存prepaid-human-decision，升级图已目视复核。日历函数本体和个人API转发未因这次文案/政策闭集修改改变，之前真实API/PG94证据仍明确限定日历提取回归。
