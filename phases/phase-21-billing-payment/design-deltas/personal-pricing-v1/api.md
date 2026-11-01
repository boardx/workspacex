# API 提案与兼容边界

契约单源为 `packages/contracts/src/billing-pricing.ts`，此处只解释，不手写第二份 JSON schema。当前尚未注册新运行时路由。

| 操作 | 契约 | 权限与结果 |
|---|---|---|
| GET /billing/catalog | operations.getPricingCatalog | 沿用 PrincipalGuard；服务端选择市场、商品版本及启用渠道，不接受客户端价格参数 |
| POST /billing/checkout | operations.createPersonalCheckout | 沿用 PrincipalGuard；个人付款人取 principal，幂等键绑定购买意图；返回支付链接不是已授予权益 |
| GET /billing/subscription/entitlement | PricingSubscriptionInfo | 新增明确版本的权益读模型；既有 GET /billing/subscription 保持原 schema；付款结束仍为 currentPeriodEnd，月度额度区间仍在 creditGrant；新增方案、付款周期、续费方式及 welcomeCreditGrant |
| 既有钱包／流水／用量／管理门户 | 保持原 operations | 既有权限来源与 owner 校验不变；不给客户端新的余额写入口 |
| 微信／Stripe webhook | 保持原入口 | 仅新版本订单进入支付处理；旧引用被版本屏障拒绝或忽略，保留 raw body 验签与可信提供方核对 |

`welcomeCreditGrant` 区分无赠送、已发放和已过期，必须给出真实到账与到期时间，不用“无记录=0”掩盖服务故障。新接口的方案／付款周期／续费方式和 welcomeCreditGrant 必须显式返回。新计费 UI 使用独立新读模型；旧入口在阶段切换时退役；新 UI 仅在新接口就绪后切换，不把旧 payload 直接解析成新契约，不在前端猜测缺省权益。旧 purchaseMode: manual_monthly 不进入新读模型，避免与年付混用。

错误：目录版本失效、商品不可购、幂等参数冲突须有不同可观察结果。数据库／支付提供方依赖异常按既有通用 503 处理，不伪装成未订阅或未付款。

## 待签核的技术选择

1. 用新目录与统一 Checkout 入口承载新价格；旧订单、订阅、余额、流水清空，不迁移旧权益。现存入口只作为分阶段替换对象，不继续承诺旧订单兼容。
2. 年度付款权益独立于月度额度批次；调度可重放、读取时到期归一化仍为必需。
3. Free 与订阅批次共用不可变流水／钱包锁，但分别保留来源和有效期；赠送 30 天按真实 UTC 时长计，不按自然月替代。
