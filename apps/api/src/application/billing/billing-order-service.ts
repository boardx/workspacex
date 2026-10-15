import { randomInt } from "node:crypto";
import type { z } from "zod";
import { operations, type BillingErrorCode } from "@repo/contracts/billing-credits";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { toOrgId, type OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { BillingConfigPort } from "./billing-config.port";
import type { BillingOwner } from "./billing-wallet-service";

export type OrderView = z.infer<typeof operations.getPaymentOrder.out>["order"];
export type PackageView = z.infer<typeof operations.listPackages.out>["items"][number];
export type OrderDraft = Omit<OrderView, "qrCodeUrl"> & { readonly createdBy: string };
export interface BillingOrderRepository {
  packages(owner: BillingOwner): Promise<PackageView[]>;
  package(orgId: OrgId, packageId: string): Promise<(PackageView & { enabled: boolean }) | null>;
  creditEnabled(owner: BillingOwner): Promise<boolean>;
  insert(owner: BillingOwner, order: OrderDraft, qrCodeUrl: string): Promise<OrderView>;
  scope(orgId: OrgId, orderNo: string): Promise<Pick<BillingOwner, "ownerType" | "ownerId"> | null>;
  order(owner: BillingOwner, orderNo: string): Promise<OrderView | null>;
}
export interface WechatNativePort { createNativeOrder(order: OrderDraft): Promise<string> }
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
  ) {}
  private async owner(principal: Principal, ownerType: "user" | "team", ownerId: string | undefined, admin: boolean): Promise<BillingOwner> {
    assertPrincipal(principal);
    if (ownerType === "user") {
      if (ownerId !== undefined && ownerId !== principal.userId) throw new BillingOrderError("forbidden");
      return { ownerType, ownerId: principal.userId, orgId: principal.orgId };
    }
    const target = ownerId ?? principal.orgId;
    let orgId: OrgId;
    try { orgId = toOrgId(target); } catch { throw new BillingOrderError("forbidden"); }
    const membership = await this.identity.findOrgMembership(principal.userId, orgId);
    if (!membership || admin && membership.orgRole !== "admin") throw new BillingOrderError("forbidden");
    return { ownerType, ownerId: target, orgId };
  }
  async packages(principal: Principal, input: z.infer<typeof operations.listPackages.in>) {
    const query = operations.listPackages.in.parse(input);
    const owner = await this.owner(principal, query.ownerType, undefined, false);
    return operations.listPackages.out.parse({ items: await this.repository.packages(owner) });
  }
  async create(principal: Principal, input: z.infer<typeof operations.createPaymentOrder.in>) {
    assertPrincipal(principal);
    const request = operations.createPaymentOrder.in.parse(input);
    if (!this.config.getPublicConfig().enabledProviders.includes("wechat")) throw new BillingOrderError("payment_provider_not_configured");
    const owner = await this.owner(principal, request.ownerType, request.ownerId, true);
    if (owner.ownerType === "team" && !await this.repository.creditEnabled(owner)) throw new BillingOrderError("org_billing_disabled");
    const pkg = await this.repository.package(owner.orgId, request.packageId);
    if (!pkg) throw new BillingOrderError("package_not_found");
    if (!pkg.enabled || pkg.ownerType !== "both" && pkg.ownerType !== owner.ownerType || pkg.currency !== "CNY" || pkg.amountFen <= 0) throw new BillingOrderError("package_disabled");
    const createdAt = new Date();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const suffix = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
    const order: OrderDraft = {
      orderNo: `bg${createdAt.toISOString().replace(/\D/g, "").slice(0, 14)}${suffix}`,
      ownerType: owner.ownerType, ownerId: owner.ownerId, createdBy: principal.userId,
      provider: "wechat", status: "PENDING", packageId: pkg.packageId,
      amountFen: pkg.amountFen, baseCredits: pkg.baseCredits, bonusCredits: pkg.bonusCredits, currency: pkg.currency,
      createdAt: createdAt.toISOString(), expiredAt: new Date(createdAt.getTime() + 900000).toISOString(),
      paidAt: null, notifyAt: null, closedAt: null, lastErrorCode: null,
    };
    // No database transaction spans the upstream call, and no PENDING row exists without a verified QR.
    const qrCodeUrl = await this.native.createNativeOrder(order);
    // A failed INSERT is an uncertain intent, not permission to create another upstream order automatically.
    return operations.createPaymentOrder.out.parse({ order: await this.repository.insert(owner, order, qrCodeUrl) });
  }
  async get(principal: Principal, input: z.infer<typeof operations.getPaymentOrder.in>) {
    assertPrincipal(principal);
    const { orderNo } = operations.getPaymentOrder.in.parse(input);
    const scope = await this.repository.scope(principal.orgId, orderNo);
    if (!scope) throw new BillingOrderError("order_not_found");
    let owner: BillingOwner;
    try { owner = await this.owner(principal, scope.ownerType, scope.ownerId, true); }
    catch (error) { if (error instanceof BillingOrderError) throw new BillingOrderError("order_not_found"); throw error; }
    const order = await this.repository.order(owner, orderNo);
    if (!order) throw new BillingOrderError("order_not_found");
    return operations.getPaymentOrder.out.parse({ order });
  }
}
