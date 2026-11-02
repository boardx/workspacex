# 拟议 API 及验证边界

本文件描述待签核接口，不是现有路由清单。严格输入、期限、目录、报价、组织权益/月授予和已付订阅历史已物化于 `packages/contracts/src/billing-team.ts`；完整支付恢复/平台摘要/操作结果及operations仍待补齐。金额为服务端整数最小货币单位，credit复用两位精度，所有mutation拒绝多余字段，不在本文另写DTO。

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

`purpose`与严格body的首批定义在`billing-team.ts`，许可初购/续购提交总席位、增员提交正增量、充值不提交席位；最终共享付款结果及operation仍待物化。付款绑定／终态恢复衔接[已单独人工确认的个人恢复修订](https://github.com/boardx/workspacex/blob/52e2f95bc447cc4471ccaabedb824ec56b6298ed/phases/phase-21-billing-payment/design-deltas/personal-order-outcomes-v1/design-signoff.md)，该实现仍待顺序集成；本束不扩展已有个人接口的授权范围。待支付必须有真实绑定；无绑定终态不能伪造 URL／期限，也不能被当作新购买。

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
| POST `/platform/organizations/:orgId/billing/enterprise-upgrades` | 原 expectedPlanVersion、idempotencyKey | operationRef、真实操作状态及实际生效后组织摘要；处理中不声称已升级；服务端记录固定“平台管理员手动升级”操作原因 |
| GET `/platform/organizations/:orgId/billing/operations/:operationRef` | 路径 | 该组织原操作的当前状态及可恢复动作，不泄露商户凭据 |
| POST `/platform/organizations/:orgId/billing/credit-grants` | 1至1,000,000整数credit、idempotencyKey、非空 reason；服务器校验当前Enterprise | 原 grantRef、实际 ledgerRef／审计引用、余额和创建时刻；重放返回原收据 |

操作者只取 principal，body 拒绝 actorId、generation、套餐生效时间、钱包余额、合同和自动发放计划。平台手动额度的范围和整数上限与已采用原型一致，提取为契约单源；零、负数、小数、超限、溢出或非当前Enterprise不落账。增员折算及钱包仍保留既有0.01精度，不与手动表单混为一谈。幂等键按原组织／generation 唯一，绑定原操作者及参数；不同参数／操作者冲突，不能再次记账。

Enterprise 升级依 `domain.md` 的可恢复流程先处理原 Team 支付及未来 Stripe 扣款，再原子写既有 Plan／当前代际／审计。已付Team未来窗口的处置单列待确认；未得到答案前不得把取消未来续费实现成停止已付额度，升级影响摘要／收据／worker和反例必须随决定统一。并发版本冲突保留原操作，客户端刷新后处理，不盲重放新 key。手工额度仅对当前Enterprise开放，不改变套餐或虚构有效期；Team通过购买额外额度充值，但到期仍挡新AI，直到订阅续购或Enterprise真正生效。

## 错误与交易测试

复用既有身份错误、billing 支付／账务错误及全局异常映射。拟新增的业务原因包括：组织容量不足、报价到期／版本变化、已有未解决商业变更、已付期限过期、付款事实待核对和不支持的套餐转换；签核实现时进入唯一闭集和 HTTP 映射，而非散落字符串。对外区分可刷新重报、保持原操作恢复和联系平台核对。

测试须走真实 PrincipalGuard／目标组织 membership、平台 guard、HTTP 严格输入、真实 PG 事务和独立签名上游 fixture；mock 个人 session 或平台名单不能被称为生产权限证明。具体用例对应 `coverage.md`。

### 可执行报价材料增量

`billing-team.ts` 的 `TeamQuote` 已将 initial / renewal / add_seats / credit_topup 四种响应分别封闭。所有结果绑定组织、代际、目录/商品、渠道、整数金额及正向不超过五分钟的有效期；许可购买包含真实待购容量和月额度，年付不扩大为全年一次额度。增员另保存原已付期限、正增量、增员后月额度及独立的当前月度额度窗口，报价不得超过原到期日；第一期明确是预计值，允许最后极短窗口向下折算为0。永久充值结果不接受席位、期限或许可版本，Stripe充值也是一次性购买。该schema不执行支付、折算入账或权限判断。

原型增员弹窗消费 `previewSeatQuote` 的严格模拟结果取得金额与共同到期日；数据位于原有UI-only fixture模块，明确不是生产报价计算入口。模拟付款仍无HTTP。实际runtime必须读取服务端报价，到账后按权威付款时刻重新计算首期额度。其他响应和完整operation闭集仍待完成，不将本增量标为第③件全部完成。

### 可执行组织权益材料增量

`TeamEntitlement` 明确 licenseStatus 为 none/active/expired/enterprise，并绑定读取时刻、组织、当前代际和既有 Plan 版本。实际人数与 teamPayment.term.purchasedSeats 分开；许可状态不代替 membership、AI模型策略或额度准入。Enterprise不受已记录旧Team期限的许可约束，旧付款和已发额度仍可作为事实返回，不承诺尚未决定的未来发放政策；没有旧付款时保持null，不虚构5席或期限。

包含的 TeamMonthlyCreditGrant 只描述当前或最近一次实际月度授予，none/pending不构造grant；已发的额度窗口不得越过已付期，余额不能大于实际发放，过期剩余为0。钱包直接复用共享CreditWallet，要求真实永久余额、订阅余额和到期事实；wallet必须是该组织的team owner，余额分量与当前授予一致，保留已确认消费产生的负余额。依赖失败返回不可用，不将未知值填0。相同到期时刻允许不同合法ISO时区表示。

本增量让已采用Team原型消费严格模拟权益取得实际人数、已购容量、充值余额和月度剩余；不连真实API。完整目录、历史、支付恢复、平台摘要及operations仍待物化，Enterprise未决已付窗口不由此schema裁决。

付款事实补充：teamPayment 复用现有 SubscriptionStatus 闭集；微信 subscriptionStatus 必须为null、manual且无到期取消标志，Stripe须有真实非none状态且为automatic。Enterprise停止未来扣款既可由真实cancelAtPeriodEnd安排证明，也可由canceled/incomplete_expired终止状态证明；不要求将已取消订阅的真实false标志改为true，不丢弃旧term。未知状态或仍会续费的Stripe不得据此宣称Enterprise生效。

### 可执行组织目录材料增量

TeamCatalog 对应新 GET `/billing/organizations/:orgId/catalog`，响应为组织、目录版本、市场、启用渠道和严格商品数组。Team subscription 提供付款周期、基础5席/100,000月credit、增员单价及每席15,000月credit；永久充值产品直接复用个人PricingProduct的同一schema。微信不进入USD目录，禁售时启用渠道为空；Enterprise不产生自助商品种类。组织管理员guard/服务端目录及禁售判断尚待实现，schema不构成权限证明。

PricingCatalogBase 和 validatePricingCatalog 是个人/组织共用的结构及市场币种/唯一性约束单源。既有个人PricingCatalog的输入/输出和20,000个人月额度保持原形状，由同一组现有反例继续验证；不把Team商品混进已签个人数组。原型Team价格、增员单价及quote的org/version/SKU/currency从严格模拟组织目录读取，仍只投影原有UI-only价目fixture，生产价格依旧只能来自服务端。

直接以美国市场打开增员，以及组件在打开状态切换地区的反例已补。受限市场同步选择其支持渠道，devapp仍允许用户在已启用的微信/Stripe间选择；不能用前一市场的微信状态构造USD报价。现有真实browser增加US Team增员链路，仍断言零计费HTTP。

### 可执行已付订阅历史材料增量

TeamHistoryQuery 只接收不超过2048字符的opaque cursor及limit（默认10、最多50），不得通过query指定其他组织、代际、用户或金额。cursor的签名与实际org/generation绑定由后续server实现验证，Zod长度检查不是权限或签名证明。

TeamSubscriptionHistory 返回读取时刻、实际org/generation、已确认许可付款记录和nextCursor。每项保留真实purchaseRef/receiptRef、付款时SKU/渠道/币种/整数金额、paidAt及当次paidTerm；增员另带正增量，不能与已购总容量混淆。新增系统不把未知历史金额填0、不导入旧脏订单；年付一笔付款一项，月度额度发放不重复生成付款历史。永久充值沿用钱包/订单历史，不混入本许可历史。重复purchaseRef或receiptRef被拒绝。

原型Team订阅历史消费严格模拟已付记录，按记录期限与读取时刻显示已到期/尚未生效/本期有效，替换原占位历史行。个人原型历史不变。mock仍只是材料，不证明真实付款、cursor隔离或数据库行数；对应实际API/PG证据须待runtime阶段。
