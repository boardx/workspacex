import { randomBytes, sign } from "node:crypto";
import { z } from "zod";
import { OrderNo } from "@repo/contracts/billing-credits";
import type { PersonalPurchase } from "../../domain/billing/personal-purchase";
import { BILLING_ACCOUNTING_GENERATION } from "../../domain/billing/billing-generation";
import type { LoggerPort } from "../../application/ports/logger.port";
import type { PersonalCheckoutBinding } from "../../application/billing/personal-checkout-ports";
import type { DeploymentBillingConfig } from "./deployment-billing-config";
import { boundedBody, WechatNativeClient } from "./wechat-native-client";
import { verifyWechatSignature } from "./wechat-signature";

export type PersonalWechatPaymentState = { state: "pending" | "closed" } | { state: "paid"; paymentRef: string; paidAt: Date };
const paymentTime = z.string().datetime({ offset: true });
export class PersonalWechatPaymentClient {
  private readonly native: WechatNativeClient;
  constructor(private readonly config: DeploymentBillingConfig, logger: LoggerPort) { this.native = new WechatNativeClient(config, logger); }
  enabled() { return this.config.getPublicConfig().enabledProviders.includes("wechat") && !!this.config.getWechat(); }
  private assertPurchase(purchase: PersonalPurchase) {
    OrderNo.parse(purchase.purchaseRef);
    if (purchase.provider !== "wechat" || purchase.product.currency !== "CNY" || purchase.generation !== BILLING_ACCOUNTING_GENERATION) throw Error("personal_wechat_purchase_invalid");
  }
  async create(purchase: PersonalPurchase): Promise<PersonalCheckoutBinding> {
    this.assertPurchase(purchase);
    const expiresAt = new Date(purchase.createdAt.getTime() + 900000);
    if (expiresAt.getTime() <= Date.now() + 60000) throw Error("personal_wechat_creation_expired");
    const product = purchase.product;
    const description = product.kind === "subscription" ? `WorkspaceX Pro ${product.cycle === "year" ? "年付" : "月付"}（额度按月发放）` : undefined;
    const url = await this.native.createNativeOrder({ orderNo: purchase.purchaseRef, ownerType: "user", ownerId: purchase.userId, createdBy: purchase.userId,
      packageId: product.sku, amountFen: product.amountMinor, currency: product.currency,
      baseCredits: product.kind === "subscription" ? product.monthlyCredits : product.credits, bonusCredits: 0, provider: "wechat", status: "PENDING",
      createdAt: purchase.createdAt.toISOString(), expiredAt: expiresAt.toISOString(), paidAt: null, notifyAt: null, closedAt: null, lastErrorCode: null,
    }, undefined, { description, attachment: `${purchase.generation}:${purchase.purchaseRef}` });
    return { sessionRef: purchase.purchaseRef, url, expiresAt };
  }
  private async query(purchase: PersonalPurchase): Promise<Record<string, unknown>> {
    this.assertPurchase(purchase);
    const config = this.config.getWechat(); if (!config) throw Error("wechat_unavailable");
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(purchase.purchaseRef)}?mchid=${encodeURIComponent(config.mchId)}`;
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(16).toString("hex");
    const signature = sign("RSA-SHA256", Buffer.from(`GET\n${path}\n${timestamp}\n${nonce}\n\n`), config.privateKey).toString("base64");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`https://api.mch.weixin.qq.com${path}`, { redirect: "error", signal: controller.signal,
        headers: { Accept: "application/json", "Accept-Language": "zh-CN", ...(config.platformKeyId ? { "Wechatpay-Serial": config.platformKeyId } : {}),
          Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.mchSerialNo}",signature="${signature}"` } });
      const raw = await boundedBody(response, controller.signal);
      if (config.platformKey && !verifyWechatSignature(config, name => response.headers.get(name), raw)) throw Error("personal_wechat_query_signature_invalid");
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("personal_wechat_query_invalid");
      const data = value as Record<string, unknown>;
      if (response.status === 404 && data.code === "ORDER_NOT_EXIST") return { trade_state: "NOT_CREATED" };
      if (!response.ok || data.appid !== config.appId || data.mchid !== config.mchId || data.out_trade_no !== purchase.purchaseRef) throw Error("personal_wechat_query_mismatch");
      return data;
    } finally { clearTimeout(timer); }
  }
  async read(purchase: PersonalPurchase): Promise<PersonalWechatPaymentState> {
    const result = await this.query(purchase);
    if (result.trade_state === "SUCCESS") {
      const amount = result.amount as Record<string, unknown> | undefined;
      if (amount?.total !== purchase.product.amountMinor || amount.currency !== "CNY" || result.attach !== `${purchase.generation}:${purchase.purchaseRef}` || typeof result.transaction_id !== "string" ||
        !/^[A-Za-z0-9_]{1,128}$/.test(result.transaction_id)) throw Error("personal_wechat_payment_mismatch");
      const paidAt = new Date(paymentTime.parse(result.success_time));
      if (paidAt.getTime() < Math.floor(purchase.createdAt.getTime() / 1000) * 1000) throw Error("personal_wechat_payment_time_invalid");
      return { state: "paid", paymentRef: `wx_${result.transaction_id}`, paidAt };
    }
    if (["CLOSED", "REVOKED", "PAYERROR"].includes(String(result.trade_state))) return { state: "closed" };
    if (["NOTPAY", "USERPAYING", "NOT_CREATED"].includes(String(result.trade_state))) return { state: "pending" };
    throw Error("personal_wechat_state_unavailable");
  }
  async reconcile(purchase: PersonalPurchase): Promise<PersonalWechatPaymentState> {
    const state = await this.read(purchase);
    if (state.state !== "pending" || Date.now() < purchase.createdAt.getTime() + 900000) return state;
    try { await this.native.closeNativeOrder(purchase.purchaseRef); } catch { /* Payment may have won; only the following authoritative read decides. */ }
    return this.read(purchase);
  }
}
