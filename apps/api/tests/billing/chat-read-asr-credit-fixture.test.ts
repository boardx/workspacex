import {afterAll,beforeAll,expect,it} from "vitest";
import {seedChatReadAsrCreditTariff} from "../../scripts/chat-read-asr-credit-fixture";
import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {toOrgId} from "../../src/domain/org-id";
import {addOrgMember,asApp,ensureDatabase,migrateOnce,resetOrgs,seedOrg} from "../support/db";
const org=toOrgId("chat-read-asr-credit-fixture"),other=toOrgId("chat-read-asr-credit-other");let db:PgDatabase;
beforeAll(async()=>{await ensureDatabase();await migrateOnce();await resetOrgs(org,other);await seedOrg({orgId:org,projectId:org+"-p"});await seedOrg({orgId:other,projectId:other+"-p"});await addOrgMember(org,"speaker","consultant",null);db=new PgDatabase(appConfig());});
afterAll(async()=>{await db?.close();await resetOrgs(org,other);});
it("requires the explicit controlled tenant and leaves other tenants unpriced",async()=>{
 await expect(db.withTenant(org,s=>seedChatReadAsrCreditTariff(s,org,{}))).rejects.toThrow("FIXTURE_SCOPE_REQUIRED");
 await expect(db.withTenant(other,s=>seedChatReadAsrCreditTariff(s,other,{CHAT_E2E_FIXTURE:"1",CHAT_E2E_ORG_ID:org}))).rejects.toThrow("FIXTURE_SCOPE_REQUIRED");
 expect((await asApp(other,c=>c.query("SELECT * FROM credit_native_tariffs"))).rows).toEqual([]);
});
it("admits the loopback microphone through the real credit ledger with an explicit native tariff",async()=>{
 const env={CHAT_E2E_FIXTURE:"1",CHAT_E2E_ORG_ID:org};
 await db.withTenant(org,s=>seedChatReadAsrCreditTariff(s,org,env));await db.withTenant(org,s=>seedChatReadAsrCreditTariff(s,org,env));
 await new PgTokenUsageRepository(db).startRequest(org,{requestId:"chat-read-asr-credit-start",userId:"speaker",runId:null,executionAttemptId:null,projectId:null,callPurpose:"native-asr",modelProvider:"chat-read-loopback-asr",modelId:"loopback-transcribe",startedAt:new Date().toISOString(),nativeMaximum:{unit:"millisecond",quantity:300000n}});
 expect((await asApp(org,c=>c.query("SELECT native_unit,native_quantum::text,native_rate::text,reserved_hundredths::text FROM credit_consumption_requests WHERE request_id='chat-read-asr-credit-start'"))).rows).toEqual([{native_unit:"millisecond",native_quantum:"1000",native_rate:"1",reserved_hundredths:"300"}]);
});
