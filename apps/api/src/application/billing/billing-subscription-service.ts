import { subscriptionEligibility, SubscriptionInfo, type SubscriptionStatus, type SubscriptionErrorCode, type SubscriptionCreditGrant } from "@repo/contracts/billing-subscription";
import type {MonthlyPassService} from "./monthly-pass-service";
import { assertPrincipal, type Principal } from "../../domain/principal";
export interface SubscriptionSnapshot {
  status: SubscriptionStatus; planRef: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
  customerRef: string | null; subscriptionRef: string; generation: string; synchronizationUncertain: boolean;
  creditGrant?: SubscriptionCreditGrant;
}
export interface SubscriptionRepository {
  read(principal: Principal, traceId?: string): Promise<SubscriptionSnapshot | null>;
  createIntent(principal: Principal, traceId?: string): Promise<string>;
}
export interface SubscriptionProvider {
  enabled(): boolean;
  purchaseEnabled?(): boolean;
  purchaseLink(intent: string): string;
  portal(customerRef: string, traceId?: string): Promise<string>;
}
/** Internal resource bound; HTTP maps this to the generic 429 error, not a subscription enum member. */
export const MAX_ACTIVE_PURCHASE_INTENTS = 20;
export class SubscriptionIntentLimitError extends Error {
  constructor() { super("subscription_intent_rate_limited"); }
}
export class SubscriptionError extends Error {
  constructor(readonly code: SubscriptionErrorCode | "dependency_unavailable") { super(code); }
}
export class BillingSubscriptionService {
  constructor(private readonly repository: SubscriptionRepository, private readonly provider: SubscriptionProvider, private readonly monthly?: MonthlyPassService) {}
  private async snapshot(principal: Principal, traceId: string) {
    assertPrincipal(principal);
    const value = await this.repository.read(principal, traceId);
    if (value?.synchronizationUncertain) throw new SubscriptionError("dependency_unavailable");
    return value;
  }
  private async monthlyResult<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch (error) { if (error instanceof SubscriptionError) throw error; throw new SubscriptionError("dependency_unavailable"); }
  }
  async info(principal: Principal, traceId = "no-trace") {
    const value = await this.snapshot(principal, traceId);
    const monthly = this.monthly ? await this.monthlyResult(() => this.monthly!.info(principal)) : null;
    if (monthly) return monthly;
    const expired = value?.cancelAtPeriodEnd && value.currentPeriodEnd && Date.parse(value.currentPeriodEnd) <= Date.now();
    return SubscriptionInfo.parse(value ? { status: expired && ["active", "trialing"].includes(value.status) ? "canceled" : value.status, planRef: value.planRef, currentPeriodEnd: value.currentPeriodEnd, cancelAtPeriodEnd: value.cancelAtPeriodEnd, ...(value.creditGrant?{creditGrant:value.creditGrant}:{}) }
      : { status: "none", planRef: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
  }
  async upgrade(principal: Principal, traceId = "no-trace") {
    const value = await this.snapshot(principal, traceId);
    if (this.monthly) return this.monthlyResult(() => this.monthly!.checkout(principal));
    if (!(this.provider.purchaseEnabled?.() ?? this.provider.enabled())) throw new SubscriptionError("payment_provider_not_configured");
    if (!subscriptionEligibility(value?.status ?? "none").canCreateSubscription) throw new SubscriptionError("already_subscribed");
    return { url: this.provider.purchaseLink(await this.repository.createIntent(principal, traceId)) };
  }
  async management(principal: Principal, traceId = "no-trace") {
    const value = await this.snapshot(principal, traceId);
    if (!this.provider.enabled()) throw new SubscriptionError("payment_provider_not_configured");
    if (!subscriptionEligibility(value?.status ?? "none").canManageSubscription) throw new SubscriptionError("not_subscribed");
    if (!value?.customerRef || !/^cus_[A-Za-z0-9]+$/.test(value.customerRef)) throw new SubscriptionError("dependency_unavailable");
    return { url: await this.provider.portal(value.customerRef, traceId) };
  }
}
