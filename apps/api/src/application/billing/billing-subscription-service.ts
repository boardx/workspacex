import { subscriptionEligibility, SubscriptionInfo, type SubscriptionStatus, type SubscriptionErrorCode } from "@repo/contracts/billing-subscription";
import { assertPrincipal, type Principal } from "../../domain/principal";
export interface SubscriptionSnapshot {
  status: SubscriptionStatus; planRef: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
  customerRef: string | null; subscriptionRef: string; generation: string; synchronizationUncertain: boolean;
}
export interface SubscriptionRepository {
  read(principal: Principal, traceId?: string): Promise<SubscriptionSnapshot | null>;
  createIntent(principal: Principal, traceId?: string): Promise<string>;
}
export interface SubscriptionProvider {
  enabled(): boolean;
  purchaseLink(intent: string): string;
  portal(customerRef: string, traceId?: string): Promise<string>;
}
export class SubscriptionError extends Error {
  constructor(readonly code: SubscriptionErrorCode | "dependency_unavailable") { super(code); }
}
export class BillingSubscriptionService {
  constructor(private readonly repository: SubscriptionRepository, private readonly provider: SubscriptionProvider) {}
  private async snapshot(principal: Principal, traceId: string) {
    assertPrincipal(principal);
    const value = await this.repository.read(principal, traceId);
    if (value?.synchronizationUncertain) throw new SubscriptionError("dependency_unavailable");
    return value;
  }
  async info(principal: Principal, traceId = "no-trace") {
    const value = await this.snapshot(principal, traceId);
    return SubscriptionInfo.parse(value ? { status: value.status, planRef: value.planRef, currentPeriodEnd: value.currentPeriodEnd, cancelAtPeriodEnd: value.cancelAtPeriodEnd }
      : { status: "none", planRef: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
  }
  async upgrade(principal: Principal, traceId = "no-trace") {
    const value = await this.snapshot(principal, traceId);
    if (!this.provider.enabled()) throw new SubscriptionError("payment_provider_not_configured");
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
