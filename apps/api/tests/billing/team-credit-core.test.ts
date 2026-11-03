import {expect,it} from "vitest";
import {grantPaidSubscriptionPeriod} from "../../src/infrastructure/billing/pg-credit-periods";
import {CREDIT_PERIOD_GRANT_SQL as SQL} from "../../src/infrastructure/billing/credit-period-sql";
it.each(["team","user"] as const)("shares period ledger precision while selecting only the %s owner wallet",async ownerType=>{
 const calls:{sql:string;params:readonly unknown[]|undefined}[]=[];
 const session={async query(sql:string,params?:readonly unknown[]){calls.push({sql,params});if(sql.includes("FOR UPDATE")&&sql.includes("SELECT wallet_id"))return {rows:[{wallet_id:"wallet"}]};if(sql===SQL.periodWalletState)return {rows:[{balance:"-0.01",total_granted:"0"}]};if(sql===SQL.periodInsert)return {rows:[{period_id:"period"}]};return {rows:[]};}};
 await grantPaidSubscriptionPeriod(session as never,{ownerType,userId:"owner",subscriptionRef:"subscription",invoiceRef:"invoice",planRef:"sku",credits:100000,periodStart:new Date("2026-01-01"),periodEnd:new Date("2026-02-01")} as never,new Date("2026-01-02"));
 const ensured=calls.find(c=>c.sql===(ownerType==="team"?SQL.periodEnsureTeamWallet:SQL.periodEnsureUserWallet));if(!ensured)throw Error("shared grant did not ensure owner wallet");
 expect(ensured.sql).toContain(`VALUES('${ownerType}'`);
 expect(calls.find(c=>c.sql===SQL.periodGrantWallet)?.params).toEqual(["wallet","99999.99",100000]);
 expect(calls.find(c=>c.sql===SQL.periodGrantLedger)?.params).toEqual(["wallet","100000.00","99999.99","period"]);
});
