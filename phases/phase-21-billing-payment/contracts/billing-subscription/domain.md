# 契约束 `billing-subscription` — 领域模型与不变量（支撑材料）

> 最内层，不依赖任何人。形状的权威在 `packages/contracts/src/billing-subscription.ts`（签核③）；
> 本文件是**不变量**与**枚举封闭性**的唯一收敛点（ADR-023 决策二）。
> 依据：`requirements/00-overview.md`、`03-subscription-stripe.md`（R1–R12）；
> 参考 `boardx-backend/src/payment/**`（Stripe 订阅：payment link / billing portal / webhook / 订阅状态表）与
> `boardx-web/src/components/ui-user/UpgradePlanDialog.tsx`（跳转与回跳刷新）。语义对齐，实现按本仓 NestJS + Postgres 重做。

## 一、现状基线

- 本仓暂无任何订阅/Stripe 代码（全仓检索为空）；本束从零建立。
- 参考实现的已知缺陷**不照搬**：`STRIPE_*` 环境变量即使未启用渠道也强制必填导致启动失败
  （见 `requirements/00-overview.md` R2-3）——本束要求未启用渠道时配置缺失**不阻塞启动**。
- 参考实现的行为语义（沿用）：免费用户取静态支付链接 → 跳转 Stripe 托管页 → 回跳后按订阅状态刷新；
  已订阅用户取 Billing 门户链接；webhook 驱动订阅状态落库。

## 二、实体与值对象

| 实体 / 表 | 关键字段 | 说明 |
|---|---|---|
| `billing_subscriptions` | `user_id`(pk), `provider`(stripe), `customer_ref`, `subscription_ref`, `status`, `plan_ref`, `current_period_start`, `current_period_end`, `cancel_at_period_end`, `trial_start`, `trial_end`, `updated_at` | one row per user（现状快照），由 webhook 驱动更新 |
| `billing_webhook_events` | `event_id`(pk), `provider`(stripe), `provider_event_id`, `processed_at`, `result`(ok/ignored/rejected) | webhook 去重与审计（与 billing-credits 同名表共用一张，见「跨束一致性」） |

- 值对象：
  - `SubscriptionStatus { none, active, trialing, past_due, canceled, incomplete, unpaid }` —— 以 Stripe 语义为准的子集，
    **未订阅 = `none`**（在系统内等价于"无记录"的读法）。
  - `SubscriptionPlanRef`：Stripe 侧价格/计划标识的字符串（本仓不维护计划目录）。
- 配置（非持久化，部署配置）：`STRIPE_SECRET_KEY` / `STRIPE_PAYMENT_LINK` / `STRIPE_MANAGEMENT_PORTAL`（或等价的运行时创建参数）/
  `STRIPE_WEBHOOK_SECRET`。启用与否由 `enabledProviders` 表达（与 billing-credits 的 `GET /billing/config` 同一读模型）。

## 三、封闭枚举（新增成员须走 ADR；测试断言「集合与契约一致 + 未声明值不通过」，不断言长度）

- `SubscriptionStatus`（上表成员）。
- `SubscriptionErrorCode`（HTTP 失败码，snake_case）：`payment_provider_not_configured` / `already_subscribed` /
  `not_subscribed` / `forbidden` / `signature_invalid`。
  （未知事件类型**不是错误码**：它在 `billing_webhook_events.result` 里记 `ignored` 并以 200 应答，不进入契约错误枚举。）

## 四、不变量（任何时刻为真，违反即数据损坏；每条可写成断言）

- **I-1 单写者**：`billing_subscriptions` 的状态字段（`status` / 周期 / `cancel_at_period_end` 等）**只允许由 Stripe webhook
  处理路径写入**；用户侧接口（upgrade-link / management-link / info）只读，不得修改订阅行。
- **I-2 每用户至多一行**：`user_id` 唯一；webhook 对同一用户的事件只更新该行（无记录则创建）。
- **I-3 事件幂等**：`billing_webhook_events.provider_event_id` 唯一；同一事件重复到达不产生第二次副作用。
- **I-4 回跳不写状态**：从 Stripe 回跳触发的 `getSubscriptionInfo` 是纯读；状态推进只能来自 webhook。
  （允许"未知不误报"：webhook 未到时返回当前已存状态，绝不把已订阅报成 `none`。）
- **I-5 链接按状态单义**：`getUpgradeLink` 仅对未订阅用户返回链接（已订阅 → `already_subscribed`）；
  `getManagementLink` 仅对已订阅用户返回链接（未订阅 → `not_subscribed`）。二者不得静默返回对方的链接。
- **I-6 未配置不阻塞**：Stripe 未在 `enabledProviders` 中时，服务启动不得因 Stripe 配置缺失失败；
  相关接口返回 `payment_provider_not_configured`（或入口不可见），不得抛出未处理异常。
- **I-7 webhook 必验签**：验签失败的请求不得写入任何表、不得改变任何状态；仅留下拒绝审计记录。

## 五、规则（不是不变量，由用例执行）

- webhook 事件覆盖范围（至少：订阅创建 / 更新 / 取消）：具体 event type 清单在实现 PR 中列明并留证据；未覆盖事件记录为 `ignored`。
- 用户取消订阅的生效时点语义（立即 vs 到期）按 Stripe 返回的 `cancel_at_period_end` 呈现，UI 文案必须讲清时点（要求 R4-E5）。

## 六、跨束一致性（与 `billing-credits`）

- `billing_webhook_events` 两束共用一张表：`provider` 列区分 `wechat` / `stripe`；`order_no` 列对 stripe 事件为 `null`。
  该表的唯一事实源在 `packages/contracts/src/billing-credits.ts` 的 schema 中声明，本束引用而不重复定义。
- `enabledProviders` 读模型同源：两束的"是否配置"判定都读 `GET /billing/config` 的同一字段，禁止各自再定义一份。
