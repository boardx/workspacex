# Team / Enterprise 设计进展

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

Issue6099，worker/cn-us-team-billing-design，当前base actual develop c04c332a（P4 PR6102真实merge），原Draft远端096892902从685剥离重放为84c4eafdcffde0974a3db99aad4eeabc32a8e426。本次开始可执行第③件材料，不实现Team backend/SQL/支付/真实账务，不改pending，不混入P5 PR。

首批packages/contracts/src/billing-team.ts：严格购买quote/checkout输入、Team付款期限与月额度、Enterprise升级输入及手动额度输入/收据。复用既有BillingProvider/周期/额度/Plan版本及原因边界；新增Team基础席位和月度额度常量供已采用原型消费，不在原型再持多份。Enterprise原型使用实际schema校验输入及模拟receipt后才更新模拟余额，UI仍仅Enterprise加额度、无真实请求；原布局和危险动作确认保留。

真实验证：初始宽松stub反证26中25红，严格schema后首26绿，补全四purpose财务/身份注入反例后全contracts1278通过（含新30case）；原型原因超限真实1红5绿，修后2file8项绿。serial types/lint54/54（39cached）通过；随后把已有pricing-preview5用例接进既有prototype-audit profile，实际browser5过、0s清理，包含响应式/地区价格/Team容量和到期/Enterprise确认与原因校验/7态，并断言无billing/平台组织请求。原始输出保留evidence；新增4张图在ui-preview/team-contract-v1，未覆盖已采用截图。此材料层通过不证明真实guard/付款/并发。

未完成第③件：catalog/quote响应、完整组织权益/历史/支付恢复结果、平台列表summary、升级操作/影响及错误/operation导出仍待补齐，再正式一致性复核及一次人签核。schema模块当前不导出runtime operations，没有新生产路由。下表runtime验证全部计划，不因30case或5browser宣称17UC完成。

新P2业务口径：原稿“停止未来Team额度”会包含已付年费未发窗口，现已在domain/UC/API/signoff明确等待用户裁决，不默认停止/退款/折抵，取消未来续费不能偷换为停止本期已付额度。已用request_user_input_async问“继续原计划至已付期结束（推荐）/停止原计划剩额手动处理”，答案未到，不重复问或把超时当采纳。只阻塞依赖的升级影响/worker定稿及正式复核。

个人支付PR6103 source e419 CI已全完成，但GitHub自动审查指出P2：后端错误在code，前端只读ApiError.reasonCode导致目录拒绝后保留失效意图。当前未入队/未合入，须先保存本设计检查点，回P5修真实envelope回归、按新SHA独立复审与正常CI到绿，不直接resolve绕过。本次定价正常develop集成授权持续，生产未操作。

本报价增量受影响 contracts/web 串行类型及 lint 6/6 通过。前文首批检查点“quote结果待补”的范围现已由本增量补齐；其余完整响应及 operation 缺口仍保留。

独立增量复审095671339指出P2：微信报价缺少CNY交叉约束。补四purpose反例先4失败/15通过，公共refinement修复后核心49通过，保留Stripe CNY/USD四purpose正例；原型11再通过。错误已修，待最终精确SHA复核。原browser5在仅缺这项负例约束时运行，正向原型数据未变化，不重复声称本轮重新浏览器运行。

共享累计字段和余额约束最终修改后，API/web受影响依赖的串行类型/lint9/9再通过（4cached），execution-plan check通过。待精确SHA独立复审与正常push，不把旧报价ACCEPT扩张为本增量批准。

独立复审5809b682发现真实P2：cancelAtPeriodEnd=true只覆盖安排取消，已实际取消的Stripe可能false，不能因此丢旧付款事实。读模型现复用SubscriptionStatus闭集，Enterprise接受真实canceled/incomplete_expired或安排到期取消，拒绝未知/none及仍续费；微信status为null。更新可信响应fixture和反例后先8红17绿，再核心74绿、原型14绿、全contracts133文件1322绿。此为付款状态技术修正，不决定未答的已付未来窗口政策。最终新SHA独立复审仍待执行。

取消状态最终修正后的API/web串行typecheck/lint9/9通过（4cached）。浏览器5证据属于仅新增状态/负例约束前的相同界面，未宣称本轮再次运行；后续新SHA正常hook、CI及独立静态复审继续。
