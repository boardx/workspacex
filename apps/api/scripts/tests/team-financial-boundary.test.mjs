import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {test} from "node:test";
import assert from "node:assert/strict";
import {TEAM_FINANCIAL_BOUNDARIES,checkTeamFinancialBoundary,checkTeamFinancialConsumers} from "../lib/team-financial-boundary.mjs";
const api=fileURLToPath(new URL("../../",import.meta.url)),read=p=>readFileSync(resolve(api,p),"utf8");
test("reviewed Team financial sources remain closed",()=>{for(const path of TEAM_FINANCIAL_BOUNDARIES)assert.deepEqual(checkTeamFinancialBoundary(path,read(path),read),[]);});
test("removing actual target authorization or widening SQL remains red",()=>{
 const path="src/infrastructure/billing/pg-team-quote-repository.ts",body=read(path);
 assert.ok(checkTeamFinancialBoundary(path,body.replace("await this.access.authorize(principal,target)","toOrgId(target)"),read).length);
 assert.ok(checkTeamFinancialBoundary(path,body.replace("WHERE org_id=$1","WHERE true"),read).length);
});
test("dependency permission changes, global access and new consumers remain red",()=>{
 const path="src/infrastructure/billing/pg-team-account-repository.ts";
 assert.ok(checkTeamFinancialBoundary(path,read(path),p=>p.endsWith("team-billing-access.ts")?read(p).replace('membership?.orgRole!=="admin"','false'):read(p)).length);
 assert.ok(checkTeamFinancialBoundary(path,read(path).replace("this.db.withTenant","this.db.withoutTenant"),read).length);
 assert.ok(checkTeamFinancialConsumers([{path:"src/interface/controllers/unreviewed.controller.ts",source:'import {PgTeamCheckoutRepository} from "../../infrastructure/billing/pg-team-checkout-repository";'}]).length);
});
