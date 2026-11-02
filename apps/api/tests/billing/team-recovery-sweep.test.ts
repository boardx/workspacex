import {expect,it,vi} from "vitest";
import {PgTeamRecoverySweep} from "../../src/infrastructure/billing/pg-team-recovery-sweep";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
it("isolates an unavailable organization while advancing bounded recovery to another",async()=>{
 const seen:string[]=[];
 const db={withoutTenant:async(fn:Function)=>fn({query:async(sql:string,params?:unknown[])=>({rows:sql.includes("billing_pricing_epoch")?[{generation,active:true}]:sql.includes("billing_team_due_orgs")?(params?.[1]===null?[{org_id:"org-a"},{org_id:"org-b"}]:[]):[]})}),withTenant:async(org:string,fn:Function)=>{seen.push(org);if(org==="org-a")throw Error("unavailable");return fn({query:async(sql:string)=>({rows:sql.includes("FROM organizations WHERE")?[{id:org}]:sql.includes("billing_pricing_epoch")?[{generation,active:true}]:[]})});}};
 const reconciler={reconcile:vi.fn()};
 expect(await new PgTeamRecoverySweep(db as never,reconciler).sweep()).toEqual({processed:1,failed:1});
 expect(seen).toEqual(["org-a","org-b"]);
});
it("a failed purchase does not starve another owned pending recharge",async()=>{
 const db={withoutTenant:async(fn:Function)=>fn({query:async(sql:string,params?:unknown[])=>({rows:sql.includes("billing_pricing_epoch")?[{generation,active:true}]:sql.includes("billing_team_due_orgs")?(params?.[1]===null?[{org_id:"org-b"}]:[]):[]})}),withTenant:async(org:string,fn:Function)=>fn({query:async(sql:string)=>({rows:sql.includes("FROM organizations WHERE")?[{id:org}]:sql.includes("billing_pricing_epoch")?[{generation,active:true}]:sql.startsWith("SELECT purchase_ref FROM")?[{purchase_ref:"first-failed"},{purchase_ref:"second-owned"}]:[]})})};
 const reconcile=vi.fn().mockRejectedValueOnce(Error("provider unavailable")).mockResolvedValue(undefined);
 expect(await new PgTeamRecoverySweep(db as never,{reconcile}).sweep()).toEqual({processed:1,failed:1});
 expect(reconcile.mock.calls).toEqual([["org-b","first-failed"],["org-b","second-owned"]]);
});
it("resumes after a bounded page budget and wraps so permanently due owners cannot starve later cash",async()=>{
 const owners=Array.from({length:101},(_,i)=>`org-${String(i).padStart(3,"0")}`),last=owners[100];
 if(!last)throw Error("last fixture owner missing");
 const db={withoutTenant:async(fn:Function)=>fn({query:async(sql:string,params?:unknown[])=>({rows:sql.includes("billing_pricing_epoch")?[{generation,active:true}]:sql.includes("billing_team_due_orgs")?owners.filter(org=>params?.[1]===null||org>String(params?.[1])).slice(0,20).map(org_id=>({org_id})):[]})}),withTenant:async(org:string,fn:Function)=>fn({query:async(sql:string)=>({rows:sql.includes("FROM organizations WHERE")?[{id:org,writable:org===last}]:sql.includes("billing_pricing_epoch")?[{generation,active:true}]:sql.startsWith("SELECT purchase_ref FROM")&&org===last?[{purchase_ref:"later-real-cash"}]:[]})})};
 const reconcile=vi.fn().mockResolvedValue(undefined),sweep=new PgTeamRecoverySweep(db as never,{reconcile});
 expect(await sweep.sweep()).toEqual({processed:100,failed:0});expect(reconcile).not.toHaveBeenCalled();
 expect(await sweep.sweep()).toEqual({processed:1,failed:0});expect(reconcile.mock.calls).toEqual([[last,"later-real-cash"]]);
 expect(await sweep.sweep()).toEqual({processed:100,failed:0});
 expect(await sweep.sweep()).toEqual({processed:1,failed:0});expect(reconcile).toHaveBeenCalledTimes(2);
});
