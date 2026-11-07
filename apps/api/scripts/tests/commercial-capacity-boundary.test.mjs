import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkCommercialCapacity} from "../lib/commercial-capacity-boundary.mjs";
const source=readFileSync(new URL("../../src/infrastructure/org-capacity/pg-commercial-capacity.ts",import.meta.url),"utf8");
test("actual admission helper exposes only bounded decision metadata",()=>assert.deepEqual(checkCommercialCapacity(source),[]));
for(const [name,before,after] of [
 ["raw license disclosure","return resolveCommercialCapacity(BILLING_ACCOUNTING_GENERATION,","return license;\n  resolveCommercialCapacity(BILLING_ACCOUNTING_GENERATION,"],
 ["unscoped plan read","FROM organization_plans WHERE org_id=$1","FROM organization_plans"],
 ["wrong tenant binding","[orgId])).rows[0]","[otherOrg])).rows[0]"],
 ["extra tenant content","SELECT count(*)::text AS n FROM org_memberships","SELECT * FROM artifacts"],
 ["raw pending-close row","return pending.rows.length > 0","return pending.rows[0]"],
 ["diagnostic row leak","const plan =","console.log(license); const plan ="],
 ["extra export","export async function lockCapacityEpoch","export const disclose = () => rows;\nexport async function lockCapacityEpoch"],
])test(`counterexample refuses ${name}`,()=>{assert.ok(source.includes(before));assert.ok(checkCommercialCapacity(source.replace(before,after)).length>0);});
for(const path of ["src/interface/controllers/leak.ts","src/application/leak.ts"])test(`refuses direct ${path} exposure`,()=>assert.ok(checkCommercialCapacity(source,[{path,source:'import {readCommercialCapacity} from "../org-capacity/pg-commercial-capacity";'}]).length>0));
test("refuses infrastructure re-export as a public barrel",()=>assert.ok(checkCommercialCapacity(source,[{path:"src/infrastructure/barrel.ts",source:'export * from "./org-capacity/pg-commercial-capacity";'}]).length>0));
test("permits internal mutation admission consumer",()=>assert.deepEqual(checkCommercialCapacity(source,[{path:"src/infrastructure/auth/pg-org-invite-repository.ts",source:'import {commercialSeatAvailable} from "../org-capacity/pg-commercial-capacity";'}]),[]));
