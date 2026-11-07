# Team / Enterprise 当前设计进展

Issue6099 / Draft6101。唯一树cn-us-pricing-ui，worker/cn-us-team-billing-design。正式design-signoff仍pending/covers[]；无Team销售、生产reset/epoch或部署。

用户已确认：Enterprise升级保留已付Team基础/增员计划，按原购买日到原paidPeriodEnd继续发放，停止未来续费；新增Enterprise额度手动添加。记录human-decisions.md。不得重复提问或扩张为整束签核。

个人P5 PR6103正常合入develop 1f63fb1144a3b4df865fa88d62161303140ad164，issue6093由PR关闭；72项合入前check在合入前完成允许结论。actual-p5-base与personal-prerequisite-merged保存重基、整树、CI和ancestor证明。整树证明仅对应299检查点，后续日历修复另记，不冒称仍逐字相同。

已物化：严格输入、原锚点付费期限、四类quote、目录、组织权益/月授予、已付历史、支付恢复/首期收据、Enterprise手动额度、平台摘要、升级恢复操作、code错误闭集。平台Plan/PlanState/PlanWrite为organization-plan单源；原平台namespace保留导出和旧pending读取。新操作设计在operations.proposal.ts，可执行但尚非真实API；签核后随路由逐项迁入正式operations及补代理。首次正式注册被rewrite门识别七项缺口，已保留原失败，无allowlist或门禁豁免。

原型消费目录/quote/权益/历史/支付恢复/手动额度；平台列表现直接消费OrganizationRow和升级操作，取消另持Enterprise布尔值。模拟升级保留term、wallet、当期grant，不预发剩余年付。没有计费或平台HTTP。

fd检查点：共享个人日历逐字移动/旧API路径同函数转发，修复迟处理跨月复活旧首期；反例6红→132定向、contracts1386、UI65、真实个人API/PG94、typeslint9、browser5通过。人类政策闭集再1红→contracts1388/UI66、typeslint9、browser5通过，清理0秒。证据calendar-review-fix/prepaid-human-decision。该证据不代表Team运行时已实现。

当前平台增量：summary/operations19项通过，完整contracts1407通过（操作提案迁出前），迁出后定向19再次通过。平台/Team UI29项通过，随后仅固定模拟grant时钟；最终UI重跑、类型与浏览器仍在收尾。代理/契约路由/body-path/否定性断言门禁均通过。API授权单独裸跑被隔离保护在运行前拒绝，未访问共享库，不能记通过；后续须隔离运行。浏览器因共享机器高负载正在排队，未绕过。

PR6101此前由外部操作转ready入队，已按明确指示正常dequeue、恢复Draft，核对后精确lease推fd；公开说明issuecomment-6567452969。当前不得重新排队未完成设计。后续保存新检查点、精确SHA独立一致性复核，最终验证后一次性请求整束人工签核。

真实Team销售前硬前置：所有组织成员入口容量锁/并发；total_granted及所有授予/读取路径小数精度迁移；真实支付、保留已付9窗worker和AI准入等验证。当前这些仍是coverage.md的验收计划，不称为已通过。

## 最终设计检查点

0dca410445ac68f15bd06a3ec8339048e93283eb已独立设计一致性ACCEPT，三项P2闭环、五图独立目视；最终Team/平台UI34、browser7零财务HTTP/cleanup1s、平台实际权限/PG14/cleanup4s、proposal19及类型lint6全通过。前次类型TS2307通过复用同一object schema修复；旧中间态11任务结果不覆盖提案目录依赖，以最终6任务为准。原失败保留。证据design-gaps。

全部三件材料和增量UI已齐，待一次整束人类签核；S4 tested/S5 done/S6 todo。没有把设计审查改写成人签，也没有Team运行时假passing。下一步签核后按implementation-slices逐项实施，先容量/PG精度等硬前置，再开放Team。

2026-11-02T03:10:53Z PR6101旧fd再次由usersyj转ready，03:11:01及03:12:54入队。已正常dequeue、restoreDraft，再次dequeue后动态确认Draft=true/queue=null/autoMerge=null；disable-auto因未启用明确拒绝，不存在残留自动合并请求。时间线无法区分共用同账号的真实操作者；merge_group工作流在入队之后触发，不能倒因为果称其为入队者。已通知上级并在PR/issue明确整束pending禁止入队，不改全局队列规则、不打断其他PR。

用户现已明确确认整束设计并授权回填、分阶段实现；唯一design-signoff.md已据直接授权记录confirmed（S6 done），covers仍空、不虚构runtime feature通过。此前“等待人签”的历史段落已由本条实际答复取代。正常PR检查/独立审查门禁继续；下一步先整理销售前置的独立可验证切片，禁止大PR先收费后补容量/精度。
