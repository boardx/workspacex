# 契约束 `billing-subscription` — ② 用例（签核面第 ② 件）

> 依据：`requirements/03-subscription-stripe.md`（R1–R12）。
> 形状单源：`packages/contracts/src/billing-subscription.ts` 的 `billingSubscription.<op>`；
> `err` 取值全部来自 `SubscriptionErrorCode`（`domain.md` §三）。不变量编号见 `domain.md`。
> HTTP 路径为本束提案；落地时须同步 `apps/web/lib/navigation.ts` 与 nav-reachability 配置。

## 一、对外用例（有 HTTP 面）

### UC-BS-1 读取订阅状态 — `getSubscriptionInfo`（GET `/billing/subscription`）
- in: 无。
- out: `{ status: SubscriptionStatus, planRef?: string, currentPeriodEnd?: string(ISO), cancelAtPeriodEnd?: boolean }`；
  无订阅记录 → `status: "none"`（**不是错误**，I-4）。
- pre: 登录。
- 用途：用户菜单/升级弹窗/回跳后的状态读取；**纯读**（I-1/I-4：回跳不得写状态）。
- err: 无。

### UC-BS-2 取升级链接 — `getUpgradeLink`（GET `/billing/subscription/upgrade-link`）
- in: 无。
- out: `{ url }`（Stripe 托管支付链接，含用户引用与语言等预填参数）。
- pre: 登录；Stripe 已启用（否则 `payment_provider_not_configured`，I-6）；当前未订阅（I-5）。
- err: `payment_provider_not_configured` | `already_subscribed`（前端应改用管理入口，要求 R4-E6）。

### UC-BS-3 取管理链接 — `getManagementLink`（GET `/billing/subscription/management-link`）
- in: 无。
- out: `{ url }`（Billing 门户会话链接）。
- pre: 登录；Stripe 已启用；当前已订阅（I-5）。
- err: `payment_provider_not_configured` | `not_subscribed`（前端应改用升级入口）。

### UC-BS-4 Stripe webhook — `stripeWebhook`（POST `/billing/webhooks/stripe`）
- in: 原始报文 + `Stripe-Signature` 头（**raw body**，不进通用 JSON 解析）。
- out: `{ received: true }`，HTTP 200。Stripe 以 2xx 判定投递成功。
- 步骤：
  1. 验签（`STRIPE_WEBHOOK_SECRET`）失败 → 记录拒绝审计 + 400（**不写任何业务状态**，I-7）。
  2. 事件幂等：`provider_event_id` 已处理 → 200 直接返回（I-3）。
  3. 命中订阅相关事件（至少：创建 / 更新 / 取消）→ UC-BS-I1 应用事件 → 200。
  4. 未覆盖事件类型 → 记 `ignored` + 200（不得因未知事件报 5xx 引发 Stripe 重试风暴）。
  5. 处理中异常 → 500（促使 Stripe 重试；重试由幂等兜底）。
- pre: 无用户鉴权，但必须验签（I-7）。
- err（对 Stripe 的应答）：400（`signature_invalid`）/ 500（内部异常，可重试）。

## 二、内部端口用例（无 HTTP 面）

| 用例 | 端口 | 输入 → 输出 | 失败 |
|---|---|---|---|
| UC-BS-I1 应用订阅事件 | `SubscriptionEventApplier.apply(event)` | 结构化事件 → upsert `billing_subscriptions`（唯一写者路径，I-1/I-2） | 事件字段缺失/无法映射 → 记 `rejected` 审计并抛错（触发方 500 重试）；未知类型由调用方归类 `ignored` 不进入本端口 |

## 三、开放问题（待签核人裁决）

- **Q1** 计划展示名：`planRef`（Stripe 价格/产品标识）到界面文案（如「Pro」）的映射住哪——本契约只存 `planRef`，展示映射属 UI 层。是否需要系统内维护"计划目录"（名称/权益说明）？本阶段建议不做（Stripe 侧为单源）。
- **Q2** webhook 事件清单的最小集：建议 `checkout.session.completed` + `customer.subscription.created/updated/deleted`（实现 PR 内最终敲定并列证据）；是否还覆盖 `invoice.payment_failed`（对应 `past_due` 呈现）需裁决。
- **Q3** 管理门户形态：静态门户 URL 配置 vs 运行时创建 portal session（参考实现是运行时创建）；本契约不限定，由实现按配置能力选型，但契约输出恒为 `{ url }`。
- **Q4** 试用（trial）展示语义：`trialing` 是否在 UI 上等同 `active`（参考 web 把它当已订阅）；本契约按"已订阅"处理，签核人确认。
