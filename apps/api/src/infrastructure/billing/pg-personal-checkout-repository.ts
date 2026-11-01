import { randomInt } from "node:crypto";
import { BillingProvider, OrderNo } from "@repo/contracts/billing-credits";
import { PricingProduct, type PersonalCheckoutRequest } from "@repo/contracts/billing-pricing";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { BILLING_ACCOUNTING_GENERATION } from "../../domain/billing/billing-generation";
import { PERSONAL_PRICE_CATALOG_VERSION } from "../../domain/billing/personal-price-catalog";
import type { DatabasePort } from "../../application/ports/database.port";
import type { PersonalCheckoutBinding, PersonalCheckoutRepository, PersonalPurchase, StoredPersonalPurchase } from "../../application/billing/personal-checkout-ports";
import { PersonalCheckoutError, assertSamePersonalPurchase } from "../../application/billing/personal-checkout-error";
import { requireActivePricingEpoch } from "./personal-pricing-epoch";
import { PERSONAL_CHECKOUT_SQL as SQL } from "./personal-checkout-sql";

type Row = { purchase_ref: string; user_id: string; idempotency_key: string; generation: string; catalog_version: string;
  provider: string; product: unknown; created_at: Date; session_ref: string | null; payment_url: string | null;
  expires_at: Date | null; fulfilled_at: Date | null; closed_at: Date | null };
function view(row: Row): StoredPersonalPurchase {
  if (row.generation !== BILLING_ACCOUNTING_GENERATION) throw new PersonalCheckoutError("product_unavailable");
  return { purchaseRef: OrderNo.parse(row.purchase_ref), userId: row.user_id, idempotencyKey: row.idempotency_key,
    generation: row.generation, catalogVersion: row.catalog_version, provider: BillingProvider.parse(row.provider),
    product: PricingProduct.parse(row.product), createdAt: row.created_at, sessionRef: row.session_ref,
    url: row.payment_url, expiresAt: row.expires_at, fulfilledAt: row.fulfilled_at, closedAt: row.closed_at };
}
export class PgPersonalCheckoutRepository implements PersonalCheckoutRepository {
  constructor(private readonly db: DatabasePort) {}
  async find(principal: Principal, key: string) {
    assertPrincipal(principal);
    return this.db.withTenant(principal.orgId, async session => {
      await requireActivePricingEpoch(session);
      const row = (await session.query<Row>(SQL.personalPurchaseByKey, [principal.userId, key])).rows[0];
      return row ? view(row) : null;
    });
  }
  async reserve(principal: Principal, request: PersonalCheckoutRequest, product: PersonalPurchase["product"]) {
    assertPrincipal(principal);
    return this.db.withTenant(principal.orgId, async session => {
      await requireActivePricingEpoch(session);
      await session.query(SQL.personalPurchaseUserLock, [`billing-subscription:${principal.userId}`]);
      const existing = (await session.query<Row>(SQL.personalPurchaseByKey, [principal.userId, request.idempotencyKey])).rows[0];
      if (existing) { const purchase = view(existing); assertSamePersonalPurchase(purchase, request); return purchase; }
      if (request.catalogVersion !== PERSONAL_PRICE_CATALOG_VERSION) throw new PersonalCheckoutError("catalog_changed");
      const quote = PricingProduct.parse(product);
      if (quote.sku !== request.sku || (request.provider === "wechat" && quote.currency !== "CNY")) throw new PersonalCheckoutError("product_unavailable");
      if (quote.kind === "subscription" && ((await session.query(SQL.personalPurchaseActiveTerm, [principal.userId])).rows.length ||
        (await session.query(SQL.personalPurchaseOpenPro, [principal.userId])).rows.length)) throw new PersonalCheckoutError("already_subscribed");
      const now = new Date(), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      const suffix = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
      const reference = `${quote.kind === "subscription" ? "bm" : "bg"}${now.toISOString().replace(/\D/g, "").slice(0, 14)}${suffix}`;
      const row = (await session.query<Row>(SQL.personalPurchaseInsert, [reference, principal.userId, request.idempotencyKey,
        BILLING_ACCOUNTING_GENERATION, request.catalogVersion, request.provider, JSON.stringify(quote)])).rows[0]!;
      return view(row);
    });
  }
  async bind(principal: Principal, purchaseRef: string, result: PersonalCheckoutBinding) {
    assertPrincipal(principal);
    return this.db.withTenant(principal.orgId, async session => {
      await requireActivePricingEpoch(session);
      const row = (await session.query<Row>(SQL.personalPurchaseOwnerLock, [principal.userId, purchaseRef])).rows[0];
      if (!row) throw new PersonalCheckoutError("product_unavailable");
      if (row.session_ref !== null) {
        if (row.session_ref !== result.sessionRef) throw new PersonalCheckoutError("idempotency_conflict");
        return view(row); // The first successful response remains immutable across retries.
      }
      const bound = (await session.query<Row>(SQL.personalPurchaseBind, [principal.userId, purchaseRef, result.sessionRef, result.url, result.expiresAt])).rows[0]!;
      return view(bound);
    });
  }
}
