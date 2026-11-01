# 个人支付闭环进展

套餐选择及浏览器恢复指针组件增量：使用真实目录SKU/月年周期/渠道，阻止重复Pro和USD微信；只向上游选择器传SKU/provider，不提交客户端金额。请求前保存本人原幂等键，损坏恢复指针不静默清除；结果仅绑定原payer/请求/provider，拒绝不可信地址。付款/门户URL校验收敛单源并复用旧收银台/月卡组件。新13UI+恢复4及旧cashier51/liveSubscription17合计85通过，Web type/lint4任务通过，见ui-quote-state-*。未接生产路由/未冒充真实商户E2E。待签修订已补同一POST幂等恢复的null地址与原purchaseRef，客户端随后GET权威结果；仍pending、未改契约。

当前边界更新：ecb383b16订单读取检查点独立审查有P2（已到账但原创建绑定缺失时503），尚未ACCEPT。已准备personal-order-outcomes-v1具体修订并独立一致性复核：终态地址/期限可null、待支付强制真值，异步等待人类签核；未实施依赖该修订的代码。

不依赖修订的账户只读UI已按采用布局实现为组件，尚未接生产路由/支付弹窗：真实catalog/wallet/entitlement读取，严格本人钱包且必须有永久余额，独立错误/重试、不虚构Free赠送，年付/额度周期分离，按实际provider显示续费；scope切换即时隐藏旧数据，门户链接限可信Stripe地址。React9项、Web typecheck/lint通过，见ui-account/overview/read证据；这是组件验证，不冒充真实浏览器支付证据。

新订单状态读取复用既有私有GET /billing/orders/:orderNo：按payer与generation绑定，真实快照金额/币种/额度，实际fulfilled为成功、人工复核为失败、权威closed才关闭，本地超时仍pending。notifyAt未知保留null，不拿恢复查单验证时间冒充回调时间。active不回退旧表；旧cancel拒绝新订单，避免绕过新财务流程关商户单。完整Stripe30及真实HTTP/旧订单/Root45通过；notifyAt修正后针对1项再通过，其余29为过滤。初版type/lint7通过，最终源由推送门禁复验。尚待正式UI绑定与整feature审查/PR。

管理/历史及旧购买入口退役增量：管理门户只读取当前payer、当前generation的已验证Stripe绑定，销售开关关闭仍可管理；终态不可管理；年付历史按实际paid term一行，保留真实金额/币种/有效期而非月度额度行。active epoch旧info/upgrade退役，旧订单在商户调用前及实际落库/到账事务内拒绝，旧Stripe无session的GET恢复也先检查。未知epoch拒绝，不推断旧权益。新增3个PG用例先红后绿，Stripe全29项及旧模式/Root/HTTP9文件97项通过；补充直接旧财务边界1项通过（过滤其余28项），不把过滤用例计为执行。API type/lint7任务通过。证据management-*、retired-sales-*。最终reset仍须冻结销售并排空旧进程，不能仅凭新代码advisory锁宣布老版本已受控；未执行生产reset。待本增量精确审查，订单状态读模型/正式UI继续。

自动补账组件已完成正式BillingModule接线：共享StripeStore供webhook与worker使用，0/60秒有界公平队列、失败重试、停机排空、单进程不重叠；每次入账仍走权威支付验证和代际锁。完整createApp/真实HTTP/PG/平台RSA查单证明：关闭新销售时无需回调或手动runOnce，遗漏微信付款自动补回且receipt/ledger各一笔。Stripe原session未落库时可从已验证财务绑定恢复；未绑定且超过原支付重试窗口的意图转人工复核，不新建第二笔支付。

本轮provider162、隔离PG/HTTP54（主命令实际5文件39项，另正确路径意图/微信2文件15项）、API typecheck/lint7任务通过，隔离资源清理成功；证据recovery-auto-*。主命令包含两个不存在的过滤路径，未计入通过数量，已另跑正确文件。当前准备精确SHA独立审查与检查点推送，#6093整体仍待管理/历史/正式UI及旧入口代际隔离，未完成、未创建整feature PR。


目录PR #6095 已实际合入develop：mergedAt2026-11-01T18:58:35Z，mergeCommit6a1a3c62efa31d78cfd5337eccecb672ddb6dd0a；此后的旧“队列检查中”是历史记录。下一步充值 #6090 剥离旧父41cf，单issue PR继续。

