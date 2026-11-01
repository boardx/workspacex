# 个人支付闭环在建交接

独立增量审查3e034a8ce发现二维码首次绘制失败后刷新同一订单无法重绘的P2。新增反例先1失败/8通过，修复为保留画布并在成功权威状态刷新后重试绘制；最终9项通过，断言零第二次支付请求，Web type/lint4任务通过。旧93全UI及16browser证据在该小修复之前；本次未把未重跑的全套计为新通过。当前待修复SHA独立复审。

正式个人/billing路由代码已接入采用的UI，服务端BILLING_PERSONAL_PRICING_UI_ENABLED默认关闭；没有改部署开关、生产计费epoch或生产数据。正常微信与Stripe购买、真实账户读模型、本人订单状态、原key恢复、订阅门户/取消下一期均已接线。见ui-runtime.md。

当前完整浏览器车道4文件16项通过（原11+新CN2+DevApp USD3），计费HTTP不拦截；真实API/PG及独立RSA/HMAC支付商fixture，生产商户实付未验证。截图已目视核对；年付有效至一年、可用额度仅当月20k，取消下一期后权益保留。React93、审计/旧财务边界PG53、API/Web/local-runtime type/lint11及全仓颜色门通过；PGlite完整迁移和真实注册无赠送（epoch未启用）3项通过。390px移动端另补1项通过（另外2项被过滤），订阅历史可滚动访问并可刷新；证据见evidence/ui-runtime/。

真实浏览器先发现旧P5父缺已合Contract代理，已刷新依赖栈而非补假数据；之后发现active拒绝回调审计误受旧财务写入门控，新增红测后把只写安全事件的audit路径限定为两种已知epoch可用，旧金融事务仍只legacy；错误回调400、正常签名付款和重放均有真实验证。

当前本地依赖栈：P2 source48e04b39c（PR6098候选398603d48因chat shard2对/api/copilotkit/info发生ECONNRESET退队，未合入，待分诊重试）；P3 local63d23e154在base48，P4 localb4ddf725在P3，P5已重放11提交到5bdd0be77，range-diff逐项相等，当前运行时/审计增量待提交精确SHA复审。P3/P4未新建PR也未推此临时栈。P2实际合入后P3应从48剥离onto实际develop，再依次处理P4/P5。

阻塞整#6093完成的已知P2：到账早于支付页绑定落库时，旧非空字段契约导致恢复读取503。具体GET及同key POST可空语义修订在../personal-order-outcomes-v1/design-signoff.md；已完成独立一致性复核并异步请求人类签核，仍未代签/未改契约。用户本次定价正常集成develop授权持续有效，不重复询问续作或合入。Team/Enterprise与全旧数据重置仍后续阶段，未标passing。

## 历史检查点（不作为当前完成状态）

套餐选择及浏览器恢复指针组件增量：使用真实目录SKU/月年周期/渠道，阻止重复Pro和USD微信；只向上游选择器传SKU/provider，不提交客户端金额。请求前保存本人原幂等键，损坏恢复指针不静默清除；结果仅绑定原payer/请求/provider，拒绝不可信地址。付款/门户URL校验收敛单源并复用旧收银台/月卡组件。新13UI+恢复4及旧cashier51/liveSubscription17合计85通过，Web type/lint4任务通过，见ui-quote-state-*。未接生产路由/未冒充真实商户E2E。待签修订已补同一POST幂等恢复的null地址与原purchaseRef，客户端随后GET权威结果；仍pending、未改契约。

当前边界更新：ecb383b16订单读取检查点独立审查有P2（已到账但原创建绑定缺失时503），尚未ACCEPT。已准备personal-order-outcomes-v1具体修订并独立一致性复核：终态地址/期限可null、待支付强制真值，异步等待人类签核；未实施依赖该修订的代码。

不依赖修订的账户只读UI已按采用布局实现为组件，尚未接生产路由/支付弹窗：真实catalog/wallet/entitlement读取，严格本人钱包且必须有永久余额，独立错误/重试、不虚构Free赠送，年付/额度周期分离，按实际provider显示续费；scope切换即时隐藏旧数据，门户链接限可信Stripe地址。React9项、Web typecheck/lint通过，见ui-account/overview/read证据；这是组件验证，不冒充真实浏览器支付证据。

新订单状态读取复用既有私有GET /billing/orders/:orderNo：按payer与generation绑定，真实快照金额/币种/额度，实际fulfilled为成功、人工复核为失败、权威closed才关闭，本地超时仍pending。notifyAt未知保留null，不拿恢复查单验证时间冒充回调时间。active不回退旧表；旧cancel拒绝新订单，避免绕过新财务流程关商户单。完整Stripe30及真实HTTP/旧订单/Root45通过；notifyAt修正后针对1项再通过，其余29为过滤。初版type/lint7通过，最终源由推送门禁复验。尚待正式UI绑定与整feature审查/PR。

