# 契约束 `billing-credits` — 领域模型与不变量（支撑材料）

> 最内层，不依赖任何人。形状的权威在 `packages/contracts/src/billing-credits.ts`（签核③）；
> 本文件是**不变量**与**枚举封闭性**的唯一收敛点（ADR-023 决策二）。
> 依据：`requirements/00-overview.md`、`01-credits-topup.md`、`02-payment-order-notify.md`、`04-billing-admin.md`；
> 参考 `boardx-backend/src/credits/**`（语义对齐，实现按本仓 NestJS + Postgres 重做，不照搬 Mongoose 结构）。

## 一、现状基线

- 已有未跟踪骨架（`apps/api/src/infrastructure/payment/payment-config.ts`、`apps/api/src/interface/controllers/payment.controller.ts`、
  `packages/contracts/src/payment.ts`、`apps/api/tests/payment/`）——本束**重写**：
  - 骨架的 `region: cn|en → provider` 映射不保留。参考实现按 `PAYMENT_TYPE` 切渠道、其 region 仅 `cn/global` 且实际硬编码 `cn`；
    本束按「部署配置的启用渠道集合 `enabledProviders`」建模，region 概念不进入契约。
  - 骨架的 `GET /billing/payment-config` 503 语义改为 `GET /billing/config` 返回 `{enabledProviders: []}`（未启用 = 空数组，前端据此隐藏入口），**不用 HTTP 错误表达"未配置"**。
  - 骨架文件在实现落地时删除或并入，禁止形成第二事实源。
- 参考实现关键事实（语义来源）：微信 Native 手写 v3 API（`wechat/v3/pay/transactions/native`）、订单 15 分钟过期、
  回调 AES-256-GCM 解密、`completeCreditPaymentOrder` 幂等入账、`mock-paid` 生产禁用。参考实现的已知缺陷（验签被注释、无关单任务）**禁止照搬**（`requirements/00-overview.md` R2）。

## 二、实体与值对象

| 实体 / 表 | 关键字段 | 说明 |
|---|---|---|
| `credit_packages` | `package_id`(pk), `region`, `currency`, `amount_fen`, `base_credits`, `bonus_credits`, `bonus_rate`, `total_credits`, `owner_type`(user/team/both), `enabled`, `sort_order` | 套餐配置；**部署时种子数据**，本阶段不提供套餐 CRUD |
| `billing_orders` | `order_no`(pk), `owner_type`, `owner_id`, `created_by`, `package_id`, `amount_fen`, `base_credits`, `bonus_credits`, `provider`, `status`, `qr_code_url`, `channel_order_no`, `created_at`, `paid_at`, `notify_at`, `expired_at`, `closed_at`, `last_error_code`, `last_error_message` | 一次充值意图；金额/额度为**下单时套餐快照** |
| `credit_wallets` | `wallet_id`(pk), `owner_type`, `owner_id`, `balance`, `total_purchased`, `total_granted`, `updated_at` | unique(`owner_type`,`owner_id`)；本阶段消耗恒为 0 |
| `credit_transactions` | `txn_id`(pk), `wallet_id`, `type`(purchase/bonus/grant), `direction`(+1/−1), `credits`, `balance_after`, `source_type`(payment_order/admin_grant), `source_id`, `operator_id`(null), `reason`(null), `created_at` | 每次余额变更的对应流水；`(source_type, source_id, type)` 去重 |
| `org_billing_settings` | `org_id`(pk), `credit_enabled`, `updated_by`, `updated_at` | 组织计费开关 |
| `billing_webhook_events` | `event_id`(pk), `provider`, `provider_event_id`, `order_no`(null), `signature_verified`, `processed_at`, `result`(ok/rejected/ignored) | 回调去重与审计；`provider_event_id`（微信 `notify.id`）唯一 |

- 读模型（非持久化）：`enabledProviders` 来自部署配置（`billing-config`），运行期只读。
- 值对象：
  - `MoneyFen`：非负整数，单位分。
  - `Credits`：正整数。
  - `OrderNo`：`bg<yyyyMMddHHmmss><6位随机>` 形态的全局唯一字符串。
  - `OwnerRef { ownerType: "user" | "team", ownerId }`。
  - `PaymentProvider { wechat }`（本束；支付宝不在范围）。
  - `OrderStatus { PENDING, PROCESSING, SUCCESS, FAILED, CLOSED }`。

## 三、封闭枚举（新增成员须走 ADR；测试断言「集合与契约一致 + 未声明值不通过」，不断言长度）

