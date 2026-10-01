/**
 * billing-credits.ts —— 额度充值与账务（套餐 / 订单 / 微信 Native 回调 / 钱包 / 流水 / 计费管理端）
 * 的 API 契约单一事实源（ADR-020 / ADR-023 签核③）。
 *
 * 契约束：phases/phase-21-billing-payment/contracts/billing-credits/
 * 依据：requirements/01-credits-topup.md、02-payment-order-notify.md、04-billing-admin.md；
 * 参考 boardx-backend/src/credits/**（语义对齐；实现按本仓 NestJS + Postgres 重做，不照搬 Mongoose 结构）。
 * 不变量权威在同束 domain.md（I-1～I-14）。订阅相关形状在 billing-subscription.ts，本文件不复述。
 *
 * 重写说明：未跟踪骨架 src/payment.ts（region cn|en → provider 的映射模型）作废，本文件为其替代
 * （requirements/00-overview.md R10；渠道启用由 enabledProviders 表达，region 概念不进入契约）。
 */
import { z } from "zod";

/* ── 基础标量 ─────────────────────────────────────────────────────────── */

/** 计费主体：个人 / 组织（org 模型映射见契约束 usecases.md Q5）。 */
export const BillingOwnerType = z.enum(["user", "team"]);
export type BillingOwnerType = z.infer<typeof BillingOwnerType>;

/** 支付渠道（本束仅微信 Native；Stripe 属 billing-subscription 束）。 */
export const BillingProvider = z.enum(["wechat"]);
export type BillingProvider = z.infer<typeof BillingProvider>;

/** 金额：非负整数分（I-11，禁止浮点参与金额运算）。 */
export const MoneyFen = z.number().int().nonnegative();

/** 额度：正整数。 */
export const CreditsAmount = z.number().int().positive();

/** 订单号：`bg<yyyyMMddHHmmss><6位随机>`，全局唯一（domain.md 值对象）。 */
export const OrderNo = z.string().regex(/^bg\d{14}[A-Za-z0-9]{6}$/);

/** ISO 8601 时间串（毫秒精度）。 */
export const IsoDateTime = z.string().min(1);

/* ── 封闭枚举（新增成员须经 ADR；见 domain.md §三） ────────────────────── */

/** 订单状态机（合法迁移仅五条边，见 domain.md I-1）。 */
export const BillingOrderStatus = z.enum(["PENDING", "PROCESSING", "SUCCESS", "FAILED", "CLOSED"]);
export type BillingOrderStatus = z.infer<typeof BillingOrderStatus>;

/** 流水类型（消费类枚举本阶段不引入，不加占位成员）。 */
export const BillingTransactionType = z.enum(["purchase", "bonus", "grant"]);
export type BillingTransactionType = z.infer<typeof BillingTransactionType>;

/** 流水方向：+1 入账 / −1 出账（本阶段只有入账，出账为未来语义预留值）。 */
export const BillingTransactionDirection = z.union([z.literal(1), z.literal(-1)]);

/** 钱包的来源类型（流水去重键的一半，I-2/I-8）。 */
export const BillingTransactionSourceType = z.enum(["payment_order", "admin_grant"]);

export const BillingErrorCode = z.enum([
  "payment_provider_not_configured", // E1：渠道未配置（入口不可用；不展示永远失败的二维码）
  "package_not_found", // E8：套餐不存在
  "package_disabled", // E8：套餐已下架/禁用
  "org_billing_disabled", // I-12：组织计费开关关闭时不得新建订单
  "order_not_found", // R5：订单不存在或调用者无归属权限（不泄露存在性）
  "forbidden", // 通用越权（组织主体非 owner/admin、非平台管理员等）
  "wechat_upstream_failed", // E2：微信 Native 下单失败（不落库为订单，I-13）
  "order_not_pending", // 状态机拒绝：目标订单不在可迁移态（含并发抢占失败）
  "invalid_amount", // 发放额度 ≤0 / 非整数
  "reason_required", // 人工发放缺原因
  "owner_not_found", // 计费主体不存在
  "signature_invalid", // E1：微信回调验签失败（不得入账）
  "amount_mismatch", // E2：回调金额与订单快照不一致（I-5）
  "mock_forbidden", // E6：生产环境调用 mock 支付端点
]);
export type BillingErrorCode = z.infer<typeof BillingErrorCode>;

/* ── 读模型与实体视图 ──────────────────────────────────────────────────── */

/** 渠道配置读模型：未启用渠道时为 `[]`（不是错误，前端据此隐藏入口）。 */
export const BillingConfig = z
  .object({
    enabledProviders: z.array(BillingProvider),
  })
  .strict();

