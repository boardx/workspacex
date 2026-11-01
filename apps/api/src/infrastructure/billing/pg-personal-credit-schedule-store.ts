import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { LoggerPort } from "../../application/ports/logger.port";
import { PERSONAL_CREDIT_SWEEP_BATCH_SIZE, type PersonalCreditScheduleStore, type PersonalCreditSweep } from "../../application/billing/personal-credit-schedule.port";
import { assertBillingGlobalStatement } from "./billing-global-boundary";
import { PERSONAL_CREDIT_TERM_SQL as SQL } from "./personal-credit-term-sql";
import { CREDIT_PERIOD_GRANT_SQL } from "./credit-period-sql";
import { normalizeCreditPeriods } from "./pg-credit-periods";
import { grantDuePersonalTerms } from "./personal-credit-terms";

/** Only closed billing metadata/accounting statements cross the owner-global scheduler boundary. */
export class PgPersonalCreditScheduleStore implements PersonalCreditScheduleStore {
  constructor(private readonly db: DatabasePort, private readonly logger: LoggerPort) {}
  async reconcileDue(afterOwner: string | null): Promise<PersonalCreditSweep> {
    const owners = await this.db.withoutTenant(async s => {
      assertBillingGlobalStatement(SQL.personalTermDueOwners);
      return (await s.query<{user_id:string}>(SQL.personalTermDueOwners,[afterOwner,PERSONAL_CREDIT_SWEEP_BATCH_SIZE])).rows;
    });
    let processed = 0, failed = 0;
    for(const owner of owners) {
      try {
        await this.db.withoutTenant(raw => {
          const s: TenantSession = { query(sql,params) { assertBillingGlobalStatement(sql); return raw.query(sql,params); } };
          return (async()=>{
            await grantDuePersonalTerms(s,owner.user_id);
            const wallet=(await s.query<{wallet_id:string}>(CREDIT_PERIOD_GRANT_SQL.periodLockUserWallet,[owner.user_id])).rows[0];
            if(wallet)await normalizeCreditPeriods(s,wallet.wallet_id,new Date());
          })();
        });
        processed++;
      } catch(error) {
        failed++;
        this.logger.error("billing_personal_credit_account_failed", { traceId:`personal-credit:${randomUUID()}`,ownerId:owner.user_id,err:error });
      }
    }
    return { processed, failed, nextCursor: owners.length === PERSONAL_CREDIT_SWEEP_BATCH_SIZE ? owners[owners.length-1]!.user_id : null };
  }
}
