import type { TenantSession } from "../../application/ports/database.port";
import { PersonalCheckoutError } from "../../application/billing/personal-checkout-error";
import { BILLING_ACCOUNTING_GENERATION, BILLING_PRICING_EPOCH_LOCK } from "../../domain/billing/billing-generation";
import { PERSONAL_CHECKOUT_SQL as SQL } from "./personal-checkout-sql";

/** The final reset takes the exclusive counterpart before deleting accounting data. */
export async function pricingEpochMode(session: TenantSession): Promise<"legacy" | "active"> {
  await session.query(SQL.pricingEpochLock, [BILLING_PRICING_EPOCH_LOCK]);
  const epoch = (await session.query<{ generation: string | null; active: boolean | null }>(SQL.pricingEpoch)).rows[0];
  if (epoch?.generation === null && epoch.active === null) return "legacy";
  if (epoch?.generation === BILLING_ACCOUNTING_GENERATION && epoch.active === true) return "active";
  throw new PersonalCheckoutError("dependency_unavailable");
}
export async function requireActivePricingEpoch(session: TenantSession): Promise<void> {
  if (await pricingEpochMode(session) !== "active") throw new PersonalCheckoutError("dependency_unavailable");
}
