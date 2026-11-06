import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {ensureDatabase,migrateOnce,seedOrg,asApp,asOwner,resetOrgs} from '../support/db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgMemberCreditQuotaRepository} from '../../src/infrastructure/billing/pg-member-credit-quota-repository';
import {toOrgId} from '../../src/domain/org-id';
const org=toOrgId(`credit-replay-${randomUUID()}`),db=new PgDatabase(appConfig()),repo=new PgMemberCreditQuotaRepository(db);
const migration=readFileSync(new URL('../../migrations/20261106120000_member_credit_quotas.sql',import.meta.url),'utf8');
let beforeRows:unknown;
const snapshot=()=>asApp(org,async c=>(await c.query('SELECT * FROM member_credit_quota WHERE org_id=$1 ORDER BY user_id',[org])).rows);
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();await seedOrg({orgId:org,projectId:`${org}-project`});
 await asApp(org,async c=>{
  for(const user of ['zero','custom','default'])await c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'consultant')",[org,`${org}-${user}`]);
  await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by) VALUES($1,'enterprise',1,'replay-fixture')",[org]);
 });
 await repo.setCreditQuota(org,`${org}-zero`,0,'replay-admin');
 await repo.setCreditQuota(org,`${org}-custom`,2500,'replay-admin');
 beforeRows=await snapshot();
});
afterAll(async()=>{await db.close();await resetOrgs(org);});
// DDL calls kernel_apply_org_freeze_policies; run only in the exclusive lane to avoid tenant-table lock races.
it.each([1,2])('forced direct application %s preserves zero/custom overrides and unconfigured defaults',async()=>{
 await asOwner(c=>c.query(migration));
 expect(await snapshot()).toEqual(beforeRows);
 const members=(await repo.readCreditQuotas(org)).members;
 expect(members.find(m=>m.userId===`${org}-zero`)).toMatchObject({monthlyLimit:0,overridden:true});
 expect(members.find(m=>m.userId===`${org}-custom`)).toMatchObject({monthlyLimit:2500,overridden:true});
 expect(members.find(m=>m.userId===`${org}-default`)).toMatchObject({monthlyLimit:1000,overridden:false});
 const policy=await asOwner(async c=>(await c.query("SELECT count(*)::int AS n FROM pg_policy WHERE polrelid='member_credit_quota'::regclass AND polname='member_credit_quota_tenant'")).rows[0]);
 expect(policy.n).toBe(1);
 const index=await asOwner(async c=>(await c.query("SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND indexname='credit_consumption_member_holds'")).rows[0]);
 expect(index.n).toBe(1);
});
