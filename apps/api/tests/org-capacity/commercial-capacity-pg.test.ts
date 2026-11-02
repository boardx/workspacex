import {closePendingCommercialIntent,readCommercialCapacity} from "../../src/infrastructure/org-capacity/pg-commercial-capacity";
import {randomUUID} from "node:crypto";
import {PgProjectInvitationRepository} from "../../src/infrastructure/project/pg-project-invitation-repository";
import {beforeAll,afterAll,it,expect} from "vitest";
import {PgOrgInviteRepository} from "../../src/infrastructure/auth/pg-org-invite-repository";
import {PgOrgInviteLinkRepository} from "../../src/infrastructure/auth/pg-org-invite-link-repository";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {toOrgId} from "../../src/domain/org-id";
import {BILLING_ACCOUNTING_GENERATION} from "../../src/domain/billing/billing-generation";
import {ensureDatabase,migrateOnce,seedOrg,resetOrgs,addOrgMember,asOwner,asApp} from "../support/db";
const RUN=randomUUID();
const ORG="org-capacity-6107", admin="capacity-6107-admin";
let db:PgDatabase,repo:PgOrgInviteRepository;
beforeAll(async()=>{
 ensureDatabase();await migrateOnce(); await resetOrgs(ORG);
 await seedOrg({orgId:ORG,projectId:ORG+"-p",seatQuota:0});
 for(let n=0;n<4;n++)await addOrgMember(ORG,n===0?admin:`capacity-6107-member-${n}`,n===0?"admin":"consultant",null);
 await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=now() WHERE singleton=true",[BILLING_ACCOUNTING_GENERATION]));
 await asApp(ORG,c=>c.query("INSERT INTO org_commercial_licenses(org_id,generation,purchased_seats) VALUES($1,$2,5)",[ORG,BILLING_ACCOUNTING_GENERATION]));
 db=new PgDatabase(appConfig());repo=new PgOrgInviteRepository(db);
},180000);
afterAll(async()=>{await resetOrgs(ORG);await db?.close();},60000);
it("pending invitations do not occupy commercial seats even with legacy quota zero",async()=>{
 const created=await repo.create({orgId:toOrgId(ORG),inviteId:"capacity-6107-unreserved",email:"capacity-6107-unreserved@example.test",orgRole:"consultant",teamId:null,actorId:admin,status:"pending",token:"capacity-6107-unreserved",tokenExpiresAt:new Date(Date.now()+3600000)});
 expect(created.ok).toBe(true);
});
it("distinct invitation paths compete for the final seat with atomic rollback",async()=>{
 await asApp(ORG,c=>c.query("UPDATE organizations SET seat_quota=1000 WHERE id=$1",[ORG]));
 const tokens=["capacity-6107-token-a","capacity-6107-token-b"];
 for(let n=0;n<2;n++){
  const created=await repo.create({orgId:toOrgId(ORG),inviteId:`capacity-6107-invite-${n}`,email:`capacity-6107-${RUN}-${n}@example.test`,orgRole:"consultant",teamId:null,actorId:admin,status:"pending",token:tokens[n],tokenExpiresAt:new Date(Date.now()+3600000)});
  expect(created.ok).toBe(true);
 }
 const links = new PgOrgInviteLinkRepository(db);
 await links.create({linkId:"capacity-6107-link",orgId:toOrgId(ORG),actorId:admin,orgRole:"consultant",expiry:"7d",maxUses:null,status:"active",tokenHash:"capacity-6107-link-hash",expiresAt:new Date(Date.now()+3600000)});
 const outcomes=await Promise.all([
 ...tokens.map((token,n)=>repo.activate({token,now:new Date(),newAccount:{userId:`capacity-6107-new-${RUN}-${n}`,displayName:"joiner",passwordHash:`$2b$12$${"a".repeat(53)}`},existingUserId:null,untrustedClaims:{orgId:null,orgRole:null,teamId:null}})),
 links.activate({tokenHash:"capacity-6107-link-hash",now:new Date(),email:`capacity-6107-shared-${RUN}@example.test`,newAccount:{userId:`capacity-6107-new-${RUN}-shared`,displayName:"shared",passwordHash:`$2b$12$${"a".repeat(53)}`}})
 ]);
 expect(outcomes.filter(o=>o.ok)).toHaveLength(1);
 const members=await asApp(ORG,c=>c.query("SELECT count(*)::int AS n FROM org_memberships WHERE org_id=$1",[ORG]));
 expect(members.rows[0].n).toBe(5);
 const remaining=await asOwner(c=>c.query("SELECT count(*)::int AS n FROM org_invite_tokens WHERE token=ANY($1) AND consumed_at IS NULL",[tokens]));
 expect(remaining.rows[0].n).toBe(outcomes[2].ok ? 2 : 1);
 const accounts=await asOwner(c=>c.query("SELECT count(*)::int AS n FROM credentials WHERE user_id LIKE $1",[`capacity-6107-new-${RUN}-%`]));
 expect(accounts.rows[0].n).toBe(1);
});

