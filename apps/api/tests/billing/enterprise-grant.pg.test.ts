import {readFileSync} from "node:fs";
import type {DatabasePort,TenantSession} from "../../src/application/ports/database.port";
// Epoch fixture ownership: isolated disposable PG only; proves active-epoch gating, never a production activation.
// @global-scope-fixture table:credit_wallets: isolated per-test random team owner; asserts actual rollback and exact grant totals.
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,expect,it} from "vitest";
import {asApp,asOwner,ensureDatabase,migrateOnce,resetOrgs,seedOrg} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {EnterpriseCreditGrant} from "../../src/infrastructure/billing/enterprise-credit-grant";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {toOrgId} from "../../src/domain/org-id";
const ownedIds:string[]=[];let originalEpoch:{generation:string|null;activated_at:string|null}|undefined;
let org=toOrgId("enterprise-grant-6108");let db:PgDatabase;let grants:EnterpriseCreditGrant;
beforeAll(async()=>{ensureDatabase();await migrateOnce();originalEpoch=await asOwner(async c=>(await c.query<{generation:string|null;activated_at:string|null}>("SELECT generation,activated_at::text AS activated_at FROM billing_pricing_epoch WHERE singleton=true")).rows[0]);await asOwner(c=>c.query(readFileSync(new URL("../../provisioning/platform-org-catalog.sql",import.meta.url),"utf8")));db=new PgDatabase(appConfig());grants=new EnterpriseCreditGrant(db);},180000);
beforeEach(async()=>{
 org=toOrgId(`enterprise-6108-${randomUUID()}`);
 await resetOrgs(org);await seedOrg({orgId:org,projectId:`${org}-project`});ownedIds.push(org);
 await asOwner(async c=>{await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=now() WHERE singleton=true",[generation]);await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by,billing_generation) VALUES($1,'enterprise',1,'operator',$2)",[org,generation]);});
});
afterAll(async()=>{await db?.close();if(originalEpoch)await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=$2 WHERE singleton=true",[originalEpoch!.generation,originalEpoch!.activated_at]));console.info("[enterprise-fixture-retention] immutable financial rows retained only for these owned IDs until isolated DB destruction",JSON.stringify(ownedIds));});
it("actual wallet, ledger and immutable grant audit commit once",async()=>{
 await asOwner(c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance,total_granted) VALUES('team',$1,0.09,0.09)",[org]));
 const input={credits:23,reason:"approved allowance",idempotencyKey:"pg-attempt-00000001"};const first=await grants.grant(org,"operator",input);expect(await grants.grant(org,"operator",input)).toEqual(first);
 await asOwner(async c=>{const result=await c.query("SELECT balance::text,total_granted::text FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org]);expect(Number(result.rows[0].balance)).toBe(23.09);expect(Number(result.rows[0].total_granted)).toBe(23.09);const ledger=await c.query("SELECT count(*)::int AS n FROM credit_transactions WHERE source_id=$1",[first.grantRef]);expect(ledger.rows[0].n).toBe(1);const actualLedger=(await c.query("SELECT txn_id,balance_after::text FROM credit_transactions WHERE source_id=$1",[first.grantRef])).rows[0];expect(actualLedger.balance_after).toBe("23.09");expect(actualLedger.txn_id).toBe(first.ledgerRef);const audit=(await c.query("SELECT actor_id,audit_ref,generation,receipt FROM enterprise_credit_grants WHERE id=$1",[first.grantRef])).rows[0];expect(audit).toMatchObject({actor_id:"operator",audit_ref:first.auditRef,generation,receipt:first});});
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
 if(result.status==="succeeded")await asOwner(async c=>{const audit=(await c.query("SELECT org_id,actor_id,version,plan FROM organization_plan_changes WHERE id=$1",[result.receipt.auditRef])).rows[0];expect(audit).toEqual({org_id:org,actor_id:"operator",version:2,plan:"enterprise"});});
 await asOwner(async c=>{const row=(await c.query("SELECT plan,version,billing_generation FROM organization_plans WHERE org_id=$1",[org])).rows[0];expect(row).toMatchObject({plan:"enterprise",version:2,billing_generation:generation});expect((await c.query("SELECT count(*)::int AS n FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org])).rows[0].n).toBe(0);});
});
it("actual paid license remains unchanged while upgrade is processing",async()=>{
 const {PgEnterpriseUpgradeStore}=await import("../../src/infrastructure/billing/enterprise-upgrade-store");const {EnterpriseUpgrade}=await import("../../src/application/billing/enterprise-upgrade");const {EnterpriseNoPaidTeamAdapter}=await import("../../src/infrastructure/billing/enterprise-no-paid-team");
 await asOwner(async c=>{await c.query("UPDATE organization_plans SET plan='ordinary',billing_generation=$2 WHERE org_id=$1",[org,generation]);await c.query("INSERT INTO org_commercial_licenses(org_id,generation,purchased_seats) VALUES($1,$2,7)",[org,generation]);});
 const service=new EnterpriseUpgrade(new PgEnterpriseUpgradeStore(db),new EnterpriseNoPaidTeamAdapter(db));const result=await service.upgrade(org,"operator",{expectedPlanVersion:1,idempotencyKey:"paid-upgrade-00001"});
 await expect(grants.grant(org,"operator",{credits:1,reason:"Team must purchase credits",idempotencyKey:"team-grant-denial-001"})).rejects.toMatchObject({code:"enterprise_required"});
 expect(result).toMatchObject({status:"processing",code:"dependency_unavailable"});await asOwner(async c=>{expect((await c.query("SELECT plan,version FROM organization_plans WHERE org_id=$1",[org])).rows[0]).toEqual({plan:"ordinary",version:1});});
});
it("audit CHECK failure rolls back actual wallet and ledger",async()=>{
 await asOwner(c=>c.query("ALTER TABLE enterprise_credit_grants ADD CONSTRAINT enterprise_6108_test_audit_failure CHECK(reason<>'forced audit failure')"));
 try{
  await expect(grants.grant(org,"operator",{credits:42,reason:"forced audit failure",idempotencyKey:"rollback-audit-001"})).rejects.toMatchObject({code:"23514",constraint:"enterprise_6108_test_audit_failure"});
  await asOwner(async c=>{expect((await c.query("SELECT count(*)::int AS n FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org])).rows[0].n).toBe(0);expect((await c.query("SELECT count(*)::int AS n FROM enterprise_credit_grants WHERE org_id=$1",[org])).rows[0].n).toBe(0);});
 }finally{await asOwner(c=>c.query("ALTER TABLE enterprise_credit_grants DROP CONSTRAINT enterprise_6108_test_audit_failure"));}
});
it("overflow leaves actual wallet unchanged and creates no grant receipt",async()=>{
 await asOwner(c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('team',$1,2147483647)",[org]));
 await expect(grants.grant(org,"operator",{credits:1,reason:"overflow denial",idempotencyKey:"overflow-attempt-001"})).rejects.toMatchObject({code:"credit_balance_unrepresentable"});
 await asOwner(async c=>{expect(Number((await c.query("SELECT balance::text FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org])).rows[0].balance)).toBe(2147483647);expect((await c.query("SELECT count(*)::int AS n FROM enterprise_credit_grants WHERE org_id=$1",[org])).rows[0].n).toBe(0);});
 await asOwner(c=>c.query("UPDATE credit_wallets SET balance=0,total_granted=2147483647 WHERE owner_type='team' AND owner_id=$1",[org]));
 await expect(grants.grant(org,"operator",{credits:1,reason:"cumulative overflow denial",idempotencyKey:"overflow-total-0001"})).rejects.toMatchObject({code:"credit_balance_unrepresentable"});
});
it("platform detail hydrates active Enterprise from the same real wallet",async()=>{
 const {platformOrganizations:C}=await import("@repo/contracts");
 await grants.grant(org,"operator",{credits:61,reason:"read model allowance",idempotencyKey:"summary-attempt-001"});
 const repository=await platformSummaryRepository();
 const result=await repository.detail(org,"operator");expect(C.operations.getOrganization.out.safeParse(result).success).toBe(true);
 const page=await repository.list({search:String(org),limit:25},"operator");expect(C.operations.listOrganizations.out.safeParse(page).success).toBe(true);expect(page.organizations[0]?.billingSummary?.wallet.balance).toBe(61);
 expect(result.organization.billingSummary).toMatchObject({licenseStatus:"enterprise",teamPayment:null,planVersion:1,generation,wallet:{balance:61,permanentBalance:61,subscriptionCredits:0,totalGranted:61}});
});

it("owner tenant teardown preserves immutable financial history and cannot restore deleted organization rights",async()=>{
 const {PgEnterpriseUpgradeStore}=await import("../../src/infrastructure/billing/enterprise-upgrade-store");const {EnterpriseUpgrade}=await import("../../src/application/billing/enterprise-upgrade");const {EnterpriseNoPaidTeamAdapter}=await import("../../src/infrastructure/billing/enterprise-no-paid-team");
 const service=new EnterpriseUpgrade(new PgEnterpriseUpgradeStore(db),new EnterpriseNoPaidTeamAdapter(db));const operation=await service.upgrade(org,"operator",{expectedPlanVersion:1,idempotencyKey:"retention-upgrade-001"});expect(operation.status).toBe("succeeded");
 const receipt=await grants.grant(org,"operator",{credits:5,reason:"retained financial history",idempotencyKey:"retention-grant-0001"});
 const other=toOrgId(`${org}-other`);await seedOrg({orgId:other,projectId:`${other}-project`});ownedIds.push(other);await asOwner(c=>c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by,billing_generation) VALUES($1,'enterprise',1,'operator',$2)",[other,generation]));await grants.grant(other,"operator",{credits:9,reason:"other organization",idempotencyKey:"other-grant-0000001"});
 async function snapshot(owner:string){return asOwner(async c=>({orgs:(await c.query("SELECT count(*)::int AS n FROM organizations WHERE id=$1",[owner])).rows[0].n,wallets:(await c.query("SELECT balance::text,total_granted::text FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[owner])).rows,audits:(await c.query("SELECT id,audit_ref,receipt FROM enterprise_credit_grants WHERE org_id=$1 ORDER BY id",[owner])).rows,ledgers:(await c.query("SELECT txn_id,credits::text,balance_after::text FROM credit_transactions WHERE wallet_id IN(SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1) ORDER BY txn_id",[owner])).rows,operations:(await c.query("SELECT operation_ref,result FROM enterprise_upgrade_operations WHERE org_id=$1 ORDER BY operation_ref",[owner])).rows}));}
 const before=await snapshot(org),otherBefore=await snapshot(other);
 async function immutable(){
  for(const sql of ["UPDATE enterprise_credit_grants SET reason='forged' WHERE id=$1","DELETE FROM enterprise_credit_grants WHERE id=$1"])await expect(asOwner(c=>c.query(sql,[receipt.grantRef]))).rejects.toMatchObject({code:"P0001"});
  for(const sql of ["UPDATE enterprise_credit_grants SET reason='forged' WHERE id=$1","DELETE FROM enterprise_credit_grants WHERE id=$1"])await expect(asApp(org,c=>c.query(sql,[receipt.grantRef]))).rejects.toMatchObject({code:"42501"});
 }
 await immutable();await resetOrgs(org);await immutable();
 expect(await snapshot(org)).toEqual({...before,orgs:0});expect(await snapshot(other)).toEqual(otherBefore);
 await expect(grants.grant(org,"operator",{credits:1,reason:"deleted organization",idempotencyKey:"deleted-grant-0001"})).rejects.toMatchObject({code:"ORGANIZATION_NOT_FOUND"});await expect(service.operation(org,operation.operationRef)).rejects.toMatchObject({code:"ORGANIZATION_NOT_FOUND"});await expect(service.upgrade(org,"operator",{expectedPlanVersion:1,idempotencyKey:"retention-upgrade-001"})).rejects.toMatchObject({code:"ORGANIZATION_NOT_FOUND"});
});

async function platformSummaryRepository(){
 const {PgPlatformOrganizationRepository}=await import("../../src/infrastructure/system/pg-platform-organization-repository");
 const catalog:DatabasePort={withTenant:async()=>{throw Error("no catalog tenant queries");},close:async()=>{},withoutTenant:async fn=>asOwner(async c=>{
  await c.query("BEGIN");await c.query("SET LOCAL ROLE app_platform_org_catalog_ro");
  const session:TenantSession={query:async<R>(sql:string,params?:readonly unknown[])=>({rows:(await c.query(sql,params?[...params]:undefined)).rows as R[]})};
  try{const result=await fn(session);await c.query("COMMIT");return result;}catch(error){await c.query("ROLLBACK");throw error;}
 })};
 return new PgPlatformOrganizationRepository(db,catalog);
}

it("current ordinary no-license catalog reads preserve actual wallet and strict summary",async()=>{
 const {platformOrganizations:C}=await import("@repo/contracts");
 await asOwner(async c=>{await c.query("UPDATE organization_plans SET plan='ordinary' WHERE org_id=$1",[org]);await c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance,total_purchased,total_granted) VALUES('team',$1,12.34,8,4.34)",[org]);});
 const repo=await platformSummaryRepository();const detail=C.operations.getOrganization.out.parse(await repo.detail(org,"operator"));
 expect(detail.organization.plan).toMatchObject({plan:"ordinary",enforcement:"active",billingGeneration:generation});
 expect(detail.organization.billingSummary).toMatchObject({orgId:org,generation,planVersion:1,memberCount:detail.organization.memberCount,licenseStatus:"none",teamPayment:null,creditGrant:{status:"none",grant:null},wallet:{balance:12.34,permanentBalance:12.34,totalPurchased:8,totalGranted:4.34}});
 const page=C.operations.listOrganizations.out.parse(await repo.list({search:String(org),limit:25},"operator"));expect(page.organizations[0]).toMatchObject({orgId:org,memberCount:detail.organization.memberCount,plan:detail.organization.plan,billingSummary:{licenseStatus:"none",wallet:detail.organization.billingSummary!.wallet}});
});
it("current ordinary paid-license catalog reads fail typed until the paid adapter exists",async()=>{
 await asOwner(async c=>{await c.query("UPDATE organization_plans SET plan='ordinary' WHERE org_id=$1",[org]);await c.query("INSERT INTO org_commercial_licenses(org_id,generation,purchased_seats) VALUES($1,$2,7)",[org,generation]);});
 const repo=await platformSummaryRepository();await expect(repo.detail(org,"operator")).rejects.toMatchObject({reasonCode:"PLATFORM_CATALOG_UNAVAILABLE"});
 await expect(repo.list({search:String(org),limit:25},"operator")).rejects.toMatchObject({reasonCode:"PLATFORM_CATALOG_UNAVAILABLE"});
});
