import {expect,it} from "vitest";
import {TeamAccountService} from "../../src/application/billing/team-account-service";
import {TeamBillingError} from "../../src/application/billing/team-billing-error";
import {TeamBillingHttpException} from "../../src/interface/controllers/team-billing-http-exception";
it("converts unknown provider/database details into a typed unavailable code before interface",async()=>{
 const service=new TeamAccountService({catalog:async()=>{throw Error("SELECT hidden_table database detail");}} as never,{} as never,{} as never,{} as never,{} as never);
 const error=await service.catalog({userId:"admin",orgId:"org-a"} as never,"org-a").catch(e=>e);
 expect(error).toBeInstanceOf(TeamBillingError);expect(error.code).toBe("dependency_unavailable");
 expect(new TeamBillingHttpException(error.code,503).getResponse()).toEqual({code:"dependency_unavailable"});
});
it("preserves only declared business codes and rejects arbitrary typed-code construction",async()=>{
 const service=new TeamAccountService({} as never,{} as never,{} as never,{checkout:async()=>{throw Error("quote_expired");}} as never,{} as never);
 const error=await service.checkout({userId:"admin",orgId:"org-a"} as never,"org-a",{}).catch(e=>e);
 expect(error).toBeInstanceOf(TeamBillingError);expect(error.code).toBe("quote_expired");
 expect(()=>new TeamBillingError("SELECT hidden_table" as never)).toThrow();
});
