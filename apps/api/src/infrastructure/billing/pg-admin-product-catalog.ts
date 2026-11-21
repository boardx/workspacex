import { createHash } from "node:crypto";
import { AdminCatalogProduct } from "@repo/contracts/billing-pricing";
import {
  CatalogProductConflict, CatalogProductInvalid, CatalogProductMissing, CatalogWriterUnavailable,
  type AdminProductCatalog, type CatalogMarket, type UpdateCatalogProduct,
} from "../../application/billing/admin-product-catalog";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { personalConfiguredProducts, type ProductConfigurationRow } from "./product-catalog-configuration";
import { teamConfiguredProducts } from "./team-product-configuration";

type Row = ProductConfigurationRow & { base_credits: number; bonus_credits: number; enabled: boolean };
const select = `SELECT package_id, region, currency, amount_fen, total_credits, owner_type, product_kind,
 billing_cycle, included_seats, extra_seat_amount_fen, extra_seat_monthly_credits, sort_order,
 base_credits, bonus_credits, enabled FROM credit_packages
 WHERE region=$1 AND product_kind IN ('subscription','credit_topup')`;

function product(row: Row) {
  return AdminCatalogProduct.parse({
    market: row.region, sku: row.package_id, currency: row.currency, owner: row.owner_type,
    kind: row.product_kind, cycle: row.billing_cycle,
    revision: createHash("sha256").update(JSON.stringify(row)).digest("hex"),
    values: {
      amountMinor: row.amount_fen, baseCredits: row.base_credits, bonusCredits: row.bonus_credits, enabled: row.enabled,
      teamTerms: row.included_seats === null ? null : {
        includedSeats: row.included_seats,
        additionalSeatAmountMinor: row.extra_seat_amount_fen,
        additionalSeatMonthlyCredits: row.extra_seat_monthly_credits,
      },
    },
  });
}

async function find(s: TenantSession, input: UpdateCatalogProduct, lock = false) {
  const row = (await s.query<Row>(select + " AND package_id=$2" + (lock ? " FOR UPDATE" : ""), [input.market, input.sku])).rows[0];
  if (!row) throw new CatalogProductMissing();
  return row;
}

export class PgAdminProductCatalog implements AdminProductCatalog {
  constructor(private readonly reader: DatabasePort, private readonly writer: DatabasePort | null) {}

  list(market: CatalogMarket) {
    return this.reader.withoutTenant(async (s) => {
      const rows = (await s.query<Row>(select + " ORDER BY product_kind DESC, owner_type, sort_order, package_id", [market])).rows;
      return { items: rows.map(product), writable: this.writer !== null };
    });
  }

  update(actorId: string, input: UpdateCatalogProduct) {
    if (!this.writer) throw new CatalogWriterUnavailable();
    return this.writer.withoutTenant(async (s) => {
      const row = await find(s, input, true);
      const before = product(row);
      if (before.revision !== input.expectedRevision) throw new CatalogProductConflict();
      const { amountMinor, baseCredits, bonusCredits, enabled, teamTerms } = input.values;
      if ((row.owner_type === "team" && row.product_kind === "subscription") !== (teamTerms !== null)) {
        throw new CatalogProductInvalid();
      }
      const next = {
        ...row,
        amount_fen: amountMinor, base_credits: baseCredits, bonus_credits: bonusCredits,
        total_credits: baseCredits + bonusCredits, enabled,
        included_seats: teamTerms?.includedSeats ?? null,
        extra_seat_amount_fen: teamTerms?.additionalSeatAmountMinor ?? null,
        extra_seat_monthly_credits: teamTerms?.additionalSeatMonthlyCredits ?? null,
      };
      try {
        personalConfiguredProducts([next]);
        teamConfiguredProducts([next]);
      } catch {
        throw new CatalogProductInvalid();
      }
      await s.query(`UPDATE credit_packages SET amount_fen=$3,base_credits=$4,bonus_credits=$5,
        bonus_rate=round(($5::integer)::numeric/($4::integer)::numeric,4),total_credits=$6,enabled=$7,included_seats=$8,
        extra_seat_amount_fen=$9,extra_seat_monthly_credits=$10 WHERE region=$1 AND package_id=$2`,
      [input.market, input.sku, next.amount_fen, next.base_credits, next.bonus_credits, next.total_credits,
        next.enabled, next.included_seats, next.extra_seat_amount_fen, next.extra_seat_monthly_credits]);
      const after = product(await find(s, input));
      await s.query("INSERT INTO billing_product_catalog_changes(actor_id,market,sku,old_value,new_value) VALUES($1,$2,$3,$4,$5)",
        [actorId, input.market, input.sku, JSON.stringify(before), JSON.stringify(after)]);
      return after;
    });
  }
}
