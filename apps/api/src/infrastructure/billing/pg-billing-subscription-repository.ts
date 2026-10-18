import type { LoggerPort } from "../../application/ports/logger.port";
import { createHash, randomBytes } from "node:crypto";
import { SubscriptionStatus, subscriptionEligibility } from "@repo/contracts/billing-subscription";
import { assertPrincipal, type Principal } from "../../domain/principal";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { SubscriptionError, type SubscriptionRepository, type SubscriptionSnapshot } from "../../application/billing/billing-subscription-service";
type Row = { status: string; plan_ref: string | null; current_period_end: Date | null; cancel_at_period_end: boolean;
  customer_ref: string | null; subscription_ref: string; binding_generation: string; synchronization_uncertain: boolean };
async function snapshot(session: TenantSession, userId: string): Promise<SubscriptionSnapshot | null> {
  const row = (await session.query<Row>(`SELECT status,plan_ref,current_period_end,cancel_at_period_end,customer_ref,subscription_ref,binding_generation,synchronization_uncertain
    FROM billing_subscriptions WHERE user_id=$1`, [userId])).rows[0];
  if (!row) return null;
  const status = SubscriptionStatus.safeParse(row.status);
  if (!status.success || status.data === "none") throw new SubscriptionError("dependency_unavailable");
  return { status: status.data, planRef: row.plan_ref, currentPeriodEnd: row.current_period_end?.toISOString() ?? null, cancelAtPeriodEnd: row.cancel_at_period_end,
    customerRef: row.customer_ref, subscriptionRef: row.subscription_ref, generation: row.binding_generation, synchronizationUncertain: row.synchronization_uncertain };
}
export class PgBillingSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly db: DatabasePort, private readonly logger: LoggerPort) {}
  private async infrastructure<T>(stage: "read" | "create_intent", traceId: string, run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (error) {
      if (error instanceof SubscriptionError) throw error;
      try { this.logger.error("billing_subscription_store_failed", { traceId, err: { stage, reason: "database_failure" } }); } catch { /* diagnostics must not replace the original failure */ }
      throw new SubscriptionError("dependency_unavailable");
    }
  }
  read(principal: Principal, traceId = "no-trace") {
    assertPrincipal(principal);
    return this.infrastructure("read", traceId, () => this.db.withTenant(principal.orgId, session => snapshot(session, principal.userId)));
  }
  createIntent(principal: Principal, traceId = "no-trace"): Promise<string> {
    assertPrincipal(principal);
    return this.infrastructure("create_intent", traceId, () => this.db.withTenant(principal.orgId, async session => {
      // F09 must acquire this same user-level lock before replacing the current binding.
      await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`billing-subscription:${principal.userId}`]);
      const current = await snapshot(session, principal.userId);
      if (current?.synchronizationUncertain) throw new SubscriptionError("dependency_unavailable");
      if (!subscriptionEligibility(current?.status ?? "none").canCreateSubscription) throw new SubscriptionError("already_subscribed");
      const token = randomBytes(32).toString("base64url");
      await session.query(`INSERT INTO billing_purchase_intents(intent_hash,user_id,expected_generation) VALUES($1,$2,$3)`,
        [createHash("sha256").update(token).digest("hex"), principal.userId, current?.generation ?? "0"]);
      return token;
    }));
  }
}