分页补账组件：固定Clover invoice list官方Markdown已核对；请求仅取对应subscription已付账单，每页5张、列表响应256KiB上限，拒绝重复/不前进游标/跨订阅或环境页。每张账单独立走原财务验证并核实receipt属于原绑定购买；页失败或停机保留原游标，已入账单重放幂等；过期月份不会恢复可用额度。先13项缺方法红，修正fixture密钥并收紧负例断言后13项协议绿；新增PG3项先缺方法红，再含跨页路径共25项最终通过。provider159、API typecheck/lint7项门禁通过，见evidence/invoice-*。仍为组件，自动定时调度、unbound处理、管理历史和正式UI未完成；不宣称 #6093 完成。

目录 #6095 source319d89d已获仓库READY_TO_MERGE且审查线程0，按已授权正常入队，记录时候选6a1a3c62efa31d78cfd5337eccecb672ddb6dd0a（位置1）仍检查中。后续必须重读实际mergedAt/mergeCommit，不把入队当合入。

恢复组件新增：confirmClosed 在epoch/user/购买行锁下校验原归属与session，只释放支付商权威确认关闭且未到账、未人工复核的购买，保留原幂等读取；旧本地计时器不能证明关单。PersonalPaymentReconciler 校验完整报价/代际/session后查单，微信付款赢关单竞态时走原到账事务；Stripe后台同步有独立 reconcileCheckout/reconcileSubscription 入口，不捏造验签事件。意图关闭3项先红后绿，恢复单元12项先缺实现后绿；最终39项隔离PG/HTTP（Stripe21、意图10、微信5、HTTP3）、provider146、API类型和lint均通过，资源已清理，见evidence/recovery-*。组件尚未接自动调度；未绑定意图仍安全返回unbound，完整分页漏通知对账、管理历史、UI待办见recovery-notes.md。

前置目录 PR #6095 已创建，head319d89d44c74346cf2b5763bf6c4d7eabead20be，基线a2d305；新基线provider41、独立ACCEPT、20项推送门禁通过，持续跟进CI。当前这份支付代码仍是后续独立issue #6093，不混入该PR。

微信正式接线后的独立复验已完成：personal-wechat-callback-pg.test.ts 5/5通过，隔离资源清理完成；证据 evidence/wechat-wired-final.txt。本轮全部列出的检查点验证均结束，不表示漏通知/恢复/正式UI等待办完成。

最新检查点：Stripe 财务/回调19项及共用到账10项合计29/29，另含真实HMAC回调HTTP及权益鉴权的18/18，provider15文件134项，API typecheck/lint 均通过。29项命令误带了不存在的微信HTTP过滤文件名，因此该日志实际只有两个文件，**不包含微信5项**；微信按真实文件 personal-wechat-callback-pg.test.ts 单独复验。新增权益查询只读取对应订阅/方案的额度窗口，不混用另一份 Stripe 绑定。证据为隔离 PG、真实签名/HTTP，支付商权威查询仍是 fixture，未进行在线商户扣款。本轮是 #6093 检查点，未完成全 feature；尚待异常购买恢复、漏通知对账、管理/历史、正式 UI 接入和完整独立审查。下文保留各历史步骤。

Issue #6093，执行已确认 personal-pricing-v1 设计；唯一工作区、worker/cn-us-personal-payments，父 1d2411a2fa769756efd28175c59fb6aee8441dea。前置 #6088 的 PR #6094 等待 CI；后续依赖分支按顺序独立集成，最终本项剥离旧父再提单独 PR。

实现前先固定支付商协议与购买绑定失败测试。Stripe API 固定沿用仓库 2025-09-30.clover，官方 Checkout 文档确认 subscription mode、recurring interval month/year、币种小写、expires_at 仅允许创建后30分钟至24小时；不照搬旧微信15分钟到 Stripe。

资料：https://docs.stripe.com/api/checkout/sessions/create?api-version=2025-09-30.clover；https://docs.stripe.com/api/checkout/sessions/create.md?query=line_items&api-version=2025-09-30.clover；https://docs.stripe.com/billing/subscriptions/webhooks。

Ruling: 单次购买意图使用服务端持久化报价与原始 provider 幂等身份，支付调用在事务外；重试不生成新支付身份。新入口默认受 dormant accounting epoch 约束，当前不执行真实清理或激活。

2026-11-02：Checkout 14项与到账绑定24项定向测试已红→绿。PG意图测试已在隔离wrapper中因repository尚缺而失败（6项待实现）；一次裸跑被标准环境保护拒绝，没有访问共享数据库，该环境错误不作为功能红证据。全API类型检查结束并指出3处测试fixture将价格推断为字面量联合，故故障注入的1不被允许；恢复后将fixture金额显式拓宽为number，再复验，尚无类型通过结论。当前切回契约分支修复 #6094；本项全部改动精确stash保存，恢复后继续持久化与支付闭环。

