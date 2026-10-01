# 契约束 `billing-credits` — ② 用例（签核面第 ② 件）

> 依据：`requirements/01-credits-topup.md`、`02-payment-order-notify.md`、`04-billing-admin.md`。
> 形状单源：`packages/contracts/src/billing-credits.ts` 的 `billingCredits.<op>`；
> 下文 `err` 取值全部来自 `BillingErrorCode`（`domain.md` §三）。不变量编号见 `domain.md`。
> HTTP 路径为本束提案；落地时须同步 `apps/web/lib/navigation.ts` 与 nav-reachability 配置（contract-design.md「物化③连带门」）。

## 一、对外用例（有 HTTP 面）

### UC-BC-1 读取渠道配置 — `getBillingConfig`（GET `/billing/config`）
- in: 无（登录态可选）。
- out: `{ enabledProviders: ("wechat" | "stripe")[] }`（Stripe 启用时含 `"stripe"`——共享读模型比下单枚举宽，见契约 `BillingEnabledProvider`）；未配置渠道时为 `[]`（**不是错误**，前端据此隐藏入口，I-6/要求 E1）。
- pre: 无。
- err: 无。

### UC-BC-2 列出套餐 — `listPackages`（GET `/billing/packages`）
- in: `{ ownerType }`（query）。
- out: `{ items: [{ packageId, amountFen, displayAmount, currency, baseCredits, bonusCredits, bonusRate, totalCredits, ownerType }] }`；
  只返回 `enabled=true` 且匹配 ownerType 的套餐；空列表合法。
- pre: 登录。
- err: `forbidden`（组织主体非成员）。

### UC-BC-3 创建充值订单 — `createPaymentOrder`（POST `/billing/orders`）
- in: `{ ownerType, ownerId?, packageId, provider: "wechat" }`（**无任何金额字段**；服务端一律以套餐为准，I-5/要求 R7-1）。
- out: `{ order: { orderNo, status: "PENDING", qrCodeUrl, amountFen, baseCredits, bonusCredits, currency, createdAt, expiredAt } }`，HTTP 201。
- 步骤：渠道启用校验（E1）→ 主体权限校验（E7）→ 组织开关校验（I-12）→ 套餐可用性校验（E8）→ 微信 Native 下单
  （I-13：失败不落库，返回 `wechat_upstream_failed`）→ 落库 PENDING（`expiredAt = createdAt + 15min`）。
- pre: 登录；个人主体=本人；组织主体=该组织 owner/admin。
- err: `payment_provider_not_configured` | `forbidden` | `org_billing_disabled` | `package_not_found` | `package_disabled` | `wechat_upstream_failed`。

### UC-BC-4 查询订单状态 — `getPaymentOrder`（GET `/billing/orders/:orderNo`）
- in: `{ orderNo }`。
- out: `{ order: { orderNo, status, amountFen, baseCredits, bonusCredits, qrCodeUrl, createdAt, paidAt?, notifyAt?, expiredAt, closedAt?, lastErrorCode? } }`。
- pre: 登录 + 归属校验（I-9）。
- 用途：前端 3s 轮询与手动刷新；**纯读，不驱动任何状态变化**（要求 R7-2）。
- err: `order_not_found`（他人订单/不存在一律此码，R5）。

### UC-BC-5 查看钱包 — `getWallet`（GET `/billing/wallet`）
- in: `{ ownerType, ownerId? }`。
- out: `{ wallet: { ownerType, ownerId, balance, totalPurchased, totalGranted, updatedAt } }`；无钱包时返回全零的空钱包（不 404）。
- pre: 登录 + 归属（个人=本人；组织=成员可读？——**开放问题 Q5**，本契约暂按 owner/admin 可读）。
- err: `forbidden`。

### UC-BC-6 查看流水 — `listTransactions`（GET `/billing/transactions`）
- in: `{ ownerType, ownerId?, type?, limit(≤100, 默认 20), cursor? }`。
- out: `{ items: [{ txnId, type, direction, credits, balanceAfter, sourceType, sourceId, reason?, createdAt }], nextCursor? }`；空列表合法。
- pre: 同 UC-BC-5。
- err: `forbidden`。

### UC-BC-7 微信回调 — `wechatNotify`（POST `/billing/webhooks/wechat`）
- in: 原始报文 + 验签头（`wechatpay-*` 系列），**raw body**（不进通用 JSON 解析，参考 `main.ts` raw 先例）。
- out: `{ code: "SUCCESS" | "FAIL" }`（仅此两值；FAIL 促使微信重试）。
- 步骤（详见 `02-payment-order-notify.md` R3 与 I-6/I-7）：
  1. 验签失败 → 记 `billing_webhook_events(result=rejected)`，回 FAIL（E1）。
  2. 解密 → 取 `provider_event_id`（notify.id）/`order_no`/`amount_fen`/`trade_state`。
  3. 事件幂等：`provider_event_id` 已存在且已处理 → 直接按结果回 SUCCESS（E4/I-7）。
  4. 订单存在 + 金额一致校验（E2/I-5）；`trade_state != SUCCESS` → 记录后回 SUCCESS（忽略非成功态）。
  5. 抢占 `PENDING→PROCESSING`（I-6）；订单已 SUCCESS → 幂等回 SUCCESS；PROCESSING 中 → 回 FAIL 让微信重试。
  6. 调 UC-BC-I2 入账（CLOSED 订单同样允许，I-1 兜底边）；成功回 SUCCESS，异常置 FAILED 回 SUCCESS（已记录，不再促微信重试）。
