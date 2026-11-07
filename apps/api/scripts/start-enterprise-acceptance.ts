import type {Request,Response,NextFunction} from "express";
import {operations as enterpriseOperations} from "@repo/contracts/billing-team";
// @global-scope-fixture table:credentials: disposable acceptance users scoped by wrapper id.
// @global-scope-fixture table:billing_pricing_epoch: active epoch fixture in disposable wsx_ database only.
import {readFileSync} from "node:fs";
import {enterpriseAcceptance as fixture} from "./lib/enterprise-acceptance-fixture";
import {addOrgMember,asOwner,ensureDatabase,migrateOnce,seedOrg} from "../tests/support/db";
import {ensureRedis,seedCredential} from "../tests/support/auth";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../src/domain/billing/billing-generation";
if(process.env.NODE_ENV==="production"||!process.env.WORKSPACEX_ISOLATION_ID||!process.env.PGDATABASE?.startsWith("wsx_"))throw Error("disposable test isolation required");
const port=Number(process.env.WORKSPACEX_API_PORT);if(!Number.isInteger(port)||port<1||port>65535)throw Error("isolated API port required");
ensureDatabase();ensureRedis();await migrateOnce();
for(const orgId of [fixture.source,fixture.target])await seedOrg({orgId,projectId:`${orgId}-project`});
for(const [userId,email] of [[fixture.operator,fixture.operatorEmail],[fixture.admin,fixture.adminEmail]]){
 await seedCredential({userId:userId!,email:email!,password:fixture.password,emailVerified:true});await addOrgMember(fixture.source,userId!,"admin",null);
}
await asOwner(async c=>{
 await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=now() WHERE singleton=true",[generation]);
 await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by) VALUES($1,'ordinary',1,$2)",[fixture.target,fixture.operator]);
 await c.query(readFileSync(new URL("../provisioning/platform-org-catalog.sql",import.meta.url),"utf8"));
 await c.query(`CREATE ROLE "${fixture.catalogUser.replaceAll('"','""')}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${fixture.catalogPassword.replaceAll("'","''")}'`);
 await c.query(`GRANT app_platform_org_catalog_ro TO "${fixture.catalogUser.replaceAll('"','""')}"`);
});
Object.assign(process.env,{NODE_ENV:"test",KERNEL_QUIET:"1",MAIL_OUTBOX_WORKER_ENABLED:"0",MODEL_CREDENTIAL_KEY:"enterprise-acceptance-isolated-key-6108",PLATFORM_SUPERUSER_EMAILS:fixture.operatorEmail,PLATFORM_ORG_CATALOG_DB_USER:fixture.catalogUser,PLATFORM_ORG_CATALOG_DB_PASSWORD:fixture.catalogPassword});
const {createApp}=await import("../src/main");const app=await createApp();
// One deterministic transport fault AFTER the real grant transaction commits.
// This test-only runtime never mocks a financial service or intercepts the browser API.
let responseLost=false;
app.use((req:Request,res:Response,next:NextFunction)=>{
 const send=res.json.bind(res);
 res.json=(body?:unknown)=>{
  if(!responseLost&&req.method==="POST"&&req.path===enterpriseOperations.grantEnterpriseCredits.path.replace(":orgId",fixture.target)&&res.statusCode===201&&enterpriseOperations.grantEnterpriseCredits.out.safeParse(body).success){responseLost=true;res.destroy();return res;}
  return send(body);
 };
 next();
});
app.enableShutdownHooks(["SIGTERM","SIGINT"]);await app.listen(port,"127.0.0.1");
