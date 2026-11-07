import { randomInt, randomUUID } from "node:crypto";
import type { z } from "zod";
import { operations, type BillingErrorCode } from "@repo/contracts/billing-credits";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { toOrgId, type OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { BillingConfigPort } from "./billing-config.port";
import type { BillingOwner } from "./billing-wallet-service";
import { decideOrderOwner } from "../../domain/billing/order-access";
import type { PermissionDecision } from "../../domain/identity/permission-decision";

export type OrderView = z.infer<typeof operations.getPaymentOrder.out>["order"];
export interface PersonalOrderReader {
  read(principal: Principal, orderNo: string): Promise<{mode:"legacy"} | {mode:"active";order:OrderView|null}>;
}
export type PackageView = z.infer<typeof operations.listPackages.out>["items"][number];
export type OrderDraft = Omit<OrderView, "qrCodeUrl" | "expiredAt"> & { readonly createdBy: string; readonly expiredAt: string };
export type BillingOrderOwner = BillingOwner & { readonly decision: PermissionDecision };
export interface BillingOrderRepository {
  assertLegacySales?(orgId: OrgId): Promise<void>;
  packages(owner: BillingOwner): Promise<PackageView[]>;
  package(orgId: OrgId, packageId: string): Promise<(PackageView & { enabled: boolean }) | null>;
  creditEnabled(owner: BillingOrderOwner): Promise<boolean>;
  insert(owner: BillingOwner, order: OrderDraft, qrCodeUrl: string): Promise<OrderView>;
  scope(orgId: OrgId, orderNo: string): Promise<Pick<BillingOwner, "ownerType" | "ownerId"> | null>;
  order(owner: BillingOwner, orderNo: string): Promise<OrderView | null>;
  close(owner: BillingOwner, orderNo: string): Promise<OrderView | null>;
}
export interface WechatNativePort { createNativeOrder(order: OrderDraft, traceId?: string): Promise<string>; closeNativeOrder(orderNo: string, traceId?: string): Promise<void> }
/** Stripe adapter persists the snapshot before contacting the payment provider. */
export interface StripeCreditCheckoutPort {
  create(owner: BillingOwner, order: OrderDraft, traceId?: string): Promise<OrderView>;
  reconcile(owner: BillingOwner, order: OrderView): Promise<OrderView>;
  cancel(owner: BillingOwner, order: OrderView, traceId?: string): Promise<OrderView>;
}
export class BillingOrderError extends Error {
  constructor(readonly code: BillingErrorCode) { super(code); }
}
/** Amounts, identity and order timestamps are server facts, never browser input. */
export class BillingOrderService {
  constructor(
    private readonly repository: BillingOrderRepository,
    private readonly identity: Pick<IdentityRepository, "findOrgMembership">,
    private readonly config: BillingConfigPort,
    private readonly native: WechatNativePort,
    private readonly stripe?: StripeCreditCheckoutPort,
    private readonly personal?: PersonalOrderReader,
  ) {}
  private async owner(principal: Principal, ownerType: "user" | "team", ownerId: string | undefined, admin: boolean): Promise<BillingOrderOwner> {
    assertPrincipal(principal);
    if (ownerType === "user") {
      if (ownerId !== undefined && ownerId !== principal.userId) throw new BillingOrderError("forbidden");
      const decision = decideOrderOwner({ decisionId: randomUUID(), ownerType, ownerId: principal.userId, userId: principal.userId, orgRole: null, teamId: null, requiresAdmin: admin });
      return { ownerType, ownerId: principal.userId, orgId: principal.orgId, decision };
    }
    const target = ownerId ?? principal.orgId;
    let orgId: OrgId;
    try { orgId = toOrgId(target); } catch { throw new BillingOrderError("forbidden"); }
    const membership = await this.identity.findOrgMembership(principal.userId, orgId);
    const decision = decideOrderOwner({ decisionId: randomUUID(), ownerType, ownerId: target, userId: principal.userId, orgRole: membership?.orgRole ?? null, teamId: membership?.teamId ?? null, requiresAdmin: admin });
    if (!decision.allowed) throw new BillingOrderError("forbidden");
    return { ownerType, ownerId: target, orgId, decision };
  }
  async packages(principal: Principal, input: z.infer<typeof operations.listPackages.in>) {
    const query = operations.listPackages.in.parse(input);
    const owner = await this.owner(principal, query.ownerType, undefined, false);
    const market = this.config.getPricingMarket?.();
    if (market !== "cn" && market !== "us") throw new BillingOrderError("payment_provider_not_configured");
    const items = await this.repository.packages(owner);
    return operations.listPackages.out.parse({ items: items.filter(item => item.region === market) });
  }
  async create(principal: Principal, input: z.infer<typeof operations.createPaymentOrder.in>, traceId?: string) {
    assertPrincipal(principal);
    const request = operations.createPaymentOrder.in.parse(input);
    await this.repository.assertLegacySales?.(principal.orgId);
    if (!this.config.getPublicConfig().enabledProviders.includes(request.provider)) throw new BillingOrderError("payment_provider_not_configured");
    const owner = await this.owner(principal, request.ownerType, request.ownerId, true);
    if (owner.ownerType === "team" && !await this.repository.creditEnabled(owner)) throw new BillingOrderError("org_billing_disabled");
    const pkg = await this.repository.package(owner.orgId, request.packageId);
    if (!pkg) throw new BillingOrderError("package_not_found");
    const market = this.config.getPricingMarket?.();
    if (market !== "cn" && market !== "us") throw new BillingOrderError("payment_provider_not_configured");
    const currency = market === "us" ? "USD" : "CNY";
    if (!pkg.enabled || pkg.ownerType !== "both" && pkg.ownerType !== owner.ownerType || pkg.currency !== currency || market && pkg.region !== market || request.provider === "wechat" && pkg.currency !== "CNY" || pkg.amountFen <= 0) throw new BillingOrderError("package_disabled");
    const createdAt = new Date();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const suffix = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
    const order: OrderDraft = {
      orderNo: `bg${createdAt.toISOString().replace(/\D/g, "").slice(0, 14)}${suffix}`,
      ownerType: owner.ownerType, ownerId: owner.ownerId, createdBy: principal.userId,
      provider: request.provider, status: "PENDING", packageId: pkg.packageId,
      amountFen: pkg.amountFen, baseCredits: pkg.baseCredits, bonusCredits: pkg.bonusCredits, currency: pkg.currency,
      createdAt: createdAt.toISOString(), expiredAt: new Date(createdAt.getTime() + 900000).toISOString(),
      paidAt: null, notifyAt: null, closedAt: null, lastErrorCode: null,
    };
    if (request.provider === "stripe") {
      if (!this.stripe) throw new BillingOrderError("payment_provider_not_configured");
      return operations.createPaymentOrder.out.parse({ order: await this.stripe.create(owner, order, traceId) });
    }
    // No database transaction spans the upstream call, and no PENDING row exists without a verified QR.
    const qrCodeUrl = await this.native.createNativeOrder(order, traceId);
    // A failed INSERT is an uncertain intent, not permission to create another upstream order automatically.
    return operations.createPaymentOrder.out.parse({ order: await this.repository.insert(owner, order, qrCodeUrl) });
  }
  async cancel(principal: Principal, input: z.infer<typeof operations.cancelPaymentOrder.in>, traceId?: string) {
    assertPrincipal(principal);
    const { orderNo } = operations.cancelPaymentOrder.in.parse(input);
    const modern = await this.personal?.read(principal, orderNo);
    if (modern?.mode === "active") throw new BillingOrderError(modern.order ? "order_not_cancelable" : "order_not_found");
    const { order } = await this.get(principal, { orderNo });
    if (order.status === "CLOSED" && order.lastErrorCode === null) return operations.cancelPaymentOrder.out.parse({ order });
    if (order.status !== "PENDING") throw new BillingOrderError("order_not_cancelable");
    if (order.provider === "stripe") {
      if (!this.stripe) throw new BillingOrderError("payment_provider_not_configured");
      const owner = await this.owner(principal, order.ownerType, order.ownerId, true);
      return operations.cancelPaymentOrder.out.parse({ order: await this.stripe.cancel(owner, order, traceId) });
    }
    // No DB lock spans the upstream call. A concurrent paid callback wins the CAS below.
    await this.native.closeNativeOrder(orderNo, traceId);
    const owner = await this.owner(principal, order.ownerType, order.ownerId, true);
    const current = await this.repository.close(owner, orderNo);
    if (!current) throw new BillingOrderError("order_not_found");
    return operations.cancelPaymentOrder.out.parse({ order: current });
  }
  async get(principal: Principal, input: z.infer<typeof operations.getPaymentOrder.in>) {
    assertPrincipal(principal);
    const { orderNo } = operations.getPaymentOrder.in.parse(input);
    const modern = await this.personal?.read(principal, orderNo);
    if (modern?.mode === "active") {
      if (!modern.order) throw new BillingOrderError("order_not_found");
      return operations.getPaymentOrder.out.parse({ order: modern.order });
    }
    const scope = await this.repository.scope(principal.orgId, orderNo);
    if (!scope) throw new BillingOrderError("order_not_found");
    let owner: BillingOwner;
    try { owner = await this.owner(principal, scope.ownerType, scope.ownerId, true); }
    catch (error) { if (error instanceof BillingOrderError) throw new BillingOrderError("order_not_found"); throw error; }
    const order = await this.repository.order(owner, orderNo);
    if (!order) throw new BillingOrderError("order_not_found");
    return operations.getPaymentOrder.out.parse({ order: order.provider === "stripe" && this.stripe ? await this.stripe.reconcile(owner, order) : order });
  }
}
