import { SubscriptionHistory, SubscriptionHistoryQuery, subscriptionEligibility, SubscriptionInfo, type SubscriptionStatus, type SubscriptionErrorCode, type SubscriptionCreditGrant } from "@repo/contracts/billing-subscription";
import type {MonthlyPassService} from "./monthly-pass-service";
import { assertPrincipal, type Principal } from "../../domain/principal";
export interface SubscriptionSnapshot {
  status: SubscriptionStatus; planRef: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
  customerRef: string | null; subscriptionRef: string; generation: string; synchronizationUncertain: boolean;
  creditGrant?: SubscriptionCreditGrant;
}
export interface SubscriptionRepository {
  history?(principal: Principal, input: {limit:number;offset:number}): Promise<ReturnType<typeof SubscriptionHistory.parse>>;
  read(principal: Principal, traceId?: string): Promise<SubscriptionSnapshot | null>;
  createIntent(principal: Principal, traceId?: string): Promise<string>;
}
/** Existing private management/history routes read the new accounting epoch without reviving legacy sales. */
export interface PersonalSubscriptionAccess {
  assertLegacy(principal: Principal): Promise<void>;
  history(principal: Principal, input: {limit:number;offset:number}): Promise<ReturnType<typeof SubscriptionHistory.parse> | null>;
  management(principal: Principal): Promise<{ mode: "legacy" } | { mode: "active"; customerRef: string | null }>;
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
  constructor(private readonly repository: SubscriptionRepository, private readonly provider: SubscriptionProvider, private readonly monthly?: MonthlyPassService, private readonly personal?: PersonalSubscriptionAccess) {}
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
    assertPrincipal(principal); await this.personal?.assertLegacy(principal);
    const value = await this.snapshot(principal, traceId);
    const expired = value?.cancelAtPeriodEnd && value.currentPeriodEnd && Date.parse(value.currentPeriodEnd) <= Date.now();
    const legacyNeedsManagement = value && !(expired && ["active","trialing"].includes(value.status)) && subscriptionEligibility(value.status).canManageSubscription;
    const monthly = this.monthly ? await this.monthlyResult(() => this.monthly!.info(principal,!legacyNeedsManagement)) : null;
    if (monthly && !legacyNeedsManagement) return monthly;
    return SubscriptionInfo.parse(value ? { status: expired && ["active", "trialing"].includes(value.status) ? "canceled" : value.status, planRef: value.planRef, currentPeriodEnd: value.currentPeriodEnd, cancelAtPeriodEnd: value.cancelAtPeriodEnd, ...(value.creditGrant?{creditGrant:value.creditGrant}:{}), ...(monthly?.paymentReviewRequired ? {paymentReviewRequired:true} : {}) }
      : { status: "none", planRef: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
  }
  async history(principal:Principal, input:unknown) {
    assertPrincipal(principal);
    const query=SubscriptionHistoryQuery.parse(input);
    const modern = await this.personal?.history(principal,query);
    if (modern) return modern;
    if(!this.repository.history)throw new SubscriptionError("dependency_unavailable");
    return this.monthlyResult(async()=>SubscriptionHistory.parse(await this.repository.history!(principal,query)));
  }
  async upgrade(principal: Principal, traceId = "no-trace",provider:"stripe"|"wechat"="stripe") {
    assertPrincipal(principal); await this.personal?.assertLegacy(principal);
    const value = await this.snapshot(principal, traceId);
    if (this.monthly) return this.monthlyResult(() => this.monthly!.checkout(principal,provider));
    if (!(this.provider.purchaseEnabled?.() ?? this.provider.enabled())) throw new SubscriptionError("payment_provider_not_configured");
    if (!subscriptionEligibility(value?.status ?? "none").canCreateSubscription) throw new SubscriptionError("already_subscribed");
    return { url: this.provider.purchaseLink(await this.repository.createIntent(principal, traceId)) };
  }
  async management(principal: Principal, traceId = "no-trace") {
    assertPrincipal(principal);
    const modern = await this.personal?.management(principal);
    if (modern?.mode === "active") {
      if (!this.provider.enabled()) throw new SubscriptionError("payment_provider_not_configured");
      if (!modern.customerRef) throw new SubscriptionError("not_subscribed");
      return { url: await this.provider.portal(modern.customerRef, traceId) };
    }
    const value = await this.snapshot(principal, traceId);
    if (!this.provider.enabled()) throw new SubscriptionError("payment_provider_not_configured");
    if (!subscriptionEligibility(value?.status ?? "none").canManageSubscription) throw new SubscriptionError("not_subscribed");
    if (!value?.customerRef || !/^cus_[A-Za-z0-9]+$/.test(value.customerRef)) throw new SubscriptionError("dependency_unavailable");
    return { url: await this.provider.portal(value.customerRef, traceId) };
  }
}