- pre: 无用户鉴权，但必须验签（I-6）。
- err（对微信的应答恒为 SUCCESS/FAIL 两值；内部错误码仅落审计）：`signature_invalid` | `amount_mismatch` | `order_not_found`。

### UC-BC-8 mock 完成订单 — `mockCompletePaymentOrder`（POST `/billing/orders/:orderNo/mock-paid`）
- in: `{ orderNo }`。
- out: `{ order }`（SUCCESS）。
- pre: **非生产环境**（`NODE_ENV !== "production"`）；订单归属：测试账号可对自己订单操作。
- 行为：走与回调相同的抢占 + 入账内核（UC-BC-I1/I2），**不走验签**（无外部签名）；生产环境恒返回 `mock_forbidden` 且不改变任何状态（要求 E6）。
- err: `mock_forbidden` | `order_not_found` | `order_not_pending`。

### UC-BC-9 管理端查钱包 — `adminGetWallet`（GET `/billing/admin/wallets/:ownerType/:ownerId`）
- out: `{ wallet }`（同 UC-BC-5 形状；不存在返回 `owner_not_found`，不返回空壳——要求 E5）。
- pre: 平台管理员。
- err: `forbidden` | `owner_not_found`。

### UC-BC-10 管理端发放额度 — `adminGrantCredits`（POST `/billing/admin/credits/grant`）
- in: `{ ownerType, ownerId, credits（正整数）, reason（非空） }`。
- out: `{ transaction, wallet }`。
- 行为：同一事务内钱包累加 + 写 `type=grant` 流水（`operator_id`=当前管理员，`reason` 落库，I-8）。
- pre: 平台管理员。
- err: `forbidden` | `owner_not_found` | `invalid_amount`（≤0 或非整数） | `reason_required`。

### UC-BC-11 读取组织计费设置 — `getOrgBillingSetting`（GET `/billing/org-settings/:orgId`）
- out: `{ setting: { orgId, creditEnabled, updatedBy, updatedAt } }`。
- pre: 登录 + 该组织 owner/admin，或平台管理员。
- err: `forbidden` | `owner_not_found`（org 不存在）。

### UC-BC-12 修改组织计费设置 — `updateOrgBillingSetting`（PATCH `/billing/org-settings/:orgId`）
- in: `{ creditEnabled }`。
- out: `{ setting }`。
- 行为：只影响后续 `createPaymentOrder`（I-12）；不触碰任何历史数据。
- pre: 该组织 owner/admin（平台管理员亦可）。
- err: `forbidden` | `owner_not_found`。

## 二、内部端口用例（无 HTTP 面）

| 用例 | 端口 | 输入 → 输出 | 失败 |
|---|---|---|---|
| UC-BC-I1 抢占订单 | `BillingOrderStore.claimForCrediting(orderNo)` | 条件更新 `PENDING→PROCESSING`（或 `CLOSED→SUCCESS` 兜底路径的对应抢占） → claimed 结果 | 未抢占（并发/已终态）→ 触发方按幂等规则回退应答 |
| UC-BC-I2 入账内核 | `BillingCreditingService.completeOrder(orderNo)` | `orderNo` → `{ wallet, transactions }`；幂等（已 SUCCESS 直接返回既有结果，I-2） | 事务异常 → 订单 FAILED + 错误留痕（E3）；不部分入账（单事务） |
| UC-BC-I3 过期关单 | `BillingOrderCloser.closeExpired(now)`（定时任务） | 扫描 `PENDING ∧ expired_at ≤ now` → 置 CLOSED + `closed_at`（幂等；只动 PENDING，I-10） | 无（单项失败记日志继续） |
| UC-BC-I4 微信 Native 下单 | `WechatPayClient.createNativeOrder(order)` | 订单快照 → `{ codeUrl, channelOrderNo }` | 上游超时/签名/参数错误 → `wechat_upstream_failed`（I-13：不落库） |
| UC-BC-I5 回调验签与解密 | `WechatPayNotifyVerifier.verify(headers, rawBody)` | → `{ providerEventId, orderNo, amountFen, tradeState }` | `signature_invalid`（不写任何状态）/ 解密失败（同上）/ 结构不符（同上） |

## 三、开放问题（待签核人裁决）

- **Q1** 额度是否为整数：本契约按正整数建模（参考实现即整数）；若未来接入按 token 的消耗计费再出 ADR（本阶段不引入消费枚举）。
- **Q2** 订单查询形态：本契约用 `GET /billing/orders/:orderNo`（REST 语义），参考实现是 `POST /credits/payment-orders/status`；确认按本仓惯例。
- **Q3** 关单任务的运行通道（pg-boss 作业 vs 进程内定时器）与周期（建议 ≤5 分钟），需与仓库既有基础设施对齐后落地。
- **Q4** 管理端发放是否需要限额/二次确认：本契约不做（要求 04 R6 已列不包含）；如有合规诉求需另立需求。
- **Q5** 组织钱包/流水的**成员可见性**：本契约暂定 owner/admin（+平台管理员）；普通成员是否可看组织余额需产品裁决。
- **Q6** `billing_webhook_events` 的保留策略与清理任务：本契约只管写入，清理策略留待实现期按仓库通用策略对齐（不阻塞签核）。
