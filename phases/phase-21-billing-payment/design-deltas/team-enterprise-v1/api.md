# 拟议 API 及验证边界

本文件描述待签核接口，不是现有路由清单。严格输入、期限、目录、报价、组织权益/月授予和已付订阅历史已物化于 `packages/contracts/src/billing-team.ts`；平台摘要/操作结果/错误及operations已物化，真实路由仍待实现。金额为服务端整数最小货币单位，credit复用两位精度，所有mutation拒绝多余字段，不在本文另写DTO。

## 复用的接口与权限

- 组织商品目录使用新 GET `/billing/organizations/:orgId/catalog`，由真实目标组织管理员读取，并绑定该组织。个人 `GET /billing/catalog` 保持已确认的严格个人响应。两者复用相同服务端目录版本、部署市场和永久充值SKU/价格事实；组织结果提供基础Team订阅及对应增员单价/月额度，未完成容量及小数账务前置时服务端保持销售关闭。市场不由浏览器任选生产渠道。
- 组织钱包／流水复用现有接口与 `BillingWalletService` 的组织管理员／平台运营访问判据。保留 `BillingOwnerType="team"`，其 `ownerId` 为真实 organization ID，不是 `teams.id`；不引入 `org` 第三种钱包 ownerType。
- 身份由既有 PrincipalGuard 提供。组织购买、管理和恢复须实际目标组织 admin；平台运营可按既有权限读取组织财务，但不因此获得新的代客购买能力。平台升级／加额度只走既有 PlatformOperatorGuard。个人 Pro 不因用户属于某组织而变成组织账单。
- 敏感 GET 和 mutation 响应为 private/no-store；未登录 401、无管理权 403，跨组织购买引用不泄露存在性。平台入口排除 personal-local 和平台容器。

## 新组织计费接口

以下 path 的 `:orgId` 是唯一组织输入，body 不再接受 owner 或 userId。

| 方法／路径 | 输入 | 成功结果 |
|---|---|---|
| GET `/billing/organizations/:orgId/catalog` | 路径 orgId | TeamCatalog：实际组织、目录版本、部署市场、可用渠道及基础/增员价格与月度额度；充值商品与个人同源 |
| GET `/billing/organizations/:orgId/entitlement` | 路径 orgId | 当前代际、真实套餐及商业版本、付款期限、额度窗口、已用／已购席位、实际额度余额、渠道／续费状态及可操作项 |
| POST `/billing/organizations/:orgId/quotes` | `purpose`（开通／到期续购／增员／永久充值）、`sku`、`provider`、目录版本；许可变更另含预期商业版本及相应席数 | 不可变 quoteRef、适用时的期限／月窗、报价／到期时刻、币种／本次金额；许可变更返回购买后容量／月额度／下期数量，充值返回本次永久credit且不产生新期限 |
| POST `/billing/organizations/:orgId/checkout` | `quoteRef`、原 `idempotencyKey` | 原 purchaseRef、权威购买结果、存在时的真实付款绑定；同 key 恢复不再创建支付 |
| GET `/billing/organizations/:orgId/purchases/:purchaseRef` | 路径 | 本组织不可变购买快照、真实结果、存在时的付款地址／期限、实际付款事实及异常处理状态 |
| GET `/billing/organizations/:orgId/history` | 绑定组织及代际的 cursor、limit | 实际已付期限／增员订单历史，一笔真实付款一条，不把逐月 quota 伪装为十二笔付款 |
| POST `/billing/organizations/:orgId/subscription/manage` | 空严格对象 | 本组织已验证 Stripe customer 的可信门户 URL；无 Stripe 绑定明确不可用 |

