import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { BillingCreditingStore, VerifiedPaymentReceipt } from "../../application/billing/billing-notify-ports";
import { PaymentNoticeError } from "../../application/billing/billing-notify-ports";
import { BILLING_GLOBAL_SQL as GLOBAL, assertBillingGlobalStatement } from "./billing-global-boundary";
import { PERSONAL_PAYMENT_SQL } from "./personal-payment-sql";
import { personalPurchaseView, type PersonalPurchaseRow } from "./pg-personal-checkout-repository";
import { pricingEpochMode, requireActivePricingEpoch } from "./personal-pricing-epoch";
import type { PgPersonalPaymentRepository } from "./pg-personal-payment-repository";
import type { PersonalWechatPaymentClient } from "./personal-wechat-payment-client";

const completed = { completed: true, manual: false } as const;
function guarded(raw: TenantSession): TenantSession {
  return { query(sql, params) { assertBillingGlobalStatement(sql); return raw.query(sql, params); } };
}
/** New-generation callbacks never fall back to legacy crediting after activation. */
export class PersonalWechatCreditingStore implements BillingCreditingStore {
  constructor(private readonly db: DatabasePort, private readonly client: PersonalWechatPaymentClient,
    private readonly payments: PgPersonalPaymentRepository, private readonly legacy: BillingCreditingStore) {}
  async accept(receipt: VerifiedPaymentReceipt) {
    const selected = await this.db.withoutTenant(async raw => {
      const session = guarded(raw), mode = await pricingEpochMode(session);
      if (mode === "legacy") return { mode, purchase: null };
      const row = (await session.query<PersonalPurchaseRow>(PERSONAL_PAYMENT_SQL.personalPurchaseRef, [receipt.orderNo])).rows[0];
      if (!row) await session.query(GLOBAL.insertEvent, [receipt.providerEventId, receipt.orderNo, "ignored", receipt.signatureVerified]);
      return { mode, purchase: row ? personalPurchaseView(row) : null };
    });
    if (selected.mode === "legacy") return this.legacy.accept(receipt);
    if (!selected.purchase) return completed;
    const purchase = selected.purchase;
    if (purchase.provider !== "wechat" || receipt.tradeState !== "SUCCESS" || receipt.currency !== "CNY" ||
      receipt.amountFen !== purchase.product.amountMinor || !receipt.transactionId || !receipt.paidAt) throw new PaymentNoticeError("order_mismatch", receipt.signatureVerified, receipt.orderNo);
    let state;
    try { state = await this.client.read(purchase); }
    catch (error) {
      if (error instanceof Error && error.message === "personal_wechat_payment_mismatch") throw new PaymentNoticeError("order_mismatch", receipt.signatureVerified, receipt.orderNo);
      throw error;
    }
    if (state.state !== "paid") throw new PaymentNoticeError("provider_unavailable", receipt.signatureVerified, receipt.orderNo);
    if (state.paymentRef !== `wx_${receipt.transactionId}` || state.paidAt.getTime() !== Date.parse(receipt.paidAt)) throw new PaymentNoticeError("order_mismatch", receipt.signatureVerified, receipt.orderNo);
    const result = await this.payments.settle({ purchaseRef: purchase.purchaseRef, provider: "wechat", paymentRef: state.paymentRef,
      amountMinor: receipt.amountFen, currency: receipt.currency, paidAt: state.paidAt });
    // A lost audit/HTTP acknowledgement is retried against the already immutable financial receipt.
    await this.db.withoutTenant(async raw => {
      const session = guarded(raw); await requireActivePricingEpoch(session);
      await session.query(GLOBAL.insertEvent, [receipt.providerEventId, receipt.orderNo, "ok", receipt.signatureVerified]);
    });
    return result;
  }
  private mode() { return this.db.withoutTenant(session => pricingEpochMode(guarded(session))); }
  async processOne(id: string) { return await this.mode() === "legacy" ? this.legacy.processOne(id) : completed; }
  async due() { return await this.mode() === "legacy" ? this.legacy.due() : []; }
  auditRejection(verified: boolean, orderNo: string | null) { return this.legacy.auditRejection(verified, orderNo); }
}
