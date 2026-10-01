/**
 * Phase-21 billing-payment UI 先行原型的 mock 数据（硬规则 ③：纯 mock，不接后端）。
 *
 * ⚠ 只服务 ui-preview 原型，字段形状只是**界面投影**，不是后端契约。
 *    API 契约已定稿：`packages/contracts/src/billing-credits.ts` 与 `billing-subscription.ts`（唯一事实源）。
 *    与契约**同名但字段不同**的类型一律加 `Preview` 后缀区分（ADR-020 单源；
 *    contract-design.md「物化③连带门」第 4 条）；实现期 mock 应从契约生成，不在此手写第二份。
 *    金额一律「分」整数表达，展示层转「元」（需求 00 R9 金额精度约定）。
 */

export type PurchaseSubject = "personal" | "org";

export type OrderStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "CLOSED";

export type OrderStage = "default" | "pending" | "success" | "expired" | "failed";

export type LedgerType = "purchase" | "bonus" | "grant";

export type LedgerSource = "wechat_order" | "admin_manual_grant";

export type SubscriptionVariant = "free" | "active" | "trialing" | "canceled" | "syncing";

export type PreviewRole = "user" | "org-admin" | "platform-admin";

export interface CreditPackagePreview {
  readonly id: string;
  readonly name: string;
  /** 展示价格（元，字符串保留两位） */
  readonly priceLabel: string;
  /** 价格（分，整数） */
  readonly priceFen: number;
  readonly baseCredits: number;
  readonly bonusCredits: number;
  /** 赠送率（0-1，与 bonusCredits 二选一表达赠送，此处两者都落成具体数值展示） */
  readonly bonusRate: number;
  readonly totalCredits: number;
}

export interface WalletSummary {
  readonly balance: number;
  readonly totalAcquired: number;
  readonly purchaseTotal: number;
  readonly bonusTotal: number;
  readonly grantTotal: number;
}

export interface CreditLedgerEntry {
  readonly id: string;
  readonly type: LedgerType;
  readonly direction: "in" | "out";
  readonly credits: number;
  readonly balanceAfter: number;
  readonly source: LedgerSource;
  readonly description: string;
  readonly operatorName?: string;
  readonly reason?: string;
  readonly createdAt: string;
}

export interface PaymentOrder {
  readonly orderNo: string;
  readonly packageId: string;
  readonly amountFen: number;
  readonly baseCredits: number;
  readonly bonusCredits: number;
  readonly status: OrderStatus;
  /** mock 二维码内容——生产由服务端返回微信 code_url，前端本地渲染（需求 01 R3.4） */
  readonly qrCodeUrl: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly paidAt?: string;
  readonly failureReason?: string;
}

export interface SubscriptionSnapshot {
  readonly variant: SubscriptionVariant;
  readonly planLabel: string;
  /** 当前周期 / 试用到期等生效时点（需求 03 E5：UI 必须把生效时点讲清楚） */
  readonly periodEndLabel: string;
  readonly cancelAtPeriodEnd: boolean;
}

/** 七态（硬规则 ⑤）：默认 / 加载 / 空 / 校验失败 / 依赖失败 / 无权限 / 成功 */
export const PREVIEW_STATES = [
  { key: "default", label: "默认" },
  { key: "loading", label: "加载" },
  { key: "empty", label: "空" },
  { key: "invalid", label: "校验失败" },
  { key: "depfail", label: "依赖失败" },
  { key: "denied", label: "无权限" },
  { key: "success", label: "成功" },
] as const;

export type PreviewState = (typeof PREVIEW_STATES)[number]["key"];

export const ORDER_STAGES = [
  { key: "default", label: "未下单" },
  { key: "pending", label: "待支付" },
  { key: "success", label: "支付成功" },
  { key: "expired", label: "已过期" },
  { key: "failed", label: "支付失败" },
] as const;

export const SUBJECTS = [
  { key: "personal", label: "个人" },
  { key: "org", label: "组织" },
] as const;

export const ROLES = [
  { key: "user", label: "普通用户" },
  { key: "org-admin", label: "组织管理员" },
  { key: "platform-admin", label: "平台管理员" },
] as const;

export const SUB_VARIANTS = [
  { key: "free", label: "免费" },
  { key: "active", label: "已订阅" },
  { key: "trialing", label: "试用中" },
  { key: "canceled", label: "已取消" },
  { key: "syncing", label: "同步中" },
] as const;

