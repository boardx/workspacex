import {expect,it,vi} from "vitest";
import {assertNoPaidTeam} from "../../src/infrastructure/billing/enterprise-no-paid-team";
import {toOrgId} from "../../src/domain/org-id";
it("only entirely absent canonical license establishes no Team term",async()=>{
 await expect(assertNoPaidTeam({query:vi.fn().mockResolvedValue({rows:[]})},toOrgId("org"))).resolves.toBeUndefined();
 for(const row of [{generation:"billing-credits-2026-11-v1",purchased_seats:null,pending_seats:null,pending_purchase_ref:null},{generation:"unknown",purchased_seats:"5"},{generation:"billing-credits-2026-11-v1",pending_seats:"5",pending_purchase_ref:"pending"}]){
  await expect(assertNoPaidTeam({query:vi.fn().mockResolvedValue({rows:[row]})},toOrgId("org"))).rejects.toMatchObject({code:"dependency_unavailable"});
 }
});
