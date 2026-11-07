import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ensureDatabase, migrateOnce, seedOrg, addOrgMember, resetOrgs, asOwner, asApp } from "../support/db";
import { ensureRedis } from "../support/auth";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgOrgInviteRepository } from "../../src/infrastructure/auth/pg-org-invite-repository";
import { toOrgId } from "../../src/domain/org-id";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
const id=randomUUID(),org=`org-capacity-http-${id}`,email=`capacity-http-${id}@example.test`,token=`capacity-http-token-${id}`;
let app:NestExpressApplication,db:PgDatabase,base:string;
let originalEpoch:{generation:string|null;activated_at:Date|null}|undefined;
beforeAll(async()=>{
 ensureDatabase();ensureRedis();await migrateOnce();
 vi.stubEnv("NODE_ENV","test");vi.stubEnv("MAIL_OUTBOX_WORKER_ENABLED","0");vi.stubEnv("KERNEL_QUIET","1");
 await seedOrg({orgId:org,projectId:`${org}-p`,seatQuota:0});
 const roles=["admin","lead","consultant","compliance","consultant"];
 for(const [n,role] of roles.entries())await addOrgMember(org,`${org}-member-${n}`,role,null);
 originalEpoch=await asOwner(async c=>(await c.query<{generation:string|null;activated_at:Date|null}>("SELECT generation,activated_at FROM billing_pricing_epoch WHERE singleton=true")).rows[0]);
 await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=now() WHERE singleton=true",[BILLING_ACCOUNTING_GENERATION]));
 await asApp(org,c=>c.query("INSERT INTO org_commercial_licenses(org_id,generation,purchased_seats) VALUES($1,$2,5)",[org,BILLING_ACCOUNTING_GENERATION]));
 db=new PgDatabase(appConfig());
 expect((await new PgOrgInviteRepository(db).create({orgId:toOrgId(org),inviteId:`${org}-invite`,actorId:`${org}-member-0`,email,orgRole:"consultant",teamId:null,status:"pending",token,tokenExpiresAt:new Date(Date.now()+3600000)})).ok).toBe(true);
 const {createApp}=await import("../../src/main");app=await createApp();await app.listen(0,"127.0.0.1");
 const addr=app.getHttpServer().address();base=`http://127.0.0.1:${typeof addr==="object"&&addr?addr.port:0}`;
},180000);
afterAll(async()=>{
 await app?.close();await db?.close();await resetOrgs(org);
 await asOwner(async c=>{
  const users=(await c.query<{user_id:string}>("SELECT user_id FROM credentials WHERE email=$1",[email])).rows.map(row=>row.user_id);
  await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[users]);
  await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[users]);
  await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[])",[users]);
  await c.query("DELETE FROM credentials WHERE user_id=ANY($1::text[])",[users]);
  if(originalEpoch)await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=$2 WHERE singleton=true",[originalEpoch.generation,originalEpoch.activated_at]);
 });vi.unstubAllEnvs();
},60000);
it("real anonymous activation reports capacity and preserves invitation and account even with forged org/role query claims",async()=>{
 const response=await fetch(`${base}/org-invites/activate?org=other-org&role=admin`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token,mode:"new-account",profile:{name:"Capacity joiner",password:"correct-horse-battery-staple"},sessionId:null})});
 expect(response.status).toBe(400);
 expect(await response.json()).toMatchObject({reasonCode:"QUOTA_EXHAUSTED"});
 const state=await asOwner(async c=>(await c.query("SELECT (SELECT count(*) FROM credentials WHERE email=$1)::int AS accounts,(SELECT count(*) FROM org_invite_tokens WHERE token=$2 AND consumed_at IS NULL)::int AS reusable",[email,token])).rows[0]);
 expect(state).toEqual({accounts:0,reusable:1});
 const members=await asApp(org,c=>c.query("SELECT count(*)::int AS n FROM org_memberships WHERE org_id=$1",[org]));
 expect(members.rows[0].n).toBe(5);
});
it("an invalid invitation remains indistinguishable from absent invite",async()=>{
 const response=await fetch(`${base}/org-invites/activate`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:`absent-${id}`,mode:"new-account",profile:{name:"Unknown joiner",password:"correct-horse-battery-staple"},sessionId:null})});
 expect(response.status).toBe(400);expect(await response.json()).toMatchObject({reasonCode:"INVITE_NOT_FOUND"});
});
