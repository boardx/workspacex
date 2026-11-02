// @global-scope-fixture table:billing_pricing_epoch: isolated disposable PG only; proves active-epoch gating, never a production activation.
// @global-scope-fixture table:credit_wallets: isolated per-test random team owner; asserts actual rollback and exact grant totals.
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,expect,it} from "vitest";
import {asOwner,ensureDatabase,migrateOnce,resetOrgs,seedOrg} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {EnterpriseCreditGrant} from "../../src/infrastructure/billing/enterprise-credit-grant";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {toOrgId} from "../../src/domain/org-id";
let org=toOrgId("enterprise-grant-6108");let db:PgDatabase;let grants:EnterpriseCreditGrant;
beforeAll(async()=>{ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());grants=new EnterpriseCreditGrant(db);},180000);
beforeEach(async()=>{
 org=toOrgId(`enterprise-6108-${randomUUID()}`);
 await resetOrgs(org);await seedOrg({orgId:org,projectId:`${org}-project`});
 await asOwner(async c=>{await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=now() WHERE singleton=true",[generation]);await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by,billing_generation) VALUES($1,'enterprise',1,'operator',$2)",[org,generation]);});
});
afterAll(async()=>{await db?.close();});
it("actual wallet, ledger and immutable grant audit commit once",async()=>{
 const input={credits:23,reason:"approved allowance",idempotencyKey:"pg-attempt-00000001"};const first=await grants.grant(org,"operator",input);expect(await grants.grant(org,"operator",input)).toEqual(first);
 await asOwner(async c=>{const result=await c.query("SELECT balance::text,total_granted::text FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org]);expect(Number(result.rows[0].balance)).toBe(23);expect(Number(result.rows[0].total_granted)).toBe(23);const ledger=await c.query("SELECT count(*)::int AS n FROM credit_transactions WHERE source_id=$1",[first.grantRef]);expect(ledger.rows[0].n).toBe(1);});
 await expect(grants.grant(org,"different-operator",input)).rejects.toMatchObject({code:"idempotency_conflict"});
});
it("legacy Enterprise metadata cannot restore current generation rights",async()=>{
 await asOwner(c=>c.query("UPDATE organization_plans SET billing_generation=NULL WHERE org_id=$1",[org]));
 await expect(grants.grant(org,"operator",{credits:1,reason:"deny legacy",idempotencyKey:"legacy-attempt-001"})).rejects.toMatchObject({code:"enterprise_required"});
});
it("actual no-paid-Team upgrade preserves one Plan version and the same receipt",async()=>{
 const {PgEnterpriseUpgradeStore}=await import("../../src/infrastructure/billing/enterprise-upgrade-store");
 const {EnterpriseUpgrade}=await import("../../src/application/billing/enterprise-upgrade");
 const {EnterpriseNoPaidTeamAdapter}=await import("../../src/infrastructure/billing/enterprise-no-paid-team");
 await asOwner(c=>c.query("UPDATE organization_plans SET plan='ordinary',billing_generation=NULL WHERE org_id=$1",[org]));
 const service=new EnterpriseUpgrade(new PgEnterpriseUpgradeStore(db),new EnterpriseNoPaidTeamAdapter(db));
 const request={expectedPlanVersion:1,idempotencyKey:"upgrade-attempt-001"};const result=await service.upgrade(org,"operator",request);
 expect(result.status).toBe("succeeded");expect(await service.upgrade(org,"operator",request)).toEqual(result);
 await asOwner(async c=>{const row=(await c.query("SELECT plan,version,billing_generation FROM organization_plans WHERE org_id=$1",[org])).rows[0];expect(row).toMatchObject({plan:"enterprise",version:2,billing_generation:generation});});
});
it("actual paid license remains unchanged while upgrade is processing",async()=>{
 const {PgEnterpriseUpgradeStore}=await import("../../src/infrastructure/billing/enterprise-upgrade-store");const {EnterpriseUpgrade}=await import("../../src/application/billing/enterprise-upgrade");const {EnterpriseNoPaidTeamAdapter}=await import("../../src/infrastructure/billing/enterprise-no-paid-team");
 await asOwner(async c=>{await c.query("UPDATE organization_plans SET plan='ordinary',billing_generation=$2 WHERE org_id=$1",[org,generation]);await c.query("INSERT INTO org_commercial_licenses(org_id,generation,purchased_seats) VALUES($1,$2,7)",[org,generation]);});
 const service=new EnterpriseUpgrade(new PgEnterpriseUpgradeStore(db),new EnterpriseNoPaidTeamAdapter(db));const result=await service.upgrade(org,"operator",{expectedPlanVersion:1,idempotencyKey:"paid-upgrade-00001"});
 expect(result).toMatchObject({status:"processing",code:"dependency_unavailable"});await asOwner(async c=>{expect((await c.query("SELECT plan,version FROM organization_plans WHERE org_id=$1",[org])).rows[0]).toEqual({plan:"ordinary",version:1});});
});
it("audit CHECK failure rolls back actual wallet and ledger",async()=>{
 await asOwner(c=>c.query("ALTER TABLE enterprise_credit_grants ADD CONSTRAINT enterprise_6108_test_audit_failure CHECK(reason<>'forced audit failure')"));
 try{
  await expect(grants.grant(org,"operator",{credits:42,reason:"forced audit failure",idempotencyKey:"rollback-audit-001"})).rejects.toThrow();
  await asOwner(async c=>{expect((await c.query("SELECT count(*)::int AS n FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org])).rows[0].n).toBe(0);expect((await c.query("SELECT count(*)::int AS n FROM enterprise_credit_grants WHERE org_id=$1",[org])).rows[0].n).toBe(0);});
 }finally{await asOwner(c=>c.query("ALTER TABLE enterprise_credit_grants DROP CONSTRAINT enterprise_6108_test_audit_failure"));}
});
it("overflow leaves actual wallet unchanged and creates no grant receipt",async()=>{
 await asOwner(c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('team',$1,2147483647)",[org]));
 await expect(grants.grant(org,"operator",{credits:1,reason:"overflow denial",idempotencyKey:"overflow-attempt-001"})).rejects.toMatchObject({code:"credit_balance_unrepresentable"});
 await asOwner(async c=>{expect(Number((await c.query("SELECT balance::text FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org])).rows[0].balance)).toBe(2147483647);expect((await c.query("SELECT count(*)::int AS n FROM enterprise_credit_grants WHERE org_id=$1",[org])).rows[0].n).toBe(0);});
});
it("platform detail hydrates active Enterprise from the same real wallet",async()=>{
 const {PgPlatformOrganizationRepository}=await import("../../src/infrastructure/system/pg-platform-organization-repository");const {platformOrganizations:C}=await import("@repo/contracts");
 await grants.grant(org,"operator",{credits:61,reason:"read model allowance",idempotencyKey:"summary-attempt-001"});
 const repository=new PgPlatformOrganizationRepository(db,null);
 const result=await repository.detail(org,"operator");expect(C.operations.getOrganization.out.safeParse(result).success).toBe(true);
 expect(result.organization.billingSummary).toMatchObject({licenseStatus:"enterprise",teamPayment:null,planVersion:1,generation,wallet:{balance:61,permanentBalance:61,subscriptionCredits:0,totalGranted:61}});
});
