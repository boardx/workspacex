import type { TenantSession } from "../../application/ports/database.port";
import { resolveCommercialCapacity, type CommercialCapacity } from "../../application/org-capacity/commercial-capacity";
import { BILLING_ACCOUNTING_GENERATION, BILLING_PRICING_EPOCH_LOCK } from "../../domain/billing/billing-generation";
import { requireActivePricingEpoch } from "../billing/personal-pricing-epoch";

/** Every license writer and member admission uses epoch -> org -> plan/license -> wallet. */
export async function lockCapacityEpoch(s: TenantSession): Promise<void> {
  await s.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))", [BILLING_PRICING_EPOCH_LOCK]);
}
export async function lockOrganizationCapacity(s: TenantSession, orgId: string): Promise<void> {
  await lockCapacityEpoch(s);
  const org = await s.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [orgId]);
  if (!org.rows.length) throw new Error("Organization capacity unavailable");
}

/** Call only after lockOrganizationCapacity in the SAME transaction, with tenant set. */
export async function readCommercialCapacity(s: TenantSession, orgId: string): Promise<CommercialCapacity> {
  const plan = (await s.query<{plan:string;billing_generation:string|null}>(
    "SELECT plan,billing_generation FROM organization_plans WHERE org_id=$1",[orgId])).rows[0];
  const license = (await s.query<{generation:string;purchased_seats:string|null;pending_seats:string|null;pending_purchase_ref:string|null}>(
    "SELECT generation,purchased_seats::text,pending_seats::text,pending_purchase_ref FROM org_commercial_licenses WHERE org_id=$1",[orgId])).rows[0];
  // Old metadata alone is not a current paid license. Any explicit generation must validate.
  if (!license && plan?.billing_generation == null) return {kind:"legacy"};
  await requireActivePricingEpoch(s);
  return resolveCommercialCapacity(BILLING_ACCOUNTING_GENERATION,
    plan ? {plan:plan.plan,billingGeneration:plan.billing_generation} : null,
    license ? {generation:license.generation,purchasedSeats:license.purchased_seats,pendingSeats:license.pending_seats,pendingPurchaseRef:license.pending_purchase_ref} : null);
}

/** null = legacy policy; false = no capacity/invalid commercial facts. Invitations never count. */
export async function commercialSeatAvailable(s: TenantSession, orgId: string): Promise<boolean | null> {
  const capacity = await readCommercialCapacity(s,orgId);
  if (capacity.kind === "legacy") return null;
  if (capacity.kind === "invalid") return false;
  if (capacity.kind === "unlimited") return true;
  const members = (await s.query<{n:string}>("SELECT count(*)::text AS n FROM org_memberships WHERE org_id=$1",[orgId])).rows[0];
  return members !== undefined && BigInt(members.n) < capacity.seats;
}

/** Call only after external payment authority has definitively closed this expected intent. */
export async function closePendingCommercialIntent(s: TenantSession, orgId: string, expectedPurchaseRef: string): Promise<boolean> {
  await lockOrganizationCapacity(s, orgId);
  await requireActivePricingEpoch(s);
  const paid = await s.query("UPDATE org_commercial_licenses SET pending_seats=NULL,pending_purchase_ref=NULL,updated_at=now() WHERE org_id=$1 AND generation=$2 AND pending_purchase_ref=$3 AND purchased_seats IS NOT NULL RETURNING org_id", [orgId,BILLING_ACCOUNTING_GENERATION,expectedPurchaseRef]);
  if (paid.rows.length) return true;
  const pending = await s.query("DELETE FROM org_commercial_licenses WHERE org_id=$1 AND generation=$2 AND pending_purchase_ref=$3 AND purchased_seats IS NULL RETURNING org_id",[orgId,BILLING_ACCOUNTING_GENERATION,expectedPurchaseRef]);
  return pending.rows.length > 0;
}