/** 套餐（金额以服务端为准——前端只是展示这份 mock，不上传任何金额字段，需求 01 R7.1） */
export const CREDIT_PACKAGES: readonly CreditPackagePreview[] = [
  {
    id: "pkg-basic",
    name: "基础包",
    priceLabel: "¥49.00",
    priceFen: 4900,
    baseCredits: 500,
    bonusCredits: 0,
    bonusRate: 0,
    totalCredits: 500,
  },
  {
    id: "pkg-plus",
    name: "进阶包",
    priceLabel: "¥99.00",
    priceFen: 9900,
    baseCredits: 1200,
    bonusCredits: 120,
    bonusRate: 0.1,
    totalCredits: 1320,
  },
  {
    id: "pkg-pro",
    name: "专业包",
    priceLabel: "¥399.00",
    priceFen: 39900,
    baseCredits: 5000,
    bonusCredits: 1000,
    bonusRate: 0.2,
    totalCredits: 6000,
  },
];

export const PERSONAL_WALLET: WalletSummary = {
  balance: 12480,
  totalAcquired: 25600,
  purchaseTotal: 21800,
  bonusTotal: 2600,
  grantTotal: 1200,
};

export const ORG_WALLET: WalletSummary = {
  balance: 86400,
  totalAcquired: 152000,
  purchaseTotal: 132000,
  bonusTotal: 18400,
  grantTotal: 1600,
};

/** 最近流水（数量级贴近真实：>5 行，信息密度可见，硬规则 ③） */
export const PERSONAL_LEDGER: readonly CreditLedgerEntry[] = [
  {
    id: "led-1009",
    type: "bonus",
    direction: "in",
    credits: 120,
    balanceAfter: 12480,
    source: "wechat_order",
    description: "购买「进阶包」赠送额度",
    createdAt: "2026-09-30 14:22:08",
  },
  {
    id: "led-1008",
    type: "purchase",
    direction: "in",
    credits: 1200,
    balanceAfter: 12360,
    source: "wechat_order",
    description: "购买「进阶包」基础额度（订单 WSX20260930140001）",
    createdAt: "2026-09-30 14:22:05",
  },
  {
    id: "led-1007",
    type: "grant",
    direction: "in",
    credits: 400,
    balanceAfter: 11160,
    source: "admin_manual_grant",
    description: "人工发放",
    operatorName: "运营·林晓",
    reason: "回调延迟补偿（订单 WSX20260928113042）",
    createdAt: "2026-09-28 17:05:31",
  },
  {
    id: "led-1006",
    type: "purchase",
    direction: "in",
    credits: 500,
    balanceAfter: 10760,
    source: "wechat_order",
    description: "购买「基础包」基础额度（订单 WSX20260921101508）",
    createdAt: "2026-09-21 10:16:42",
  },
  {
    id: "led-1005",
    type: "bonus",
    direction: "in",
    credits: 1000,
    balanceAfter: 10260,
    source: "wechat_order",
    description: "购买「专业包」赠送额度",
    createdAt: "2026-09-18 09:40:11",
  },
  {
    id: "led-1004",
    type: "purchase",
    direction: "in",
    credits: 5000,
    balanceAfter: 9260,
    source: "wechat_order",
    description: "购买「专业包」基础额度（订单 WSX20260918093852）",
    createdAt: "2026-09-18 09:40:08",
  },
  {
    id: "led-1003",
    type: "purchase",
    direction: "in",
    credits: 500,
    balanceAfter: 4260,
    source: "wechat_order",
    description: "购买「基础包」基础额度（订单 WSX20260905082213）",
    createdAt: "2026-09-05 08:23:01",
  },
  {
    id: "led-1002",
    type: "grant",
    direction: "in",
    credits: 800,
    balanceAfter: 3760,
    source: "admin_manual_grant",
    description: "人工发放",
    operatorName: "运营·周延",
    reason: "新用户体验额度",
    createdAt: "2026-08-30 15:12:47",
  },
  {
    id: "led-1001",
    type: "purchase",
    direction: "in",
    credits: 2960,
    balanceAfter: 2960,
    source: "wechat_order",
    description: "购买「进阶包」基础额度与赠送（订单 WSX20260820104519）",
    createdAt: "2026-08-20 10:46:30",
  },
];

