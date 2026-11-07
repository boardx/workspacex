# Team 设计接续

唯一树 /Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui，worker/cn-us-team-billing-design，不另建树/不操作共享原checkout。实际基线P5 merge1f63（个人PR6103已合入）。最终源码0dca410445ac68f15bd06a3ec8339048e93283eb独立设计一致性ACCEPT，三项UI P2均闭环，五图独立目视。后续仅补录证据/交接，源码不变。

人类已确认保留原已付Team发放到期、停止未来续费，Enterprise额外额度手动，并对完整①UI②用例③API明确回复“确认整束设计，授权回填并分阶段实现”。唯一design-signoff.md已据直接授权confirmed；不要重复呈签核或等待此问题。操作提案operations.proposal.ts不冒充真实路由，后续随各实际路由迁入正式billingTeam.operations并补代理/HTTP校验。

最终新材料：proposal19、Team/平台UI34、browser7零财务HTTP/cleanup1s、真实平台权限/PG14/cleanup4s、web/contracts类型lint6全通过。首次仓储beforeAll60s迁移超时，随后同一隔离DB先ensureDatabase/migrateOnce再原样测试通过；未修改测试超时。proposal外部zod导入TS2307已改复用原object schema，最终6任务才是当前结果。证据evidence/design-gaps；contracts1407全量是操作提案迁出前，迁出后新导入及操作19/类型通过，边界保留。

PR6101须保持Draft且不入队到完整人签。两次外部ready/queue已正常撤出恢复Draft，最新03:10:53Z操作者usersyj（共用账号不能定位真实会话）；autoMerge原本null，disable-auto明确拒绝，最新确认Draft=true/queue=null/autoMerge=null。上级已收到排除信号，不更改全局队列或干扰其他PR。推送前再次动态核对状态。

签核后按implementation-slices切片，当前未开始Team runtime/销售，成员容量锁/小数PG迁移/真实支付worker/准入仍待做，不标假passing。Node22.23.2。拥有的隔离栈和浏览器均已释放，唯一工作树保留继续任务；不触碰其他发布/邮件会话资源，不执行生产reset/epoch或部署。
