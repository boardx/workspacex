import {expect,it} from "vitest";
import {PgAiAdmissionRepository} from "../../src/infrastructure/auth/pg-ai-admission-repository";
import {BILLING_PRICING_EPOCH_LOCK} from "../../src/domain/billing/billing-generation";
it.each(["policy","reserve"])("takes shared epoch before existing organization/budget locks for %s",async method=>{
 const calls:{sql:string;params?:readonly unknown[]}[]=[];
 const db={withTenant:async(_org:unknown,fn:Function)=>fn({query:async(sql:string,params?:readonly unknown[])=>{calls.push({sql,params});if(sql.includes("FROM organizations"))throw Error("stop-at-organization");return {rows:[]};}})};
 const repository=new PgAiAdmissionRepository(db as never);
 const work=method==="policy"?repository.resolveBudgetPolicy("org-a" as never,"admin"):repository.reserve("org-a" as never,{requestId:"request",userId:"admin",maximumTokens:100n,maximumCostMicros:1n,windowStart:"2026-01-01T00:00:00Z",windowEnd:"2026-02-01T00:00:00Z"} as never);
 await expect(work).rejects.toThrow("stop-at-organization");
 expect(calls[0]).toMatchObject({sql:"SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",params:[BILLING_PRICING_EPOCH_LOCK]});
 expect(calls.at(-1)?.sql).toContain("FOR UPDATE");
});