`purpose`与严格body的首批定义在`billing-team.ts`，许可初购/续购提交总席位、增员提交正增量、充值不提交席位；付款结果与升级operation已物化，操作提案见operations.proposal.ts。付款绑定／终态恢复衔接[已单独人工确认的个人恢复修订](https://github.com/boardx/workspacex/blob/52e2f95bc447cc4471ccaabedb824ec56b6298ed/phases/phase-21-billing-payment/design-deltas/personal-order-outcomes-v1/design-signoff.md)，该个人实现已随PR6103正常合入develop；本束不扩展已有个人接口的授权范围。待支付必须有真实绑定；无绑定终态不能伪造 URL／期限，也不能被当作新购买。

权益按实际状态区分未开通、Team和Enterprise：Team返回真实固定容量／已付期限，Enterprise明确人工管理、无Team容量上限／默认到期日／自动月度额度，未开通不伪装成已购基础容量。已发余额与历史来源保留，缺失事实不可当成0。Enterprise不开放新的组织自助购买／增员，但此前合法创建的购买仍可读取／恢复／到账。

### 报价和结算约束

1. 客户端不得提交 money、credit、付款成功标志、商业套餐或原购买日。quote 由服务器锁定目标组织、目录／代际、商品和数量，许可变更另绑定原商业版本。首次开通、到期续购及永久充值的报价有效至创建后5分钟；**仅增员**还受原有效付费期限限制，取两者较早值。到期续购不能因旧期限已过而立即失效。报价过期只能重新确认，不能自动支付新报价。
2. 初次开通的基础容量不足当前组织人数时，返回明确所需容量而不创建支付；用户先确认额外席数和总价。checkout再在组织容量锁内复核人数并提交待购容量约束，所有成员入口遵循该约束直到真实成功或权威关闭。到期续购不得少于原已购容量；成员减少不降低应续数量。月年周期切换仅在新的微信到期购买中选择；不暗中修改在用 Stripe 的周期。
3. 微信快照保存整数补价及原付费期分子／分母。Stripe 报价保存权威 preview 的对应增员明细、固定折算时刻及原 customer/subscription/item/price 绑定；实际更新复用该时刻。不能把整张含未知调整的发票总额当成本项补价。支付商不支持即付／该更新方式时明确不可用，不临时放大金额或换渠道下单。
4. POST 前先持久化原意图和幂等身份；上游调用不持数据库事务。相同 key 的 quoteRef／org／渠道改变返回冲突；全局或组织禁购仍允许读取和恢复本版本原操作。另一管理员不得通过新 key 绕过组织正在处理的许可变更；独立永久充值不修改许可版本或容量。所有provider付款引用只能归到一个真实付款账户，不得在个人／组织两套结算中重复授予。
5. checkout 响应本身不授予容量。必须验签并权威重读付款、组织绑定、SKU／价格／数量、金额／币种、原期限及实际付款时刻；Stripe 要同时核实增员 invoice 和成功生效的订阅数量。失败或 pending update 过期不先加席位；并发回调／补账重复只留下一个 receipt／授予。
6. 首期 credit 由实际付款时刻重算、可能少于报价中的预计值。回调迟到到月窗外时不恢复过期额；购买跨期、版本变更或升级竞态保留真实收据及人工核对，不覆盖 Enterprise、不丢支付记录、不新建第二笔款。
7. 浏览器恢复按认证用户／组织 scope 隔离、先 GET 权威结果再展示付款入口。恢复既有已到账地址也不能再次跳付款；未知／人工核对不展示成功。Stripe 门户限取消下一期和付款方式，不开放未实现的改套餐／减席／切周期。

## 平台 Team 列表及管理员操作

既有 GET `/platform/organizations`／详情新增来自相同套餐记录和钱包的 `billingSummary`：真实计费层级、套餐版本／代际、订阅状态、席位及可用余额；未开通／过期不能假装 active Team。计划的 Enterprise 标记仍来自原 Plan；显示项不再另持一份 `isEnterprise`。

| 方法／路径 | 输入 | 成功结果 |
|---|---|---|
| POST `/platform/organizations/:orgId/billing/enterprise-upgrades` | 原 expectedPlanVersion、idempotencyKey | operationRef、真实操作状态及实际生效收据；成功后刷新既有组织摘要；处理中不声称已升级；服务端记录固定“平台管理员手动升级”操作原因 |
| GET `/platform/organizations/:orgId/billing/operations/:operationRef` | 路径 | 该组织原操作的当前状态及可恢复动作，不泄露商户凭据 |
| POST `/platform/organizations/:orgId/billing/credit-grants` | 1至1,000,000整数credit、idempotencyKey、非空 reason；服务器校验当前Enterprise | 原 grantRef、实际 ledgerRef／审计引用、余额和创建时刻；重放返回原收据 |

操作者只取 principal，body 拒绝 actorId、generation、套餐生效时间、钱包余额、合同和自动发放计划。平台手动额度的范围和整数上限与已采用原型一致，提取为契约单源；零、负数、小数、超限、溢出或非当前Enterprise不落账。增员折算及钱包仍保留既有0.01精度，不与手动表单混为一谈。幂等键按原组织／generation 唯一，绑定原操作者及参数；不同参数／操作者冲突，不能再次记账。

Enterprise 升级依 `domain.md` 的可恢复流程先处理原 Team 支付及未来 Stripe 扣款，再原子写既有 Plan／当前代际／审计。用户已确认已付Team基础/增员窗口按原购买日继续发到原paidPeriodEnd，同时停止未来续费；Enterprise额外额度仍手动添加，不新增默认月额度。升级影响摘要、收据与worker均须保留原已付期限，不改锚点、预发、退款或折抵。并发版本冲突保留原操作，客户端刷新后处理，不盲重放新 key。手工额度仅对当前Enterprise开放，不改变套餐或虚构有效期；Team通过购买额外额度充值，但充值不恢复到期Team钱包准入；订阅续购或Enterprise真正生效前的个人回退依[统一 credit 付款方规则](../../../../docs/superpowers/specs/2026-10-22-unified-credit-consumption-design.md#payer-resolution)，不改写TeamEntitlement或付款历史。

## 错误与交易测试

复用既有身份错误、billing 支付／账务错误及全局异常映射。TeamBillingErrorCode已封闭组织容量不足、报价到期／版本变化、已有未解决商业变更、已付期限过期、付款事实待核对和不支持的套餐转换等原因；HTTP控制器映射仍待签核后实现。对外区分可刷新重报、保持原操作恢复和联系平台核对。

测试须走真实 PrincipalGuard／目标组织 membership、平台 guard、HTTP 严格输入、真实 PG 事务和独立签名上游 fixture；mock 个人 session 或平台名单不能被称为生产权限证明。具体用例对应 `coverage.md`。

### 可执行报价材料增量

`billing-team.ts` 的 `TeamQuote` 已将 initial / renewal / add_seats / credit_topup 四种响应分别封闭。所有结果绑定组织、代际、目录/商品、渠道、整数金额及正向不超过五分钟的有效期；许可购买包含真实待购容量和月额度，年付不扩大为全年一次额度。增员另保存原已付期限、正增量、增员后月额度及独立的当前月度额度窗口，报价不得超过原到期日；第一期明确是预计值，允许最后极短窗口向下折算为0。永久充值结果不接受席位、期限或许可版本，Stripe充值也是一次性购买。该schema不执行支付、折算入账或权限判断。

原型增员弹窗消费 `previewSeatQuote` 的严格模拟结果取得金额与共同到期日；数据位于原有UI-only fixture模块，明确不是生产报价计算入口。模拟付款仍无HTTP。实际runtime必须读取服务端报价，到账后按权威付款时刻重新计算首期额度。其他响应和完整operation闭集现已补齐，见文末；正式一致性复核及本束人类签核仍未完成。

### 可执行组织权益材料增量

`TeamEntitlement` 明确 licenseStatus 为 none/active/expired/enterprise，并绑定读取时刻、组织、当前代际和既有 Plan 版本。实际人数与 teamPayment.term.purchasedSeats 分开；许可状态不代替 membership、AI模型策略或额度准入。Enterprise不受已记录旧Team期限的许可约束，旧付款和已发额度仍可作为事实返回，其已付计划继续按原锚点发放到原到期日，不新增Enterprise默认发放；没有旧付款时保持null，不虚构5席或期限。

包含的 TeamMonthlyCreditGrant 只描述当前或最近一次实际月度授予，none/pending不构造grant；已发的额度窗口不得越过已付期，余额不能大于实际发放，过期剩余为0。钱包直接复用共享CreditWallet，要求真实永久余额、订阅余额和到期事实；wallet必须是该组织的team owner，余额分量与当前授予一致，保留已确认消费产生的负余额。依赖失败返回不可用，不将未知值填0。相同到期时刻允许不同合法ISO时区表示。

本增量让已采用Team原型消费严格模拟权益取得实际人数、已购容量、充值余额和月度剩余；不连真实API。完整目录、历史、支付恢复、平台摘要及操作提案现已物化，已付窗口按本束domain中的人类确认口径执行。

付款事实补充：teamPayment 复用现有 SubscriptionStatus 闭集；微信 subscriptionStatus 必须为null、manual且无到期取消标志，Stripe须有真实非none状态且为automatic。Enterprise停止未来扣款既可由真实cancelAtPeriodEnd安排证明，也可由canceled/incomplete_expired终止状态证明；不要求将已取消订阅的真实false标志改为true，不丢弃旧term。未知状态或仍会续费的Stripe不得据此宣称Enterprise生效。

### 可执行组织目录材料增量

TeamCatalog 对应新 GET `/billing/organizations/:orgId/catalog`，响应为组织、目录版本、市场、启用渠道和严格商品数组。Team subscription 提供付款周期、基础5席/100,000月credit、增员单价及每席15,000月credit；永久充值产品直接复用个人PricingProduct的同一schema。微信不进入USD目录，禁售时启用渠道为空；Enterprise不产生自助商品种类。组织管理员guard/服务端目录及禁售判断尚待实现，schema不构成权限证明。

PricingCatalogBase 和 validatePricingCatalog 是个人/组织共用的结构及市场币种/唯一性约束单源。既有个人PricingCatalog的输入/输出和20,000个人月额度保持原形状，由同一组现有反例继续验证；不把Team商品混进已签个人数组。原型Team价格、增员单价及quote的org/version/SKU/currency从严格模拟组织目录读取，仍只投影原有UI-only价目fixture，生产价格依旧只能来自服务端。

直接以美国市场打开增员，以及组件在打开状态切换地区的反例已补。受限市场同步选择其支持渠道，devapp仍允许用户在已启用的微信/Stripe间选择；不能用前一市场的微信状态构造USD报价。现有真实browser增加US Team增员链路，仍断言零计费HTTP。

### 可执行已付订阅历史材料增量

TeamHistoryQuery 只接收不超过2048字符的opaque cursor及limit（默认10、最多50），不得通过query指定其他组织、代际、用户或金额。cursor的签名与实际org/generation绑定由后续server实现验证，Zod长度检查不是权限或签名证明。

TeamSubscriptionHistory 返回读取时刻、实际org/generation、已确认许可付款记录和nextCursor。每项保留真实purchaseRef/receiptRef、付款时SKU/渠道/币种/整数金额、paidAt及当次paidTerm；增员另带正增量，不能与已购总容量混淆。新增系统不把未知历史金额填0、不导入旧脏订单；年付一笔付款一项，月度额度发放不重复生成付款历史。永久充值沿用钱包/订单历史，不混入本许可历史。重复purchaseRef或receiptRef被拒绝。

原型Team订阅历史消费严格模拟已付记录，按记录期限与读取时刻显示已到期/尚未生效/本期有效，替换原占位历史行。个人原型历史不变。mock仍只是材料，不证明真实付款、cursor隔离或数据库行数；对应实际API/PG证据须待runtime阶段。

已付历史逐项校验paidAt不晚于asOf，以时间戳而非ISO字符串比较。已真实付款但许可在未来生效的记录仍允许，由UI显示尚未生效；未来付款不能冒充已付。真实server应保证读取截止时间/记录快照一致，不能用schema失败后补0或改日期掩盖不一致。

### 可执行付款及恢复材料增量

TeamPurchaseOutcome 是本组织原purchase的只读视图：不可变quote、真实状态/读取时刻、已知的完整paymentPage、paidAt及实际fulfillment。PENDING/PROCESSING必须保留真实URL与期限，不伪造值；绑定尚未建立则接口返回依赖不可用，重试原key。SUCCESS允许原paymentPage为null，但必须有实际付款与收据。FAILED用于需核对的结果，可以保留已知cash但不声称许可已生效；CLOSED不能包含已到账事实。回跳、客户端状态和结构校验都不构成到账证明。

fulfillment保留receipt/audit、首期实际授予、真实ledger及当次paidTerm。首期0不伪造零额流水；永久充值不附许可期或月窗。订阅付款与月额度分开，增员只增加原期限内正数量，不延长/移动锚点。quote估计可以与实际首期不同，实际过期付款需核对，付款未过期但回调迟到可保留原已付事实与0个已过期首期credit。后续完整月授予仍由原计划单独处理。

共享 `billing-credit-calendar.ts` 复用原个人UTC算法，API旧路径只转发同一函数/类型。Team已付期、报价月窗、额度月窗和增员首期使用同一原购买锚点；首期窗口取实际paidAt所属月，不能用晚处理所在月补发过期首期，月末/闰日夹取后恢复原日。原型增员模拟确认实际parse该结果，仍不做真实请求或持久化。

paymentPage的schema只校验结构与URL语法。后续真实cashier须复用P5的`payment-url.ts`可信域边界，并先GET当前身份/组织拥有的结果再显示付款或成功；不复制host白名单，不以create响应/本地receipt替代权威恢复。当前仍是设计材料，不证明真实组织guard、商户或账务已完成。

## 平台目录与可恢复操作（本次补齐）

可执行操作提案闭集为本目录 `operations.proposal.ts`（签核后随实际路由逐项迁入 billingTeam.operations；当前不宣告已存在的运行时操作），组织目录继续使用 `platformOrganizations.operations.listOrganizations/getOrganization`，不增加第二套列表。其 `OrganizationRow.billingSummary` 复用严格 TeamEntitlement，组织、成员数、原 Plan 版本及当前代际须一致。旧 pending 目录无摘要仍可读取；旧 Enterprise 元数据不能恢复当前付费权限。Plan/PlanState/PlanWrite 唯一来源提取为 organization-plan，平台模块保留原导出；现有后台仍返回 pending，此设计不声称真实 enforcement 已开启。

Enterprise 升级响应为 EnterpriseUpgradeOperation：processing 保留原 operationRef、receipt=null，使用 retry_original；needs_review 保留原操作及 code，要求 contact_platform；succeeded 必须含真实 auditRef、actor、原子 Plan 写入时间与 expectedPlanVersion+1、相同 generation，以及固定 continue_until_paid_end 政策和保留的 Team 付款。仍将自动续费的 Stripe 状态不能成为成功凭据；已取消且 cancelAtPeriodEnd=false 的真实状态有效。没有旧 Team 付款时 retainedTeamPayment=null，不凭空创建订阅。操作恢复 GET 使用原组织与 operationRef，不创建第二个升级。

升级成功收据用于随后刷新既有组织目录，响应不再重复一份完整 billingSummary；前端不得在 processing/needs_review 状态先改目录的 Enterprise 标志。原型平台列表消费同一 OrganizationRow，模拟升级消费请求与成功操作收据后投影，当前余额和旧授予批次保持原样；手动额度仍消费实际 grant/ledger/audit 收据后更新模拟钱包。模拟过程没有 HTTP 或财务写入。

错误体沿用既有 `{error,traceId,code}`，不引入 reasonCode 方言。TeamBillingErrorCode 是封闭枚举，覆盖已有支付错误、组织 Plan 版本错误和本束容量、报价到期、已付期限到期、待处理商业变化、付款核对、升级冲突、依赖失败、Enterprise 专属、额度精度溢出、未订阅等错误。通用未登录及未知5xx仍遵循现有全局 envelope，不被伪装成已判定的业务拒绝。未来控制器必须验证 HTTP status/envelope 与 guards，当前仅有契约及反例，未声明真实后端已完成。

原型一致性补齐：七人组织初购消费initial严格quote，明确7席、130,000月额度及包含两额外席位的总价。平台升级processing保留Team及原operationRef，可查询原操作；needs_review保留原套餐并展示联系平台和原编号，无成功前加额度入口。Enterprise组织账户区分无旧计划与保留已付计划，前者无虚构期限/默认月额度，后者显示原截止及每月计划，均无新增自助充值/收费席位按钮。以上仍为受控模拟，真实响应刷新/恢复/guard待实施。