管理/历史及旧购买入口退役增量：管理门户只读取当前payer、当前generation的已验证Stripe绑定，销售开关关闭仍可管理；终态不可管理；年付历史按实际paid term一行，保留真实金额/币种/有效期而非月度额度行。active epoch旧info/upgrade退役，旧订单在商户调用前及实际落库/到账事务内拒绝，旧Stripe无session的GET恢复也先检查。未知epoch拒绝，不推断旧权益。新增3个PG用例先红后绿，Stripe全29项及旧模式/Root/HTTP9文件97项通过；补充直接旧财务边界1项通过（过滤其余28项），不把过滤用例计为执行。API type/lint7任务通过。证据management-*、retired-sales-*。最终reset仍须冻结销售并排空旧进程，不能仅凭新代码advisory锁宣布老版本已受控；未执行生产reset。待本增量精确审查，订单状态读模型/正式UI继续。

自动补账组件已完成正式BillingModule接线：共享StripeStore供webhook与worker使用，0/60秒有界公平队列、失败重试、停机排空、单进程不重叠；每次入账仍走权威支付验证和代际锁。完整createApp/真实HTTP/PG/平台RSA查单证明：关闭新销售时无需回调或手动runOnce，遗漏微信付款自动补回且receipt/ledger各一笔。Stripe原session未落库时可从已验证财务绑定恢复；未绑定且超过原支付重试窗口的意图转人工复核，不新建第二笔支付。

本轮provider162、隔离PG/HTTP54（主命令实际5文件39项，另正确路径意图/微信2文件15项）、API typecheck/lint7任务通过，隔离资源清理成功；证据recovery-auto-*。主命令包含两个不存在的过滤路径，未计入通过数量，已另跑正确文件。当前准备精确SHA独立审查与检查点推送，#6093整体仍待管理/历史/正式UI及旧入口代际隔离，未完成、未创建整feature PR。


最新WIP覆盖下文：BillingModule恢复worker已接线，PersonalStripeWebhookStore成为webhook/worker共享singleton；真实完整createApp自动漏通知补账root测试1通过（新销售关、实际HTTP401、真实RSA平台查单响应、PG只入账一次），worker3、PG队列7、financial-binding fallback针对1均绿。仍未全type/lint及完整定向回归，不能提交为完成。当前需再次精确stash，切充值分支修PR #6098 cashier-browser.integration.ts仍选择已停用pkg-cn-100导致CI超时；应改验证新catalog充值包，保留商户取消/无入账断言，不恢复旧套餐、不加超时绕过。根因日志/tmp/cn-us-topup-cashier-ci-failed.log。修完充值并使新SHA审查/门禁后，恢复本WIP做全部验证与精确审查。原db679备份保留，第二份stash会另记完整hash。

最新现场：目录 #6095 已实际合入develop，2026-11-01T18:58:35Z / 6a1a3c62efa31d78cfd5337eccecb672ddb6dd0a。支付已推送检查点346223a734f54782140c992fa4a0b1d0223f82c3获增量独立ACCEPT、20门禁通过。未提交WIP包含新恢复worker/端口、PG队列和400迁移、财务绑定session fallback、统一TTL常量。worker3、PG队列7、fallback针对1已绿；尚未全类型/lint，也未BillingModule正式DI接线。当前准备将这些自有路径精确stash，切充值分支剥离旧父41cf后提单issue PR，再恢复本WIP。不能把下文的检查点测试结果套到这批新源码。

恢复WIP后先修完root接线并全量定向验证（应含Stripe26及队列7），然后精确审查/提交。队列选取持epoch共享锁后释放，网络在外、实际财务再次验epoch；每种最多5条且游标公平，错误隔离。Stripe后台页中断不推进游标，status先权威同步、完整invoice页逐账入账；终态仍每天重查以捕捉晚付。未绑定超过原窗口保留人工复核，不制造新支付。正式Root目前仍旧factory内创建StripeStore，需抽成singleton provider给webhook与worker共享；worker.onDestroy停止后续工作并等待当前财务处理完成。

最新分页补账增量已验证：provider159（新增列表协议13）、PG Stripe25（含跨页、部分失败重放、停机页游标保留及过期不恢复）、API type/lint7项通过。页内每张invoice独立财务提交，确认receipt归属原binding购买后才推进页；列表不是付款授权。该增量待精确SHA独立复核。上一检查点d196fb5dfbf47a1bdb073154b91aa13fbb5aab52已远端保存、独立增量ACCEPT、20推送门禁通过。仍未接自动调度，unbound/管理历史/UI待做，具体规划见recovery-notes.md；全feature未完成。

