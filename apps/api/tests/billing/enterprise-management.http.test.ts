// Credential fixture ownership: uniquely scoped users in a disposable wrapper-owned database.
// Epoch fixture ownership: isolated acceptance fixture only, never production activation.
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import type {NestExpressApplication} from "@nestjs/platform-express";
import {TeamBillingRejection,operations as C} from "@repo/contracts/billing-team";
import {auth,platformOrganizations as P} from "@repo/contracts";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {addOrgMember,asOwner,ensureDatabase,migrateOnce,seedOrg} from "../support/db";
import {ensureRedis,seedCredential} from "../support/auth";
const scope=randomUUID().slice(0,8),source=`enterprise-http-source-${scope}`,target=`enterprise-http-target-${scope}`;
const operator=`operator-${scope}`,admin=`admin-${scope}`,password="Enterprise-Acceptance-6108!";
const email=(user:string)=>`${user}@enterprise-http.test`;
let originalEpoch:{generation:string|null;activated_at:string|null}|undefined;
let app:NestExpressApplication,base:string,operatorToken:string,adminToken:string;
beforeAll(async()=>{
 ensureDatabase();ensureRedis();await migrateOnce();originalEpoch=await asOwner(async c=>(await c.query<{generation:string|null;activated_at:string|null}>("SELECT generation,activated_at::text AS activated_at FROM billing_pricing_epoch WHERE singleton=true")).rows[0]);
 vi.stubEnv("NODE_ENV","test");vi.stubEnv("KERNEL_QUIET","1");vi.stubEnv("MAIL_OUTBOX_WORKER_ENABLED","0");vi.stubEnv("MODEL_CREDENTIAL_KEY","enterprise-http-isolated-test-key-6108");vi.stubEnv("PLATFORM_SUPERUSER_EMAILS",email(operator));
 for(const orgId of [source,target])await seedOrg({orgId,projectId:`${orgId}-project`});
 for(const userId of [operator,admin]){await seedCredential({userId,email:email(userId),password,emailVerified:true});await addOrgMember(source,userId,"admin",null);}
 await asOwner(async c=>{await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=now() WHERE singleton=true",[generation]);await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by) VALUES($1,'ordinary',1,$2)",[target,operator]);});
 const {createApp}=await import("../../src/main");app=await createApp();await app.listen(0,"127.0.0.1");
 const address=app.getHttpServer().address();if(!address||typeof address!=="object")throw Error("missing HTTP address");base=`http://127.0.0.1:${address.port}`;
 async function login(user:string){const response=await fetch(`${base}${auth.operations.login.path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:email(user),password})});const body=await response.json();expect(response.status,JSON.stringify(body)).toBe(200);return auth.operations.login.out.parse(body).sessionToken;}
 operatorToken=await login(operator);adminToken=await login(admin);
},180000);
afterAll(async()=>{await app?.close();if(originalEpoch)await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=$2 WHERE singleton=true",[originalEpoch!.generation,originalEpoch!.activated_at]));console.info("[enterprise-http-fixture-retention] owned fixture users/organizations until disposable DB destruction",JSON.stringify({users:[operator,admin],organizations:[source,target]}));vi.unstubAllEnvs();});
function route(template:string,org=target){return template.replace(":orgId",org);}
async function post(path:string,token:string,input:unknown){const response=await fetch(`${base}${path}`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(input)});return {status:response.status,cache:response.headers.get("cache-control"),body:await response.json()};}
it("real authenticated org admin is denied both same-org and cross-org Enterprise writes",async()=>{
 for(const org of [source,target]){
  const upgrade=await post(route(C.createEnterpriseUpgrade.path,org),adminToken,{expectedPlanVersion:org===target?1:0,idempotencyKey:randomUUID()});expect(upgrade.status).toBe(403);expect(upgrade.cache).toBe("private, no-store");expect(TeamBillingRejection.parse(upgrade.body).code).toBe("NOT_PLATFORM_SUPERUSER");
  const grant=await post(route(C.grantEnterpriseCredits.path,org),adminToken,{credits:1,reason:"must be denied",idempotencyKey:randomUUID()});expect(grant.status).toBe(403);expect(grant.cache).toBe("private, no-store");expect(TeamBillingRejection.parse(grant.body).code).toBe("NOT_PLATFORM_SUPERUSER");
 }
 await asOwner(async c=>{expect((await c.query("SELECT count(*)::int AS n FROM enterprise_upgrade_operations WHERE org_id IN($1,$2)",[source,target])).rows[0].n).toBe(0);});
});
it("real HTTP composition upgrades, grants once, resumes original receipt and rejects version conflicts",async()=>{
 const upgrade=await post(route(C.createEnterpriseUpgrade.path),operatorToken,{expectedPlanVersion:1,idempotencyKey:randomUUID()});expect(upgrade.status,JSON.stringify(upgrade.body)).toBe(201);expect(upgrade.cache).toBe("private, no-store");
 const operation=C.createEnterpriseUpgrade.out.parse(upgrade.body);expect(operation.status).toBe("succeeded");
 const response=await fetch(`${base}${route(C.getEnterpriseUpgradeOperation.path).replace(":operationRef",operation.operationRef)}`,{headers:{authorization:`Bearer ${operatorToken}`}});expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(C.getEnterpriseUpgradeOperation.out.parse(await response.json())).toEqual(operation);
 const input={credits:42,reason:"HTTP acceptance",idempotencyKey:randomUUID()};const first=await post(route(C.grantEnterpriseCredits.path),operatorToken,input);expect(first.status,JSON.stringify(first.body)).toBe(201);expect(first.cache).toBe("private, no-store");const receipt=C.grantEnterpriseCredits.out.parse(first.body);
 expect((await post(route(C.grantEnterpriseCredits.path),operatorToken,input)).body).toEqual(receipt);
 const organization=await fetch(`${base}${P.operations.getOrganization.path.replace(":orgId",target)}`,{headers:{authorization:`Bearer ${operatorToken}`}});expect(organization.status).toBe(200);expect(organization.headers.get("cache-control")).toBe("private, no-store");expect(P.operations.getOrganization.out.parse(await organization.json()).organization.billingSummary?.wallet.balance).toBe(42);
 const conflict=await post(route(C.createEnterpriseUpgrade.path),operatorToken,{expectedPlanVersion:0,idempotencyKey:randomUUID()});expect(conflict.status).toBe(409);expect(conflict.body).toMatchObject({code:"PLAN_VERSION_CONFLICT",traceId:expect.any(String)});
 const foreign=await fetch(`${base}${route(C.getEnterpriseUpgradeOperation.path,source).replace(":operationRef",operation.operationRef)}`,{headers:{authorization:`Bearer ${operatorToken}`}});expect(foreign.status).toBe(404);expect(await foreign.json()).toMatchObject({code:"order_not_found"});
 await asOwner(async c=>{const wallet=(await c.query("SELECT balance::text,total_granted::text FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[target])).rows[0];expect(Number(wallet.balance)).toBe(42);expect(Number(wallet.total_granted)).toBe(42);expect((await c.query("SELECT count(*)::int AS n FROM enterprise_credit_grants WHERE org_id=$1",[target])).rows[0].n).toBe(1);});
});
