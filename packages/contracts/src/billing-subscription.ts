/**
 * billing-subscription.ts —— Stripe 订阅（状态读取 / 升级链接 / 管理链接 / webhook）
 * 的 API 契约单一事实源（ADR-020 / ADR-023 签核③）。
 *
 * 契约束：phases/phase-21-billing-payment/contracts/billing-subscription/
 * 依据：requirements/03-subscription-stripe.md（R1–R12）；
 * 参考 boardx-backend/src/payment/**（Stripe 订阅语义）与 boardx-web UpgradePlanDialog（跳转/回跳）。
 * 不变量权威在同束 domain.md（I-1～I-7）。渠道启用读模型与 billing-credits 同源（`GET /billing/config`），本文件不复述。
 *
 * 参考实现已知缺陷**不照搬**：Stripe 配置缺失不得阻塞服务启动（requirements/00-overview.md R2-3）。
 */
import { z } from "zod";

/* ── 封闭枚举（新增成员须经 ADR；见 domain.md §三） ────────────────────── */

/** 订阅状态（Stripe 语义子集）；无记录 = `none`（在系统内等价读法）。 */
export const SubscriptionStatus = z.enum([
  "none",
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "unpaid",
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

/** 订阅失败码（HTTP 失败）。 */
export const SubscriptionErrorCode = z.enum([
  "payment_provider_not_configured", // I-6：Stripe 未启用/配置缺失（不阻塞启动；接口返回此码或入口不可见）
  "already_subscribed", // I-5：已订阅用户请求升级链接（前端应改用管理入口）
  "not_subscribed", // I-5：未订阅用户请求管理链接（前端应改用升级入口）
  "forbidden", // 通用越权
  "signature_invalid", // I-7：webhook 验签失败（不写任何状态）
]);
export type SubscriptionErrorCode = z.infer<typeof SubscriptionErrorCode>;

/* ── 视图 ─────────────────────────────────────────────────────────────── */

/**
 * 订阅状态视图（纯读；回跳读取与用户菜单共用，I-4：它不是状态推进的入口）。
 * `status: "none"` = 无订阅记录，不是错误。
 */
export const SubscriptionInfo = z
  .object({
    status: SubscriptionStatus,
    planRef: z.string().min(1).nullable(), // Stripe 侧价格/产品标识；展示名映射属 UI 层（usecases Q1）
    currentPeriodEnd: z.string().min(1).nullable(), // ISO 8601
    cancelAtPeriodEnd: z.boolean().default(false),
  })
  .strict();

/** 跳转链接（升级支付页 / 管理门户共用形状）。 */
export const SubscriptionLink = z
  .object({
    url: z.string().url(),
  })
  .strict();

/** webhook 成功应答（Stripe 以 2xx 判定投递成功；未覆盖事件同样 2xx + ignored 审计）。 */
export const StripeWebhookAck = z
  .object({
    received: z.literal(true),
  })
  .strict();

/* ── operations（HTTP 路径为本束提案；落地时同步 navigation/nav-reachability） ── */

export const operations = {
  /** UC-BS-1：读取订阅状态（纯读；webhook 未到时返回当前已存状态，绝不把已订阅报成 none）。 */
  getSubscriptionInfo: {
    method: "GET",
    path: "/billing/subscription",
    in: z.object({}).strict(),
    out: SubscriptionInfo,
    err: [] as const,
  },

  /** UC-BS-2：取升级链接（仅未订阅；含用户引用与语言预填）。 */
  getUpgradeLink: {
    method: "GET",
    path: "/billing/subscription/upgrade-link",
    in: z.object({}).strict(),
    out: SubscriptionLink,
    err: ["payment_provider_not_configured", "already_subscribed"] as const,
  },

  /** UC-BS-3：取管理链接（仅已订阅；Billing 门户）。 */
  getManagementLink: {
    method: "GET",
    path: "/billing/subscription/management-link",
    in: z.object({}).strict(),
    out: SubscriptionLink,
    err: ["payment_provider_not_configured", "not_subscribed"] as const,
  },

  /**
   * UC-BS-4：Stripe webhook（**raw body**，不进通用 JSON 解析管道）。
   * 唯一写者路径（I-1）；验签失败 400 且不写任何状态（I-7）；未知事件 200 + ignored 审计。
   */
  stripeWebhook: {
    method: "POST",
    path: "/billing/webhooks/stripe",
    in: z
      .object({
        rawBody: z.string(),
        headers: z.record(z.string(), z.string()),
      })
      .strict(),
    out: StripeWebhookAck,
    err: [] as const,
  },
} as const;

export type BillingSubscriptionOperations = typeof operations;