契约PR #6094 的精确代理修复 fa09a6c17 已推送并获独立ACCEPT，20项推送前门禁通过，当前等CI。本地附加 verify:harness:raw 的静态门已执行到末项且无失败；额外全harness测试阶段主动停止，不声明该整套命令通过。现在恢复本项，继续待实现的PG意图测试。

当前增量：服务端报价、持久化幂等意图、epoch关闭保护、Stripe协议与到账校验、独立HTTP控制器。provider 14文件113项、隔离PG意图7项、真实回环HTTP2项与API lint均通过。新增SQL约束测试先暴露NULL三值逻辑允许半绑定，补显式非空后7项全绿；应用角色不可修改原报价。HTTP使用真实PrincipalGuard/全局错误边界/PG，PrincipalResolver与上游支付为fixture，不能宣称完整生产登录或商户在线付款。

尚未将新控制器注册进BillingModule；微信适配器、支付到账持久化回调、Stripe续费状态与过期意图恢复仍待实现。只完成上述组件，不宣称 #6093 已完成，暂不创建未完成PR。API类型检查复验运行中。

检查点：新增微信一次性月/年/充值适配器、权威查单和关单后重读，配置平台公钥时拒绝未签名响应。provider全量15文件129项、API typecheck、API lint均通过；PG意图7项和HTTP2项的证据仍为此前对应实现。正式BillingModule接线、到账持久化、Stripe订阅续费/管理与异常恢复继续待实现，本检查点不等于feature完成。微信官方Native说明已核实：支付结束时间不足下单后1分钟会被上游调整，故创建前留1分钟余量；关闭结果只认权威重读，不能仅凭本地时钟。资料：https://pay.wechatpay.cn/doc/v3/merchant/4012791877。

微信到账检查点：真实RSA/AES回环HTTP与PG回调5项（含激活前旧路径、激活后旧订单忽略、未知generation拒绝）；支付事务10项。两文件最终15/15通过。此前意图7项/HTTP2项及provider131通过；本次API类型与lint通过。外部支付商仍为带真实签名的fixture，不代表在线扣款；正式BillingModule接线及Stripe Pro绑定/自动续费尚未完成。

Stripe 绑定与到账：新增不可变 subscription/purchase/session/customer/price/原购买日绑定；绑定状态和 cancel_at_period_end 独立更新。14项事务测试通过后，新增回调重投、最新状态读取、欠费不发放、跨环境拒绝和旧 generation 不回落验证，19项通过。新增“旧期已过但 Stripe 尚可续费时禁止第二单”及“回调先到的 Checkout 身份不可被晚创建响应覆盖”两项测试先红，补保护后连同意图及 HTTP 共20项通过。正式 BillingModule 已接入新购买入口和双渠道回调；epoch 默认关闭，未执行激活或清理。新增付款期/月度额度/续费状态分开的权益读取，数据库与真实HMAC回调HTTP验证进行中。

最终 reset 的待办风险：P3 grantDuePersonalTerms/定时发放、AI 预留与消费落账、durable usage replay、legacy 回调实际财务事务均须在同一实际 DB 事务获取 epoch shared lock；清理持 exclusive lock。只在外层读 mode 或 worker 选取待处理列表不够，避免清理后由缓存旧记录重建钱包/补回旧额度。不要外层连接持 shared lock 又开内层连接重新获取，以免 exclusive 排队时产生互锁。仍须冻结旧销售、排空旧进程/任务、关闭未付订单并取消应用所属旧自动续费，再执行审阅过的清理和启用。

前置 #6088 / PR #6094 已正常合入 develop，合并提交 a2d305d11cac86df01737461b5b241bbac3c430e，2026-11-01T17:56:49Z；issue 已由该 PR 关闭。后续四个依赖分支仍须按顺序剥离旧父、单 issue PR、独立审查、正常合入。

独立review7ac972e45发现products新text-foreground无效，已改合法text-background-foreground；权威颜色扫描器针对新组件零问题。当前P5旧父全仓另有prototype两条旧问题，不豁免/不称全仓绿；切到已合UI的P2基线时全仓颜色门已绿，后续顺序rebase应带入正确版本，再全门复验。待签材料补齐同一payer/SKU/provider/catalogVersion、销售关闭后原key恢复、所有恢复先GET状态、三类终态零新增支付请求约束；仍pending未实现nullable。
