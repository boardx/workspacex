import type { TenantSession } from "../../application/ports/database.port";
import { BillingOrderError } from "../../application/billing/billing-order-service";
import { SubscriptionError } from "../../application/billing/billing-subscription-service";
import { pricingEpochMode } from "./personal-pricing-epoch";

/** Called before upstream creation and again inside each legacy financial transaction.
 * Reset additionally freezes sales and drains old processes before taking the exclusive epoch lock.
 */
export async function requireLegacyOrderEpoch(session: TenantSession): Promise<void> {
  try { if (await pricingEpochMode(session) === "legacy") return; } catch { /* unknown epochs also close old sales */ }
  throw new BillingOrderError("payment_provider_not_configured");
}
export async function requireLegacySubscriptionEpoch(session: TenantSession): Promise<void> {
  try { if (await pricingEpochMode(session) === "legacy") return; } catch { /* unknown epochs cannot restore old rights */ }
  throw new SubscriptionError("dependency_unavailable");
}
