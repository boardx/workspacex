import type { OrgId } from "../../domain/org-id";
import type { DatabasePort } from "../../application/ports/database.port";
import type { BillingOrderRepository, OrderDraft, OrderView, PackageView } from "../../application/billing/billing-order-service";
import type { BillingOwner } from "../../application/billing/billing-wallet-service";
type PackageRow = { package_id: string; region: string; currency: string; amount_fen: number; base_credits: number; bonus_credits: number; bonus_rate: string; total_credits: number; owner_type: PackageView["ownerType"]; enabled: boolean };
function packageView(row: PackageRow): PackageView {
  const symbol = row.currency === "CNY" ? "¥" : `${row.currency} `;
  return { packageId: row.package_id, region: row.region, currency: row.currency, amountFen: row.amount_fen,
    displayAmount: `${symbol}${Math.floor(row.amount_fen / 100)}.${String(row.amount_fen % 100).padStart(2, "0")}`,
    baseCredits: row.base_credits, bonusCredits: row.bonus_credits, bonusRate: Number(row.bonus_rate), totalCredits: row.total_credits, ownerType: row.owner_type };
}
type OrderRow = { order_no: string; owner_type: OrderView["ownerType"]; owner_id: string; provider: "wechat"; status: OrderView["status"]; package_id: string; amount_fen: number; base_credits: number; bonus_credits: number; currency: string; qr_code_url: string; created_at: Date; expired_at: Date; paid_at: Date | null; notify_at: Date | null; closed_at: Date | null; last_error_code: OrderView["lastErrorCode"] };
function orderView(row: OrderRow): OrderView {
  return { orderNo: row.order_no, ownerType: row.owner_type, ownerId: row.owner_id, provider: row.provider, status: row.status,
    packageId: row.package_id, amountFen: row.amount_fen, baseCredits: row.base_credits, bonusCredits: row.bonus_credits, currency: row.currency, qrCodeUrl: row.qr_code_url,
    createdAt: row.created_at.toISOString(), expiredAt: row.expired_at.toISOString(), paidAt: row.paid_at?.toISOString() ?? null, notifyAt: row.notify_at?.toISOString() ?? null, closedAt: row.closed_at?.toISOString() ?? null, lastErrorCode: row.last_error_code };
}
export class PgBillingOrderRepository implements BillingOrderRepository {
  constructor(private readonly db: DatabasePort) {}
  async packages(owner: BillingOwner) {
    return this.db.withTenant(owner.orgId, async s => (await s.query<PackageRow>("SELECT * FROM credit_packages WHERE enabled=true AND owner_type IN ($1,'both') ORDER BY sort_order,package_id", [owner.ownerType])).rows.map(packageView));
  }
  async package(orgId: OrgId, packageId: string) {
    return this.db.withTenant(orgId, async s => { const row = (await s.query<PackageRow>("SELECT * FROM credit_packages WHERE package_id=$1", [packageId])).rows[0]; return row ? { ...packageView(row), enabled: row.enabled } : null; });
  }
  async creditEnabled(owner: BillingOwner) {
    return this.db.withTenant(owner.orgId, async s => (await s.query<{credit_enabled: boolean}>("SELECT credit_enabled FROM org_billing_settings WHERE org_id=$1", [owner.ownerId])).rows[0]?.credit_enabled ?? true);
  }
  async insert(owner: BillingOwner, order: OrderDraft, qrCodeUrl: string) {
    return this.db.withTenant(owner.orgId, async s => {
      const result = await s.query<OrderRow>(`INSERT INTO billing_orders(order_no,owner_type,owner_id,created_by,package_id,amount_fen,base_credits,bonus_credits,currency,provider,status,qr_code_url,created_at,expired_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'wechat','PENDING',$10,$11,$12) RETURNING *`,
      [order.orderNo,owner.ownerType,owner.ownerId,order.createdBy,order.packageId,order.amountFen,order.baseCredits,order.bonusCredits,order.currency,qrCodeUrl,order.createdAt,order.expiredAt]);
      return orderView(result.rows[0]!);
    });
  }
  async scope(orgId: OrgId, orderNo: string) {
    // Only identity metadata is read before authorization; QR, amount and timestamps require scoped order().
    return this.db.withTenant(orgId, async s => {
      const row = (await s.query<{owner_type: BillingOwner["ownerType"]; owner_id: string}>("SELECT owner_type,owner_id FROM billing_orders WHERE order_no=$1", [orderNo])).rows[0];
      return row ? { ownerType: row.owner_type, ownerId: row.owner_id } : null;
    });
  }
  async order(owner: BillingOwner, orderNo: string) {
    return this.db.withTenant(owner.orgId, async s => {
      const row = (await s.query<OrderRow>("SELECT * FROM billing_orders WHERE order_no=$1 AND owner_type=$2 AND owner_id=$3", [orderNo,owner.ownerType,owner.ownerId])).rows[0];
      return row ? orderView(row) : null;
    });
  }
}
