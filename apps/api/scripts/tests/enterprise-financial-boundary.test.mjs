import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {test} from "node:test";
import assert from "node:assert/strict";
import {ENTERPRISE_FINANCIAL_PATHS,checkEnterpriseFinancialBoundary} from "../lib/enterprise-financial-boundary.mjs";
const api=fileURLToPath(new URL("../..",import.meta.url));
const read=path=>readFileSync(resolve(api,path),"utf8");
const grant="src/infrastructure/billing/enterprise-credit-grant.ts";
const controller="src/interface/controllers/enterprise-management.controller.ts";
const consumerPaths=[...ENTERPRISE_FINANCIAL_PATHS,"src/enterprise-management.wiring.ts",controller,"src/infrastructure/billing/enterprise-summary.ts"];
const consumers=consumerPaths.map(path=>({path,source:read(path)}));
const check=(path,source=read(path),sources=consumers)=>checkEnterpriseFinancialBoundary(path,source,sources);
test("accepts only the reviewed internal financial composition",()=>{for(const path of ENTERPRISE_FINANCIAL_PATHS)assert.deepEqual(check(path),[]);});
for(const [name,from,to] of [
 ["cross-organization SQL binding","[orgId,input.idempotencyKey]","[otherOrg,input.idempotencyKey]"],
 ["actor mismatch removed","prior.actor_id !== actorId","false"],
 ["idempotency key substituted","[orgId,input.idempotencyKey]","[orgId,actorId]"],
 ["raw financial row disclosed","return receipt;","return wallet;"],
 ["content SQL added","SELECT plan,billing_generation FROM organization_plans WHERE org_id=$1 FOR UPDATE","SELECT title FROM projects WHERE org_id=$1 FOR UPDATE"],
])test(`rejects ${name}`,()=>{const source=read(grant);assert(source.includes(from));assert(check(grant,source.replace(from,to)).length>0);});
test("does not exempt a new controller/content path",()=>{assert(check("src/interface/controllers/ordinary.controller.ts",read(grant)).length>0);});
test("rejects a controller consuming an internal financial class",()=>{assert(check(grant,read(grant),[...consumers,{path:"src/interface/controllers/ordinary.controller.ts",source:'import {EnterpriseCreditGrant} from "../../infrastructure/billing/enterprise-credit-grant";'}]).length>0);});
test("rejects removal of the actual platform guard",()=>{assert(check(grant,read(grant),consumers.map(c=>c.path===controller?{...c,source:c.source.replace("@UseGuards(PlatformOperatorGuard)","")}:c)).length>0);});
test("rejects request actor replacing the authenticated principal",()=>{assert(check(grant,read(grant),consumers.map(c=>c.path===controller?{...c,source:c.source.replaceAll("principal.userId","input.actorId")}:c)).length>0);});

test("rejects a second controller consuming the financial service token",()=>{assert(check(grant,read(grant),[...consumers,{path:"src/interface/controllers/ordinary.controller.ts",source:'import {ENTERPRISE_MANAGEMENT} from "../../application/billing/enterprise-ports";'}]).length>0);});
test("rejects request-body principal replacing CurrentPrincipal",()=>{assert(check(grant,read(grant),consumers.map(c=>c.path===controller?{...c,source:c.source.replaceAll("@CurrentPrincipal()","@Body()")} :c)).length>0);});