目录PR #6095已在source319d89d上获READY_TO_MERGE、独立ACCEPT、审查线程0后按授权正常入队。记录时队列位置1，候选6a1a3c62efa31d78cfd5337eccecb672ddb6dd0a；不能从本文件推断当前是否已合入，先查实时queue/mergedAt/check-runs（per_page100+分页）。仅实际合入后依序集成充值、年付、Free；保留单issue PR，不把本支付源码混入目录PR。

最新增量为权威关闭/漏通知恢复组件，39项隔离PG/HTTP（Stripe21+意图10+微信5+HTTP3）、provider146、API typecheck/lint已通过。新增PersonalPaymentReconciler、confirmClosed、独立Stripe后台同步入口，尚未接自动调度。未绑定意图不生成第二支付身份；多期漏通知需完整分页而非latest_invoice，管理/历史/UI仍待，详见recovery-notes.md。新证据recovery-*。上一检查点7073ad7dede9a999224d4b456d7292bb1d8d31b6已远端保存并增量独立ACCEPT、20门禁通过；本轮增量后续精确审查，不能沿用其审查宣称全feature完成。

前置目录 PR #6095 / issue #6089 当前head319d89d44c74346cf2b5763bf6c4d7eabead20be（base a2d305），独立ACCEPT+provider41+20推送门禁，CI运行中。已真实剥离旧父499并创建单issue PR到develop；本工作区现已切回支付分支，不在目录分支上改支付代码。继续检查当前远端状态，READY后按已获任务级授权正常合入develop，再顺序剥离其余前置分支。禁止admin绕过或误取消他人run。

微信补充复验已结束且5/5通过（evidence/wechat-wired-final.txt），隔离清理完成；下段“正复验”为此前记录。

最新状态覆盖下文历史记录：#6088 / PR #6094 已于2026-11-01T17:56:49Z正常合入develop（a2d305d11cac86df01737461b5b241bbac3c430e），issue已由PR关闭；已通知授权协调父会话。当前 #6093 新增 Stripe 绑定迁移、权威 Checkout/订阅/价格/已付invoice到账与原锚点续费、真实status/cancel快照、账户权益API（付款结束/月度额度/Free批次独立）及正式BillingModule接线。原 Stripe 仍可续费时禁止第二单；回调先到的session不可被晚创建覆盖。新入口epoch仍默认关闭，未生产激活/清理。

最新验证：Stripe19 + 共用到账10 =29/29；此前真实HMAC回调及权益鉴权HTTP相关18/18；provider134、API typecheck/lint通过。29项日志中误带不存在的微信HTTP文件过滤名，不能算微信回归已跑；正用真实 personal-wechat-callback-pg.test.ts 单独复验。支付商为fixture，非在线商户。全项未完成：购买超时/过期恢复、漏通知续费对账、管理/历史适配、正式UI和完整独立审查仍待做，不创建未完成PR或标passing。四个前置依赖分支需顺序剥离父后单issue PR集成。

最终cutover另须落实：所有旧API创建购买/上游支付前拒绝active epoch，所有实际财务事务（定时发放、AI准入/消费、durable usage replay、legacy到账）持同事务shared epoch锁，清理持exclusive锁；先冻结销售、排空旧进程/任务、关闭旧未付订单并取消app-owned旧Stripe自动续费。外层mode读取不是实际事务屏障；避免跨连接嵌套shared锁与排队exclusive造成互锁。Stripe worker不能伪造“验签通过”的事件审计，应复用权威同步函数而非捏造回调。下面的 c517/344 与未接线描述为历史检查点。

唯一 worktree /Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui；共享 checkout 不切分支、不新建第二个worktree。当前 worker/cn-us-personal-payments，已推送检查点 c517aabf6（父1d2411a2fa769756efd28175c59fb6aee8441dea）。本项 #6093 尚未完成，不创建未完成PR，不标passing。

前置契约PR #6094 当前head b296e1385e03c8f215f573756727261f9c967126，等待新CI。此前 fa09 已source READY并正常入队，候选40f63ce5因Turbo自测默认1MiB stdout溢出退队；b296仅补有界8MiB和assert.ifError，21项自测红→绿、独立exact SHA ACCEPT、推送前20/20通过。父协调会话明确要求最小修复后正常重入队。旧候选剩余backend run41329227728已提交取消（确认新head且queue空），不要取消其他会话的run。用户已授权本次定价任务逐PR检查/独立审查通过后正常集成develop，无admin bypass，无生产权限。

c517证据：provider15文件129项、API type/lint、PG意图7项、真实回环HTTP2项通过；HTTP PrincipalResolver与支付商为fixture，不能说生产登录或在线扣款已验证。新控制器仍未注册BillingModule。