it("full commercial capacity rejects project invitation activation before credentials, gift and outbox",async()=>{
 const projectId=ORG+"-general";
 await addOrgMember(ORG,"capacity-6107-full-member","compliance",null);
 const projectUser=`capacity-6107-project-${RUN}`, outboxId=`capacity-6107-outbox-${RUN}`;
 await asApp(ORG,async c=>{
  await c.query("INSERT INTO projects(id,org_id,name,kind) VALUES($1,$2,'Capacity project','general')",[projectId,ORG]);
  await c.query("INSERT INTO general_projects(id,org_id) VALUES($1,$2)",[projectId,ORG]);
 });
 const project=new PgProjectInvitationRepository(db);
 const now=new Date();
 await project.issueLink({orgId:toOrgId(ORG),projectId,invitedBy:admin,now,dailyCap:100,invitationId:"capacity-6107-project-invite",tokenHash:"capacity-6107-project-token",expiresAt:new Date(Date.now()+3600000)});
 const result=await project.activate({tokenHash:"capacity-6107-project-token",now,userId:projectUser,displayName:"project joiner",passwordHash:`$2b$12$${"a".repeat(53)}`,linkEmail:`capacity-6107-project-${RUN}@example.test`,verification:{challengeId:"capacity-6107-challenge",tokenDigest:"a".repeat(64),expiresAt:new Date(Date.now()+3600000),outboxId}});
 expect(result).toEqual({ok:false,reason:"quota"});
 const residue=await asOwner(c=>c.query("SELECT (SELECT count(*) FROM credentials WHERE user_id=$1)::int AS accounts,(SELECT count(*) FROM mail_outbox WHERE id=$2)::int AS mails,(SELECT count(*) FROM credit_wallets WHERE owner_id=$1)::int AS wallets",[projectUser,outboxId]));
 expect(residue.rows[0]).toEqual({accounts:0,mails:0,wallets:0});
});

it("an unpaid expansion does not release purchased-capacity seats",async()=>{
 await asApp(ORG,c=>c.query("UPDATE org_commercial_licenses SET pending_seats=7,pending_purchase_ref='capacity-pending-upgrade' WHERE org_id=$1",[ORG]));
 const result=await new PgOrgInviteLinkRepository(db).activate({tokenHash:"capacity-6107-link-hash",now:new Date(),email:`capacity-unpaid-${RUN}@example.test`,newAccount:{userId:`capacity-unpaid-${RUN}`,displayName:"Unpaid expansion",passwordHash:`$2b$12$${"a".repeat(53)}`}});
 expect(result).toEqual({ok:false,reason:"quota-exhausted"});
});
it("an initial pending intent constrains actual admission and unknown generations fail closed",async()=>{
 await asApp(ORG,c=>c.query("UPDATE org_commercial_licenses SET purchased_seats=NULL WHERE org_id=$1",[ORG]));
 const links=new PgOrgInviteLinkRepository(db);
 const input={tokenHash:"capacity-6107-link-hash",now:new Date(),email:`capacity-initial-${RUN}@example.test`,newAccount:{userId:`capacity-initial-${RUN}`,displayName:"Pending initial",passwordHash:`$2b$12$${"a".repeat(53)}`}};
 expect((await links.activate(input)).ok).toBe(true);
 await asApp(ORG,c=>c.query("UPDATE org_commercial_licenses SET generation='unsupported-generation',pending_seats=8 WHERE org_id=$1",[ORG]));
 expect(await links.activate({...input,email:`capacity-unknown-${RUN}@example.test`,newAccount:{...input.newAccount,userId:`capacity-unknown-${RUN}`}})).toEqual({ok:false,reason:"quota-exhausted"});
 const count=await asOwner(c=>c.query("SELECT count(*)::int AS n FROM credentials WHERE user_id=$1",[`capacity-unknown-${RUN}`]));
 expect(count.rows[0].n).toBe(0);
});