/** 套餐 owner 作用域（配置数据；`both` 表示个人与组织皆可购）。 */
export const PackageOwnerScope = z.enum(["user", "team", "both"]);

export const CreditPackage = z
  .object({
    packageId: z.string().min(1),
    ownerType: PackageOwnerScope,
    region: z.string().min(1), // 参考实现 cn/global；本仓按部署种子数据
    currency: z.string().min(1), // 如 "CNY"
    amountFen: MoneyFen, // 服务端唯一计算源；前端不换算
    displayAmount: z.string().min(1), // 展示串（如 "¥99.00"），服务端生成
    baseCredits: CreditsAmount,
    bonusCredits: z.number().int().nonnegative(),
    bonusRate: z.number().nonnegative(), // 0.2 = 赠送 20%
    totalCredits: CreditsAmount, // = baseCredits + bonusCredits（配置一致性由种子数据校验保证）
  })
  .strict();

export const BillingOrder = z
  .object({
    orderNo: OrderNo,
    ownerType: BillingOwnerType,
    ownerId: z.string().min(1),
    provider: BillingProvider,
    status: BillingOrderStatus,
    packageId: z.string().min(1),
    amountFen: MoneyFen, // 下单时套餐快照，此后不可变（I-5）
    baseCredits: CreditsAmount,
    bonusCredits: z.number().int().nonnegative(),
    currency: z.string().min(1),
    qrCodeUrl: z.string().min(1), // I-13：订单存在即有二维码（微信下单失败不落库）
    createdAt: IsoDateTime,
    paidAt: IsoDateTime.nullable(), // 仅 SUCCESS 后可非空（I-14）
    notifyAt: IsoDateTime.nullable(),
    expiredAt: IsoDateTime, // createdAt + 15min
    closedAt: IsoDateTime.nullable(), // 仅 CLOSED 后可非空
    lastErrorCode: BillingErrorCode.nullable(), // 失败留痕（用户可读错误码）
  })
  .strict();

export const CreditWallet = z
  .object({
    ownerType: BillingOwnerType,
    ownerId: z.string().min(1),
    balance: z.number().int().nonnegative(),
    totalPurchased: z.number().int().nonnegative(),
    totalGranted: z.number().int().nonnegative(),
    updatedAt: IsoDateTime,
  })
  .strict();

export const CreditTransaction = z
  .object({
    txnId: z.string().min(1),
    type: BillingTransactionType,
    direction: BillingTransactionDirection,
    credits: CreditsAmount,
    balanceAfter: z.number().int().nonnegative(), // 账实相符锚点（I-3）
    sourceType: BillingTransactionSourceType,
    sourceId: z.string().min(1), // 订单号 / 发放记录号
    reason: z.string().nullable(), // 人工发放必填（I-8），其余可空
    createdAt: IsoDateTime,
  })
  .strict();

export const OrgBillingSetting = z
  .object({
    orgId: z.string().min(1),
    creditEnabled: z.boolean(), // 只影响新建订单（I-12）
    updatedAt: IsoDateTime,
  })
  .strict();

/** 微信回调应答：仅此两值（FAIL 促使微信重试）。 */
export const WechatNotifyAck = z
  .object({
    code: z.enum(["SUCCESS", "FAIL"]),
  })
  .strict();

/* ── operations（HTTP 路径为本束提案；落地时同步 navigation/nav-reachability） ── */

