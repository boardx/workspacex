# Team设计在建交接

已付历史材料：TeamSubscriptionHistory/TeamHistoryQuery保留实际purchase/receipt、付款快照/期限和增员正增量，默认10/最多50的opaque cursor分页不接收query里的org/generation。年付一笔付款一项，月额度不造付款记录，永久充值留在钱包/订单历史。Purpose改为同一闭集供request/quote/history复用；微信币种也复用同一判据。签名、真实范围和付款仍待runtime验证。

先schema12红、原型占位行2红；最终定向Team五文件100通过（含新12），原型六文件22通过、扩展真实browser5通过（含年付一行/过期状态、零计费HTTP，清理0秒），最终API/web串行typeslint9通过。前一轮全contracts1336保持为前一轮证据，不伪称本次跑过全1348。截图已目视复核，raw在evidence/history-contract/。

设计签核文件已整理为当前单一范围说明，pending/covers[]保持不变；剩完整支付恢复、平台摘要/操作结果/错误/operations和未决已付窗口政策。目录检查点1309已正常push并独立Draft ACCEPT，本历史增量待新SHA复核/push。P5正常queue candidate1f63仍awaiting，未宣称合入；生产未操作。

组织目录增量：TeamCatalog 物化目标组织目录，基础5席/100,000月额度、增员单价/每席15,000月额度及同schema永久充值。个人GET /billing/catalog保持既有严格形状，新组织GET /billing/organizations/:orgId/catalog仍是待接线路由。共享PricingCatalogBase/validatePricingCatalog保证两类目录同源约束，不复制价格；没有新后端或operations导出。

原型Team价格和quote的org/version/SKU/currency从严格模拟目录消费。先目录13红/1既有个人正例绿，新增mock4红，最终全contracts134文件1336通过、核心目录相关95通过、原型5文件20通过。直接US增员及CN->US组件切换曾真实2红2绿，修为随当前市场同步选支持渠道；真实browser仍5用例，新增US Team增员并实跑通过、清理0秒，截图目视复核。最终API/web串行types/lint9通过。证据在evidence/catalog-contract/。

完整历史/支付恢复/平台摘要/operations及未决已付未来窗口仍待补齐，signoff pending不改。数据库小数累计和所有成员入口容量前置尚未实现，销售保持关闭。本增量待新精确SHA独立审查和push；个人P5 source f826已获门禁READY并正常进队列，实际candidate 1f63fb1144a3b4df865fa88d62161303140ad164仍AWAITING_CHECKS，尚未合入。

组织权益材料：TeamEntitlement 区分未开通/有效/到期/Enterprise，许可不代替成员、AI策略与余额准入。原已付期限/容量、当前月授予和同组织共享钱包分开，保留永久余额及负债，未知事实不填0。Enterprise可无旧付费期；有旧事实时保留，不由读模型决定未来已付窗口处置。原型已消费严格模拟权益取得人数、已购容量、余额及月余量，布局不改，无真实HTTP。

先缺schema19红，再时区等价1红/20绿，新增小数累计与余额分量2红/21绿。共享CreditWallet.totalGranted改为非负两位精度以支持首期小数，不另建Team钱包契约；现数据库total_granted仍integer，已在domain/coverage明确迁移及所有授予写入适配为销售前置，材料不执行SQL、不假装PG支持已完成。最终全contracts133文件1320通过，原型四文件14通过；原型消费权益后的实际browser5通过，清理0秒，之后仅小数/余额负例约束改动，未虚报再次browser运行。完整历史/恢复/目录/平台摘要/operations仍待完成。

报价材料增量：TeamQuote 封闭四 purpose 结果，绑定组织/代际/目录/整数金额及有效期。增员保留原付费期限，另列当前月额度窗口与首期预计 credit。到期前极短窗口向下舍入可为0。先缺失 schema 12红，再零估计1红/12绿；最终核心两文件43通过。原型消费严格模拟报价的金额及共同到期日，保留原布局/价格/50%演示，无真实 HTTP；新增 fixture 先3红，合并原组件三文件11绿，真实 browser5绿，清理0秒，截图已目视核对。证据在 evidence/quote-contract/。完整 catalog、权益/历史/恢复/平台摘要/operation 等仍待完成，签核保持 pending。

P5 错误信封已修复并推送 f82673afaa7573d4a72a2402a4cbd6a21c60b365，独立增量 ACCEPT、原审查线程已回应并解决。新 CI 仍运行，继续跟进正常合入。Team 首批4c6已发布 Draft6101，独立检查点 ACCEPT；本报价增量待新 SHA 复审与 push。

唯一树/Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui，当前worker/cn-us-team-billing-design。actual basec04，重基source84c4（旧Draft0968/旧父685），远端目前仍096892902ec1e987872e1a35756e928c34164ca2；后续仅自有分支精确lease，当前本地检查点待独立静态复核及新browser config门禁，仍Draft6101、不合入、不人签。

首批可执行核心schema/3个原型消费组件已完成，contracts1278（新30）、原型8、browser5、serial类型lint54绿，红例证据和4图已保存，见progress/README。没有runtime operations/API/SQL/支付/持久化；完整正式第③件仍有明确缺口，不把材料层测试当真实权限/事务通过。现有pricing-preview.browser进入原有CI prototype-audit profile，不新增无人跑的车道；取证默认test-results，旧签核截图不覆盖。新增UI图片索引ui-preview/team-contract-v1/README.md。

已付窗口P2：问题已发等待用户，不能默认停止/退款/折抵。B1 blocked仅限制相关升级影响/worker定稿与正式复核，其余独立输入材料可继续。design-signoff pending/covers[]不改，个人确认不覆盖本束。平台手动额度是Enterprise-only、整数1..1m+原因；沿用原升级确认，无新原因表单。

下一优先回P5修PR6103 auto review P2：原server响应code、client读reasonCode，组件用例曾用错误reasonCode掩盖。需要真实HTTP envelope断言+客户端回归，修正后新SHA独立review、回应/解决该已修线程，并跟进正常CI/queue。P5远端e4190cddde7db9d260fc3a470012b2a074b4b7e4，actual basec04；已完成此前Stripe fragment P1及nilbinding/QR P2，本次新P2不能忽略。P5本地full是主动中止exit1、不是PASS，剩余完整API在其标准CI/queue验证，不缩范围。

当前browser wrapper已清理0s，无本任务Next/Chrome/compose驻留；只做本树，不动共享checkout/stash或其他发布/邮件资源。Node固定22.23.2；不执行生产reset/epoch或部署。

本报价增量 contracts/web 串行类型及 lint 6/6 通过。首批4c6材料的“quote结果待补”现已补齐，其余响应与 operation 继续在 S4 完善。

报价复审095671339的微信USD P2已补公共约束与反例：先4红15绿，再核心49及原型11绿。等待最终SHA复审；新运行时未启用，原browser5未因只增加负例约束重复执行。

本权益增量最终contracts共享字段修改后serial API/web types/lint9绿、计划check绿，等待最终SHA独立审查与push。销售前必须先落实真实PG小数累计及所有授予路径适配，不因1320个契约测试通过就开启Team。

5809权益复审P2已修：新增真实subscriptionStatus，已取消Stripe可保留false的cancelAtPeriodEnd及原paid term；未知和仍续费反例保留。核心74/原型14/全contracts1322新绿，raw证据已保存；等待最终新SHA复核，不沿用5809为ACCEPT。