it("revocation committed while activation waits for the organization lock prevents every grant side effect",async()=>{
 await asApp(ORG,c=>c.query("UPDATE org_commercial_licenses SET generation=$2,purchased_seats=10,pending_seats=NULL,pending_purchase_ref=NULL WHERE org_id=$1",[ORG,BILLING_ACCOUNTING_GENERATION]));
 const inviteId=`revocation-${RUN}`, revokeToken=`revocation-token-${RUN}`, userId=`revocation-user-${RUN}`, mail=`revocation-${RUN}@example.test`;
 expect((await repo.create({orgId:toOrgId(ORG),inviteId,actorId:admin,email:mail,orgRole:"consultant",teamId:null,status:"pending",token:revokeToken,tokenExpiresAt:new Date(Date.now()+3600000)})).ok).toBe(true);
 let ready!:()=>void, release!:()=>void, started!:()=>void;
 const readyPromise=new Promise<void>(resolve=>{ready=resolve;});
 const releasePromise=new Promise<void>(resolve=>{release=resolve;});
 const startedPromise=new Promise<void>(resolve=>{started=resolve;});
 const holder=db.withTenant(toOrgId(ORG),async s=>{await s.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE",[ORG]);ready();await releasePromise;});
 await readyPromise;
 const observe=(s:import("../../src/application/ports/database.port").TenantSession):import("../../src/application/ports/database.port").TenantSession=>({query:async<R>(sql:string,params?:readonly unknown[])=>{if(sql.includes("SELECT id FROM organizations")&&sql.includes("FOR UPDATE"))started();return s.query<R>(sql,params);}});
 const observingDb:import("../../src/application/ports/database.port").DatabasePort={withTenant:(org,fn)=>db.withTenant(org,s=>fn(observe(s))),withoutTenant:fn=>db.withoutTenant(s=>fn(observe(s))),close:async()=>{}};
 const activation=new PgOrgInviteRepository(observingDb).activate({token:revokeToken,now:new Date(),newAccount:{userId,displayName:"Revocation race",passwordHash:`$2b$12$${"a".repeat(53)}`},existingUserId:null,untrustedClaims:{orgId:null,orgRole:null,teamId:null}});
 try{
  await startedPromise;
  expect(await repo.revokeOrgInvite({orgId:toOrgId(ORG),inviteId,actorId:admin,now:new Date()})).toEqual({ok:true,status:"revoked"});
 }finally{release();await holder;}
 expect(await activation).toEqual({ok:false,reason:"not-found"});
 const state=await asOwner(async c=>(await c.query("SELECT (SELECT count(*) FROM credentials WHERE user_id=$1)::int AS accounts,(SELECT count(*) FROM credit_wallets WHERE owner_id=$1)::int AS wallets,(SELECT count(*) FROM mail_outbox WHERE recipient=$2)::int AS mails,(SELECT count(*) FROM org_invite_tokens WHERE token=$3 AND consumed_at IS NULL)::int AS reusable",[userId,mail,revokeToken])).rows[0]);
 expect(state).toEqual({accounts:0,wallets:0,mails:0,reusable:1});
 const invite=await asApp(ORG,c=>c.query("SELECT status FROM org_invites WHERE id=$1",[inviteId]));
 expect(invite.rows[0].status).toBe("revoked");
});

it("only the matching pure pending intent can be deleted, while paid capacity remains protected by restrictive RLS",async()=>{
 await asApp(ORG,c=>c.query("UPDATE org_commercial_licenses SET generation=$2,purchased_seats=10,pending_seats=12,pending_purchase_ref='paid-addition' WHERE org_id=$1",[ORG,BILLING_ACCOUNTING_GENERATION]));
 expect(await db.withTenant(toOrgId(ORG),s=>closePendingCommercialIntent(s,ORG,"paid-addition"))).toBe(true);
 const paid=await asApp(ORG,c=>c.query("SELECT purchased_seats::text,pending_purchase_ref FROM org_commercial_licenses WHERE org_id=$1",[ORG]));
 expect(paid.rows[0]).toEqual({purchased_seats:"10",pending_purchase_ref:null});
 expect((await asApp(ORG,c=>c.query("DELETE FROM org_commercial_licenses WHERE org_id=$1 RETURNING org_id",[ORG]))).rows).toHaveLength(0);
 await asApp(ORG,c=>c.query("UPDATE org_commercial_licenses SET purchased_seats=NULL,pending_seats=12,pending_purchase_ref='initial-pending' WHERE org_id=$1",[ORG]));
 expect((await asApp("capacity-other-org",c=>c.query("DELETE FROM org_commercial_licenses WHERE org_id=$1 RETURNING org_id",[ORG]))).rows).toHaveLength(0);
 expect(await db.withTenant(toOrgId(ORG),s=>closePendingCommercialIntent(s,ORG,"wrong-reference"))).toBe(false);
 expect((await asApp(ORG,c=>c.query("SELECT org_id FROM org_commercial_licenses WHERE org_id=$1",[ORG]))).rows).toHaveLength(1);
 expect(await db.withTenant(toOrgId(ORG),s=>closePendingCommercialIntent(s,ORG,"initial-pending"))).toBe(true);
 expect(await db.withTenant(toOrgId(ORG),s=>readCommercialCapacity(s,ORG))).toEqual({kind:"legacy"});
});
