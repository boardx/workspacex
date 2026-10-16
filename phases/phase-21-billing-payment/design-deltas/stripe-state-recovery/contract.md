# Stripe 状态与付款恢复契约补充提案

状态：Proposed；Refs #5806；决策记录见 [ADR-123](../../../../docs/adr/ADR-123-stripe-subscription-state-and-recovery-eligibility.md)。本提案尚未改变已确认契约、签核状态、运行时或数据库。

## 用户目标与已确认约束

沿用参考仓库的 Stripe 托管订阅付款和 Billing Portal 管理流程。用户需要知道是否有有效权益、如何处理未完成付款、什么时候可以再次购买。依据既有需求 R3/R4-E6，只有 active/trialing 展示有效 Pro；已有待处理订阅时不能再售卖第二份。2026-10-01 人类裁决要求 Stripe 状态原样落库。充值额度与订阅独立，Stripe 不赠送充值额度。

现有 `SubscriptionStatus` 遗漏 Stripe 的 paused/incomplete_expired，且 domain I-5 的“已订阅”同时指权益与管理资格。提议明确为以下单义规则。

## 状态与入口（提议的语义权威）

| webhook 状态 | 用户看到的状态 | 有效 Pro | 可创建新订阅 | 可管理已有订阅 |
|---|---|---|---|---|
| none | 尚未订阅 | 否 | 是 | 否 |
| active | 订阅生效；若到期取消，说明截止时间 | 是 | 否 | 是 |
| trialing | 试用中；显示试用结束时间 | 是 | 否 | 是 |
| past_due | 付款异常，请更新付款方式 | 否 | 否 | 是 |
| unpaid | 付款未完成，请处理账单 | 否 | 否 | 是 |
| incomplete | 首次付款未完成，请处理已有订阅 | 否 | 否 | 是 |
| paused | 订阅已暂停，请管理订阅 | 否 | 否 | 是 |
| canceled | 订阅已结束；可重新订阅 | 否 | 是 | 否 |
| incomplete_expired | 首次付款已过期；可重新订阅 | 否 | 是 | 否 |

“可管理”还要求该用户有经验证绑定的 Stripe customer；缺少绑定属于服务数据异常，不能接受浏览器指定 customer 或返回他人门户。到期取消中的 active/trialing 在 Stripe 真正变为终态前仍按现态处理，不能提前展示已失效。

升级接口在不可新建状态返回既有 `already_subscribed`，UI 引导“处理账单/管理订阅”，不暗示付款异常仍有有效 Pro。管理接口在不可管理状态返回既有 `not_subscribed`。未配置时仍使用 `payment_provider_not_configured`。共享领域策略同时被接口和 UI 消费，避免分别维护不同名单。

## 最小 API / 持久化变化

1. 采纳后在契约单源 `packages/contracts/src/billing-subscription.ts` 的 SubscriptionStatus 增补 paused、incomplete_expired；保持原状态的 Stripe 含义，禁止映射成 none/canceled 或保留旧 active 后将事件记成功。其余未知未来状态不得假装解析成功，留内部失败审计并保持已有快照。
2. 4 个 operation 的方法、路径、请求和响应字段不变；不新增错误码。状态 none 只表示没有已存订阅，不能表示付款成功、查询失败或同步超时。
3. 将 domain I-5 / usecases 的资格描述改为引用本表；更新覆盖证明和 UI 状态/文案验收材料。数据库状态约束与公开 schema 同步；只由签名验证后的 webhook 路径更新订阅快照。
4. 保持用户本人隔离、未配置不阻塞启动、回跳只读、已知状态查询失败不冒充免费、Stripe 与额度流水隔离。pending 回跳显示同步中并避免 UI 再次购买，不能靠回跳参数宣布订阅生效。

## 实现边界与安全条件

- 延用现有“订阅读模型 / webhook / UI”三个 feature 的分界与既有 verification 命令。本提案不合并它们，也不修改它们的状态。
- 托管支付链接里的用户引用采用服务端保存、绑定当前 principal 的 opaque intent；外部可改的 userId/email/client_reference_id 本身不构成所有权证据。只有验证后的 webhook 及服务端绑定能关联客户/订阅。静态 Payment Link 可创建多个 Checkout Session，本提案不声称 opaque 引用或 UI 按钮禁用能在 Stripe 侧保证跨窗口只创建一份订阅；若实施要求该保证，须单独评估可重用 Checkout Session/幂等创建流程，不能隐含承诺。
- Portal 会话由服务端选择已验证的 customer 创建；URL、customer 对象、密钥和原始 webhook 不输出日志。
- webhook 保留原始 UTF-8 body 验签，再解析；事件按 provider_event_id 幂等。事件时间不是全序，不能简单用 event.created 覆盖快照；实际实现需以受限 provider snapshot 读取与对象串行化验证乱序/并发，失败不能当成已处理后 ACK。
- Stripe API 版本必须显式固定并用真实响应形状断言。当前官方周期字段在订阅 items 上，单 planRef 视图须有明确单 recurring-item 约束；不得照搬旧参考的顶层字段。多商品/席位账单不在原需求范围。

## 验收增补（采纳后落实到原 feature 测试）

- 对本表每个状态核对有效权益与升级/管理资格；付款异常/暂停状态不出现购买新订阅的按钮。
- 两个新增状态通过公开 schema/真实存储/只读 API；未来未知状态不返回 none，不覆盖已知快照，不记成功。
- active 的到期取消保持有效直到 Stripe 终态，页面讲清截止时间；canceled/incomplete_expired 可以重新购买。
- 验证跨用户、伪造用户引用、回跳假成功、未配置、未验签、重放、并发及乱序事件、provider 查询失败时快照保护。
- 保留 0 额度流水变化断言。真实 browser/API/PG + 独立签名 webhook fixture 只证明集成；生产 Stripe 密钥/配置与真实商户验收另行记录。

## 备选与取舍

- 推荐本表：权益与账单管理分开，覆盖 Stripe 原始状态，防止已知非终态订阅被重复售卖；代价是增加两个枚举成员和异常状态 UI/测试。
- 保持现有字面 active/trialing 单一分类：改动少，但会让欠费用户不能管理已有账单、反而获得再次购买入口，违背防重复售卖目标。
- 将未知状态映射 none/canceled：前端改动少，但违反原样落库裁决并可能错误撤销或授予权益，拒绝采用。

## 已核对来源与不确定性

- 既有需求 `requirements/03-subscription-stripe.md` R3、R4-E2/E5/E6；billing-subscription 已签材料及 2026-10-01 状态原样落库裁决。
- 参考仓库 payment.service.ts 原样保存 subscription.status，未解决入口资格分类；只参考其托管付款/门户行为。
- 官方 [Subscription object](https://docs.stripe.com/api/subscriptions/object)、[Payment Link URL parameters](https://docs.stripe.com/payment-links/url-parameters)、[Webhook delivery](https://docs.stripe.com/webhooks)、[Portal sessions](https://docs.stripe.com/api/customer_portal/sessions/create)。2026-10-16/17 读取；实际接入需固定 API 版本后再核对具体字段。未调用商户 API、未读真实凭据、未修改线上配置。
