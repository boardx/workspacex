import {expect,it} from "vitest";
import {PgTeamAccountRepository} from "../../src/infrastructure/billing/pg-team-account-repository";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
function repository(market:"cn"|"us"|null){
 const requested:unknown[]=[];
 const row={package_id:"configured-team",region:market??"cn",currency:market==="us"?"USD":"CNY",amount_fen:14900,total_credits:100000,owner_type:"team",product_kind:"subscription",billing_cycle:"month",included_seats:5,extra_seat_amount_fen:2500,extra_seat_monthly_credits:15000,sort_order:0};
 const db={withTenant:async(_org:string,fn:Function)=>fn({query:async(sql:string,params?:unknown[])=>{if(sql.includes("credit_packages")){requested.push(params?.[0]);return {rows:[row]};}return {rows:sql.includes("billing_pricing_epoch")?[{generation,active:true}]:[]};}})};
 return {repo:new PgTeamAccountRepository(db as never,{authorize:async()=>"org-a"} as never,()=>true,()=>market),requested};
}
it("reads actual USD deployment configuration and keeps unsupported Team sale closed",async()=>{
 const f=repository("us"),catalog=await f.repo.catalog({userId:"admin",orgId:"org-a"} as never,"org-a");
 expect(f.requested).toEqual(["us"]);expect(catalog).toMatchObject({market:"us",enabledProviders:[],products:[{currency:"USD",amountMinor:14900}]});
});
it("never invents a CN market when deployment market is unavailable",async()=>{
 const f=repository(null);await expect(f.repo.catalog({userId:"admin",orgId:"org-a"} as never,"org-a")).rejects.toThrow("dependency_unavailable");expect(f.requested).toEqual([]);
});