- `BillingOrderStatus`：PENDING / PROCESSING / SUCCESS / FAILED / CLOSED。
- `BillingTransactionType`：purchase / bonus / grant。（消费类枚举（consume/debt 等）**本阶段不引入**，不加"占位成员"。）
- `BillingOwnerType`：user / team。
- `BillingErrorCode`（HTTP 失败码，snake_case）：`payment_provider_not_configured` / `package_not_found` / `package_disabled` /
  `org_billing_disabled` / `order_not_found` / `forbidden` / `wechat_upstream_failed` / `order_not_pending` /
  `invalid_amount` / `reason_required` / `owner_not_found` / `signature_invalid` / `amount_mismatch` / `mock_forbidden`。
- `WechatNotifyAck { code: "SUCCESS" | "FAIL" }`（回调应答仅此两值）。

## 四、不变量（任何时刻为真，违反即数据损坏；每条可写成断言）

- **I-1 状态机封闭**：`billing_orders.status` ∈ `BillingOrderStatus`，且合法迁移仅五条边：
  `PENDING→PROCESSING`（回调验签后抢占）、`PENDING→CLOSED`（关单任务）、`PROCESSING→SUCCESS`（入账完成）、
  `PROCESSING→FAILED`（入账异常）、`CLOSED→SUCCESS`（资金优先兜底，仅限验签通过且金额一致的成功回调）。
  SUCCESS / FAILED 之后无任何出边。
- **I-2 至多一次入账**：任一订单对应的 `credit_transactions` 中，`(source_type='payment_order', source_id=order_no, type='purchase')`
  至多 1 条，`type='bonus'` 至多 1 条。
- **I-3 账实相符**：任一时刻，`credit_wallets.balance == Σ(该钱包全部流水 credits×direction)`；每笔流水的 `balance_after`
  等于该笔提交后的钱包余额；余额变更与流水写入在同一事务提交。
- **I-4 钱包唯一且非负**：`(owner_type, owner_id)` 唯一；`balance ≥ 0`（本阶段仅入账，天然更强）。
- **I-5 订单快照不可变**：订单创建后 `amount_fen / base_credits / bonus_credits / package_id / owner_*` 永不改变；
  回调携带金额与 `amount_fen` 不等即拒绝入账（`amount_mismatch`）。
- **I-6 入账前置**：写钱包前必须同时满足 ① 该订单被条件更新抢占为 PROCESSING（`PENDING→PROCESSING` 成功）；
  ② 存在本次回调的 `billing_webhook_events` 记录且 `signature_verified=true`。二者缺一不得写钱包。
- **I-7 回调幂等**：`billing_webhook_events.provider_event_id` 唯一；同一事件重复到达不产生第二次处理副作用；
  同一订单的重复回调按 I-1/I-2 收敛为至多一次入账。
- **I-8 发放留痕**：`type='grant'` 的流水 `operator_id` 与 `reason` 均非空；`source_type='admin_grant'`。
- **I-9 归属固定**：订单 `(owner_type, owner_id)` 创建后不可变；一切读路径（订单查询/钱包/流水）必须校验调用者归属，
  无权限一律按 `order_not_found` / `forbidden` 收敛，不泄露资源存在性。
- **I-10 过期可关闭**：`PENDING` 订单创建超过 15 分钟（`created_at + 15min ≤ now`）可被关单任务置 CLOSED 并写 `closed_at`；
  在此之前不得被非回调路径关闭。
- **I-11 整数金额**：一切金额字段为整数分、一切额度字段为正整数；代码中金额运算不得出现浮点。
- **I-12 开关只控新建**：`org_billing_settings.credit_enabled=false` 时，针对该组织的 `createPaymentOrder` 必须拒绝
  （`org_billing_disabled`）；对已有订单/钱包/流水的读取与回调入账**不受影响**。
- **I-13 无假二维码**：任何 `status=PENDING` 的订单其 `qr_code_url` 非空；拿不到 `qr_code_url` 的微信下单失败**不得落库为订单**
  （订单只在微信下单成功后写入）。
- **I-14 时间戳与状态一致**：`paid_at`/`notify_at` 仅 SUCCESS 后可非空；`closed_at` 仅 CLOSED 后可非空；
  每次状态迁移必须留下对应时间戳，缺时间戳的迁移视为缺陷。

## 五、规则（不是不变量，由用例/任务执行）

- 关单任务周期建议 ≤5 分钟（保证 15 分钟过期语义的及时性）；任务自身幂等（只动 PENDING）。
- 微信回调应答必须快（<5s）：处理与应答分离按 `02-payment-order-notify.md` R7。
- 日志留存：回调原始事件、入账、发放的后端审计日志按仓库通用保留策略，金额相关日志不得出现密钥明文。
