# 拟议 API 及验证边界

本文件描述待签核接口，**不是现有路由清单**。核心严格输入／Team期限已开始物化于 `packages/contracts/src/billing-team.ts`，其余响应、目录及operation尚未完成；本文不另写 Zod／DTO。钱数为服务端整数最小货币单位，credit 复用既有两位精度；所有 mutation 严格拒绝多余字段。

## 复用的接口与权限

- 扩展既有 `GET /billing/catalog` 的服务端目录，以区分个人商品、组织基础订阅及组织增员。市场来自部署，不接受浏览器地区来选择生产渠道；金额、币种、基础容量、月度额度、增购数量边界和目录版本均为目录事实。
- 组织钱包／流水复用现有接口与 `BillingWalletService` 的组织管理员／平台运营访问判据。保留 `BillingOwnerType="team"`，其 `ownerId` 为真实 organization ID，不是 `teams.id`；不引入 `org` 第三种钱包 ownerType。
- 身份由既有 PrincipalGuard 提供。组织购买、管理和恢复须实际目标组织 admin；平台运营可按既有权限读取组织财务，但不因此获得新的代客购买能力。平台升级／加额度只走既有 PlatformOperatorGuard。个人 Pro 不因用户属于某组织而变成组织账单。
- 敏感 GET 和 mutation 响应为 private/no-store；未登录 401、无管理权 403，跨组织购买引用不泄露存在性。平台入口排除 personal-local 和平台容器。

## 新组织计费接口

以下 path 的 `:orgId` 是唯一组织输入，body 不再接受 owner 或 userId。

| 方法／路径 | 输入 | 成功结果 |
|---|---|---|
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