export const operations = {
  /** UC-BC-1：渠道配置读模型（未启用=[]，不是 503）。 */
  getBillingConfig: {
    method: "GET",
    path: "/billing/config",
    in: z.object({}).strict(),
    out: BillingConfig,
    err: [] as const,
  },

  /** UC-BC-2：套餐列表（只含 enabled 且匹配 ownerType 的套餐；空列表合法）。 */
  listPackages: {
    method: "GET",
    path: "/billing/packages",
    in: z.object({ ownerType: BillingOwnerType }).strict(),
    out: z.object({ items: z.array(CreditPackage) }).strict(),
    err: ["forbidden"] as const,
  },

  /** UC-BC-3：创建充值订单（无金额入参——金额/额度一律取服务端套餐快照）。 */
  createPaymentOrder: {
    method: "POST",
    path: "/billing/orders",
    in: z
      .object({
        ownerType: BillingOwnerType,
        ownerId: z.string().min(1).optional(), // user 主体缺省=本人；team 主体必填
        packageId: z.string().min(1),
        provider: BillingProvider,
      })
      .strict(),
    out: z.object({ order: BillingOrder }).strict(),
    err: [
      "payment_provider_not_configured",
      "forbidden",
      "org_billing_disabled",
      "package_not_found",
      "package_disabled",
      "wechat_upstream_failed",
    ] as const,
  },

  /** UC-BC-4：订单状态查询（前端 3s 轮询用；纯读，不驱动状态变化）。 */
  getPaymentOrder: {
    method: "GET",
    path: "/billing/orders/:orderNo",
    in: z.object({ orderNo: OrderNo }).strict(),
    out: z.object({ order: BillingOrder }).strict(),
    err: ["order_not_found"] as const,
  },

  /** UC-BC-5：钱包（无记录返回全零空钱包，不 404）。 */
  getWallet: {
    method: "GET",
    path: "/billing/wallet",
    in: z
      .object({
        ownerType: BillingOwnerType,
        ownerId: z.string().min(1).optional(),
      })
      .strict(),
    out: z.object({ wallet: CreditWallet }).strict(),
    err: ["forbidden"] as const,
  },

  /** UC-BC-6：流水（游标分页；空列表合法）。 */
  listTransactions: {
    method: "GET",
    path: "/billing/transactions",
    in: z
      .object({
        ownerType: BillingOwnerType,
        ownerId: z.string().min(1).optional(),
        type: BillingTransactionType.optional(),
        limit: z.number().int().positive().max(100).optional(),
        cursor: z.string().optional(),
      })
      .strict(),
    out: z
      .object({
        items: z.array(CreditTransaction),
        nextCursor: z.string().nullable(),
      })
      .strict(),
    err: ["forbidden"] as const,
  },

  /**
   * UC-BC-7：微信支付回调（**raw body**，不进通用 JSON 解析管道——参考 main.ts 的 raw 先例）。
   * `in` 只为 shape 声明：原始报文 + 验签头；拒绝路径同样以 `out.code = FAIL` 表达（不额外抛 HTTP 错误码）。
   */
  wechatNotify: {
    method: "POST",
    path: "/billing/webhooks/wechat",
    in: z
      .object({
        rawBody: z.string(),
        headers: z.record(z.string(), z.string()),
      })
      .strict(),
    out: WechatNotifyAck,
    err: [] as const,
  },

  /** UC-BC-8：mock 完成订单（生产环境恒 mock_forbidden；走与回调相同的抢占+入账内核）。 */
  mockCompletePaymentOrder: {
    method: "POST",
    path: "/billing/orders/:orderNo/mock-paid",
    in: z.object({ orderNo: OrderNo }).strict(),
    out: z.object({ order: BillingOrder }).strict(),
    err: ["mock_forbidden", "order_not_found", "order_not_pending"] as const,
  },

  /** UC-BC-9：管理端查钱包（不存在返回 owner_not_found，不返回空壳）。 */
  adminGetWallet: {
    method: "GET",
    path: "/billing/admin/wallets/:ownerType/:ownerId",
    in: z
      .object({
        ownerType: BillingOwnerType,
        ownerId: z.string().min(1),
      })
      .strict(),
    out: z.object({ wallet: CreditWallet }).strict(),
    err: ["forbidden", "owner_not_found"] as const,
  },

  /** UC-BC-10：管理端发放额度（原因必填；同事务写钱包+grant 流水，I-8）。 */
  adminGrantCredits: {
    method: "POST",
    path: "/billing/admin/credits/grant",
    in: z
      .object({
        ownerType: BillingOwnerType,
        ownerId: z.string().min(1),
        credits: CreditsAmount,
        reason: z.string().min(1),
      })
      .strict(),
    out: z.object({ transaction: CreditTransaction, wallet: CreditWallet }).strict(),
    err: ["forbidden", "owner_not_found", "invalid_amount", "reason_required"] as const,
  },

  /** UC-BC-11：读组织计费设置（owner/admin 或平台管理员）。 */
  getOrgBillingSetting: {
    method: "GET",
    path: "/billing/org-settings/:orgId",
    in: z.object({ orgId: z.string().min(1) }).strict(),
    out: z.object({ setting: OrgBillingSetting }).strict(),
    err: ["forbidden", "owner_not_found"] as const,
  },

  /** UC-BC-12：改组织计费设置（只影响后续 createPaymentOrder，I-12）。 */
  updateOrgBillingSetting: {
    method: "PATCH",
    path: "/billing/org-settings/:orgId",
    in: z.object({ orgId: z.string().min(1), creditEnabled: z.boolean() }).strict(),
    out: z.object({ setting: OrgBillingSetting }).strict(),
    err: ["forbidden", "owner_not_found"] as const,
  },
} as const;

export type BillingCreditsOperations = typeof operations;