export const ORG_LEDGER: readonly CreditLedgerEntry[] = [
  {
    id: "org-led-1006",
    type: "bonus",
    direction: "in",
    credits: 2000,
    balanceAfter: 86400,
    source: "wechat_order",
    description: "购买「专业包 ×2」赠送额度",
    createdAt: "2026-09-29 11:05:12",
  },
  {
    id: "org-led-1005",
    type: "purchase",
    direction: "in",
    credits: 10000,
    balanceAfter: 84400,
    source: "wechat_order",
    description: "购买「专业包 ×2」基础额度（订单 WSX20260929110437）",
    createdAt: "2026-09-29 11:05:09",
  },
  {
    id: "org-led-1004",
    type: "grant",
    direction: "in",
    credits: 1600,
    balanceAfter: 74400,
    source: "admin_manual_grant",
    description: "人工发放",
    operatorName: "运营·林晓",
    reason: "组织迁移补偿",
    createdAt: "2026-09-15 10:02:56",
  },
  {
    id: "org-led-1003",
    type: "purchase",
    direction: "in",
    credits: 20000,
    balanceAfter: 72800,
    source: "wechat_order",
    description: "购买「专业包 ×4」基础额度（订单 WSX20260902142011）",
    createdAt: "2026-09-02 14:21:33",
  },
  {
    id: "org-led-1002",
    type: "bonus",
    direction: "in",
    credits: 4000,
    balanceAfter: 52800,
    source: "wechat_order",
    description: "购买「专业包 ×4」赠送额度",
    createdAt: "2026-09-02 14:21:30",
  },
  {
    id: "org-led-1001",
    type: "purchase",
    direction: "in",
    credits: 48800,
    balanceAfter: 48800,
    source: "wechat_order",
    description: "组织成立首充（订单 WSX20260812100018）",
    createdAt: "2026-08-12 10:01:02",
  },
];

/** 待支付订单（订单号 mono 展示；二维码内容为 mock，生产由服务端下发） */
export const PENDING_ORDER: PaymentOrder = {
  orderNo: "WSX20261001134258",
  packageId: "pkg-plus",
  amountFen: 9900,
  baseCredits: 1200,
  bonusCredits: 120,
  status: "PENDING",
  qrCodeUrl: "weixin://wxpay/bizpayurl?pr=K3x9QmZ4pL2",
  createdAt: "2026-10-01 13:42:58",
  expiresAt: "2026-10-01 13:57:58",
};

export const SUCCESS_ORDER: PaymentOrder = {
  orderNo: "WSX20261001134258",
  packageId: "pkg-plus",
  amountFen: 9900,
  baseCredits: 1200,
  bonusCredits: 120,
  status: "SUCCESS",
  qrCodeUrl: "weixin://wxpay/bizpayurl?pr=K3x9QmZ4pL2",
  createdAt: "2026-10-01 13:42:58",
  expiresAt: "2026-10-01 13:57:58",
  paidAt: "2026-10-01 13:45:12",
};

export const EXPIRED_ORDER: PaymentOrder = {
  orderNo: "WSX20261001134258",
  packageId: "pkg-plus",
  amountFen: 9900,
  baseCredits: 1200,
  bonusCredits: 120,
  status: "CLOSED",
  qrCodeUrl: "weixin://wxpay/bizpayurl?pr=K3x9QmZ4pL2",
  createdAt: "2026-10-01 13:42:58",
  expiresAt: "2026-10-01 13:57:58",
};

export const FAILED_ORDER: PaymentOrder = {
  orderNo: "WSX20261001134258",
  packageId: "pkg-plus",
  amountFen: 9900,
  baseCredits: 1200,
  bonusCredits: 120,
  status: "FAILED",
  qrCodeUrl: "weixin://wxpay/bizpayurl?pr=K3x9QmZ4pL2",
  createdAt: "2026-10-01 13:42:58",
  expiresAt: "2026-10-01 13:57:58",
  failureReason: "入账处理异常，请稍后重试。若已扣款，平台管理员将按流水人工补发。",
};

export const SUBSCRIPTIONS: Record<SubscriptionVariant, SubscriptionSnapshot> = {
  free: {
    variant: "free",
    planLabel: "免费版",
    periodEndLabel: "-",
    cancelAtPeriodEnd: false,
  },
  active: {
    variant: "active",
    planLabel: "Pro",
    periodEndLabel: "2026-10-31",
    cancelAtPeriodEnd: false,
  },
  trialing: {
    variant: "trialing",
    planLabel: "Pro",
    periodEndLabel: "试用至 2026-10-14",
    cancelAtPeriodEnd: false,
  },
  canceled: {
    variant: "canceled",
    planLabel: "Pro",
    periodEndLabel: "2026-10-31",
    cancelAtPeriodEnd: true,
  },
  syncing: {
    variant: "syncing",
    planLabel: "Pro",
    periodEndLabel: "同步中…",
    cancelAtPeriodEnd: false,
  },
};

/** 展示层：分 → 元（唯一金额换算点；计算与存储用分，展示转元，需求 00 R9） */
export function fenToYuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

export function formatCredits(value: number): string {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

export const LEDGER_TYPE_LABEL: Record<LedgerType, string> = {
  purchase: "充值",
  bonus: "赠送",
  grant: "发放",
};

export const LEDGER_SOURCE_LABEL: Record<LedgerSource, string> = {
  wechat_order: "微信支付订单",
  admin_manual_grant: "平台人工发放",
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "待支付",
  PROCESSING: "处理中",
  SUCCESS: "支付成功",
  FAILED: "支付失败",
  CLOSED: "已关闭",
};
