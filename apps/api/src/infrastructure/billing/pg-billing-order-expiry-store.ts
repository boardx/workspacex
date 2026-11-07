import type { BillingOrderExpiryStore } from "../../application/billing/billing-order-expiry.port";
import type { DatabasePort } from "../../application/ports/database.port";
import { assertBillingGlobalStatement, BILLING_GLOBAL_SQL } from "./billing-global-boundary";

/** Expiry owns no payment or wallet writes; callbacks arbitrate on the same order lock. */
export class PgBillingOrderExpiryStore implements BillingOrderExpiryStore {
  constructor(private readonly db: DatabasePort) {}
  closeExpired(): Promise<number> {
    return this.db.withoutTenant(async session => {
      await session.query("SET LOCAL statement_timeout = '2000ms'");
      await session.query("SET LOCAL lock_timeout = '750ms'");
      const statement = BILLING_GLOBAL_SQL.closeExpiredOrders;
      assertBillingGlobalStatement(statement);
      return (await session.query<{ order_no: string }>(statement)).rows.length;
    });
  }
}
