import {beforeAll,afterAll,it,expect} from "vitest";
import {PgOrgInviteRepository} from "../../src/infrastructure/auth/pg-org-invite-repository";
import {PgOrgInviteLinkRepository} from "../../src/infrastructure/auth/pg-org-invite-link-repository";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {toOrgId} from "../../src/domain/org-id";
import {BILLING_ACCOUNTING_GENERATION} from "../../src/domain/billing/billing-generation";
import {ensureDatabase,migrateOnce,seedOrg,resetOrgs,addOrgMember,asOwner,asApp} from "../support/db";
const ORG="org-capacity-6107", admin="capacity-6107-admin";
let db:PgDatabase,repo:PgOrgInviteRepository;
beforeAll(async()=>{
 ensureDatabase();await migrateOnce(); await resetOrgs(ORG);
 await seedOrg({orgId:ORG,projectId:ORG+"-p",seatQuota:0});
 for(let n=0;n<4;n++)await addOrgMember(ORG,n===0?admin:`capacity-6107-member-${n}`,n===0?"admin":"member",null);
 await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=now() WHERE singleton=true",[BILLING_ACCOUNTING_GENERATION]));
 await asApp(ORG,c=>c.query("INSERT INTO org_commercial_licenses(org_id,generation,purchased_seats) VALUES($1,$2,5)",[ORG,BILLING_ACCOUNTING_GENERATION]));
 db=new PgDatabase(appConfig());repo=new PgOrgInviteRepository(db);
},120000);
afterAll(async()=>{await resetOrgs(ORG);await db?.close();},60000);
it("pending invitations do not occupy commercial seats even with legacy quota zero",async()=>{
 const created=await repo.create({orgId:toOrgId(ORG),inviteId:"capacity-6107-unreserved",email:"capacity-6107-unreserved@example.test",orgRole:"member",teamId:null,actorId:admin,status:"pending",token:"capacity-6107-unreserved",tokenExpiresAt:new Date(Date.now()+3600000)});
 expect(created.ok).toBe(true);
});
it("distinct invitation paths compete for the final seat with atomic rollback",async()=>{
 await asApp(ORG,c=>c.query("UPDATE organizations SET seat_quota=1000 WHERE id=$1",[ORG]));
 const tokens=["capacity-6107-token-a","capacity-6107-token-b"];
 for(let n=0;n<2;n++){
  const created=await repo.create({orgId:toOrgId(ORG),inviteId:`capacity-6107-invite-${n}`,email:`capacity-6107-${n}@example.test`,orgRole:"member",teamId:null,actorId:admin,status:"pending",token:tokens[n],tokenExpiresAt:new Date(Date.now()+3600000)});
  expect(created.ok).toBe(true);
 }
 const links = new PgOrgInviteLinkRepository(db);
 await links.create({linkId:"capacity-6107-link",orgId:toOrgId(ORG),actorId:admin,orgRole:"member",expiry:"7d",maxUses:null,status:"active",tokenHash:"capacity-6107-link-hash",expiresAt:new Date(Date.now()+3600000)});
 const outcomes=await Promise.all([
 ...tokens.map((token,n)=>repo.activate({token,now:new Date(),newAccount:{userId:`capacity-6107-new-${n}`,displayName:"joiner",passwordHash:"not-real-password"},existingUserId:null,untrustedClaims:{orgId:null,orgRole:null,teamId:null}})),
 links.activate({tokenHash:"capacity-6107-link-hash",now:new Date(),email:"capacity-6107-shared@example.test",newAccount:{userId:"capacity-6107-new-shared",displayName:"shared",passwordHash:"not-real-password"}})
 ]);
 expect(outcomes.filter(o=>o.ok)).toHaveLength(1);
 const members=await asApp(ORG,c=>c.query("SELECT count(*)::int AS n FROM org_memberships WHERE org_id=$1",[ORG]));
 expect(members.rows[0].n).toBe(5);
 const remaining=await asOwner(c=>c.query("SELECT count(*)::int AS n FROM org_invite_tokens WHERE token=ANY($1) AND consumed_at IS NULL",[tokens]));
 expect(remaining.rows[0].n).toBe(outcomes[2].ok ? 2 : 1);
 const accounts=await asOwner(c=>c.query("SELECT count(*)::int AS n FROM credentials WHERE user_id LIKE 'capacity-6107-new-%'"));
 expect(accounts.rows[0].n).toBe(1);
});
