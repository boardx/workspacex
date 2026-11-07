import type { TeamCheckoutBinding, TeamPaymentProvider, TeamPaymentSnapshot } from "../../application/billing/team-payment-provider.port";
import type { LoggerPort } from "../../application/ports/logger.port";
import { BILLING_ACCOUNTING_GENERATION } from "../../domain/billing/billing-generation";
import { TEAM_PAYMENT_PRODUCT } from "../../domain/billing/team-payment-product";
import type { DeploymentBillingConfig } from "./deployment-billing-config";
import { WechatNativeClient } from "./wechat-native-client";

/** Creates a payable Native QR from persisted facts; never confirms payment or grants rights. */
export class TeamWechatCheckoutClient implements TeamPaymentProvider {
  readonly provider = "wechat" as const;
  private readonly native: WechatNativeClient;
  constructor(private readonly config: DeploymentBillingConfig, logger: LoggerPort) { this.native = new WechatNativeClient(config, logger); }
  enabled(): boolean { return this.config.getPublicConfig().enabledProviders.includes("wechat") && !!this.config.getWechat(); }
  async createCheckout(purchase: TeamPaymentSnapshot): Promise<TeamCheckoutBinding> {
    if (!this.enabled()) throw Error("team_wechat_unavailable");
    const quote = purchase.quote;
    if (!/^[A-Za-z0-9_|*-]{6,32}$/.test(purchase.purchaseRef) || quote.provider !== this.provider || quote.currency !== "CNY" ||
      quote.generation !== BILLING_ACCOUNTING_GENERATION || !Number.isSafeInteger(quote.amountMinor) || quote.amountMinor <= 0) throw Error("team_wechat_purchase_invalid");
    if (quote.purpose === "add_seats") throw Error("team_wechat_add_seats_unsupported");
    if (quote.renewalMode !== "manual" || ((quote.purpose === "initial" || quote.purpose === "renewal") && quote.billingCycle !== "month" && quote.billingCycle !== "year")) throw Error("team_wechat_purchase_invalid");
    const expiresAt = purchase.checkoutExpiresAt;
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() + 60000) throw Error("team_wechat_creation_expired");
    const attachment = `${TEAM_PAYMENT_PRODUCT}:${quote.generation}:${purchase.purchaseRef}`;
    if (Buffer.byteLength(attachment, "utf8") > 128) throw Error("team_wechat_attachment_invalid");
    const description = quote.purpose === "credit_topup" ? "WorkspaceX Team 额度充值" : `WorkspaceX Team ${quote.billingCycle === "year" ? "年付" : "月付"}（额度按月发放）`;
    const url = await this.native.createNativeCheckout({ orderNo: purchase.purchaseRef, amountFen: quote.amountMinor, currency: quote.currency,
      expiredAt: expiresAt.toISOString(), description, attachment });
    return { sessionRef: purchase.purchaseRef, url, expiresAt };
  }
}