当前增量：billing_personal_payment_receipts迁移、人工复核标记、原子到账Repository、微信新代际查单与回调Store。已补渠道引用前缀防混用；支付事务10项、签名回调HTTP/PG5项最终15/15通过，意图7项和HTTP2项另已通过；provider131/API类型/lint通过。正式BillingModule仍未接线，Stripe Pro绑定/自动续费仍待实现。
财务事务：epoch共享锁 → provider paymentRef锁 → subscription锁（Pro）→ user锁 → purchase行 → 钱包。recordPaidPersonalTerm会取subscription再user锁，调用前必须相同顺序，避免反向锁。核心settle目前支持微信Pro和中美充值，明确拒绝Stripe Pro（personal_stripe_binding_required），后者仍需完整绑定与invoice流程。到账资金、付款快照、账本、fulfillment同一事务；额度容量与已付期限重叠用savepoint回滚授予后保留receipt人工复核，重试不能在余额变化后自动恢复发放。paidAt可null用于无法确定实际付款时刻的Stripe充值，不猜时间；微信Pro必须有权威paidAt并以此锚定月/年期限。

后续顺序：先修guard并验证当前支付事务；再实现微信真实验签/AES解密→带代际标记权威查单→到账的回环HTTP/PG证据；随后Stripe持久化绑定、paid invoice与续费、正式DI接线及过期/超时恢复。Stripe绑定必须核实原始Checkout、客户、订阅、价格、SKU、金额、币种、generation；invoice先到也不能凭事件metadata选用户。续费保留原始billing anchor与月偏移；subscription active事件本身不发额度。保存真实确认的status/cancel_at_period_end，不给权益读模型猜自动续费事实。新entitlement HTTP必须组合实际付款期限、月度credit、welcome批次。

旧事件屏障：激活后未知/旧generation通知不得回落旧入账路径。最终cutover还需给旧财务事务加epoch屏障，先停止销售、关闭旧可支付订单/Checkout、取消app-owned旧Stripe续扣、排空旧应用，再全清旧订单/订阅/余额/流水并激活；本项尚未执行生产操作。Wechat time_expire不足下单后1分钟会被上游延长，创建前留余量；本地过期和关单失败不证明上游已关闭，付款与关单竞态必须重读。

所有新PR仅develop。契约合入后依序剥离前置：目录旧父499c22a20、充值旧父41cf12014、年付旧父d5c6539c6、Free旧父a1d5cbf93；最后本项剥离旧父1d241。每个PR只含对应issue。原契约subject里的括号issue号已在新契约分支改为Refs，避免merge queue误当PR号。每次开发先fetch main/develop，强推只用自有分支精确force-with-lease。

保留备份stash 61a9667d79b2d7fed0ec3ced0e8ba17064b9cd59 已应用且后续c517保存；旧ba557b9372293e2755363dba3bc29cb2596a9917也已全部提交。共享stash有别人的条目，不碰。当前没有自有浏览器/Next server；隔离数据库测试wrapper负责栈清理，结束后确认结果与cleanup。不要动发布会话的Chrome/服务器。

契约6094 b296再次正常入队，当前候选a2d305d11cac86df01737461b5b241bbac3c430e，队列位置2。候选可能含队列前序PR，不取消其工作流；用check-runs per_page=100完整核对，并以实际mergedAt/mergeCommit判断合入。

独立review7ac972e45发现products新text-foreground无效，已改合法text-background-foreground；权威颜色扫描器针对新组件零问题。当前P5旧父全仓另有prototype两条旧问题，不豁免/不称全仓绿；切到已合UI的P2基线时全仓颜色门已绿，后续顺序rebase应带入正确版本，再全门复验。待签材料补齐同一payer/SKU/provider/catalogVersion、销售关闭后原key恢复、所有恢复先GET状态、三类终态零新增支付请求约束；仍pending未实现nullable。

未提交UI运行时WIP：PersonalPricingCheckout真实POST前持久化、模糊错误只用户动作同key重试、GET本人状态后才QR/成功、截止后不假关单；生产/billing路由新增默认关闭的服务端UI开关，未设置任何部署开关。React总89与Web type/lint4通过，但本轮新API浏览器fixture尚未API type/lint。首轮真实browser1失败/后续bail未跑：旧P5父缺已合入Contract PR的Next代理，catalog/entitlement实际404导致quota不可见。不是账务断言通过；保留失败日志，不放宽断言。先stash这份WIP、刷新P3→P4→P5到P2当前已审48e04b39c，再重跑。新owned browser helper已补启动早期handle回传，失败也能关闭独占进程；此修正也尚待重跑。待签nullable仍pending/未改契约，旧ecb P2保持open。
