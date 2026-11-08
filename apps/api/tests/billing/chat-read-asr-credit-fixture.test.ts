// @global-scope-fixture table:credit_wallets: speaker is the existing controlled microphone fixture; no production account is used.
import {afterAll,beforeAll,expect,it} from "vitest";
import {seedChatReadAsrCreditTariff} from "../../scripts/chat-read-asr-credit-fixture";
import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {toOrgId} from "../../src/domain/org-id";
import {addOrgMember,asApp,asOwner,ensureDatabase,migrateOnce,resetOrgs,seedOrg} from "../support/db";
const org=toOrgId("chat-read-asr-credit-fixture"),other=toOrgId("chat-read-asr-credit-other");let db:PgDatabase;
beforeAll(async()=>{await ensureDatabase();await migrateOnce();await resetOrgs(org,other);await seedOrg({orgId:org,projectId:org+"-p"});await seedOrg({orgId:other,projectId:other+"-p"});await addOrgMember(org,"speaker","consultant",null);await asOwner(c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user','speaker',10) ON CONFLICT(owner_type,owner_id) DO UPDATE SET balance=10"));db=new PgDatabase(appConfig());});
afterAll(async()=>{await db?.close();await resetOrgs(org,other);});
it("requires the explicit controlled tenant and cannot be enabled from a foreign fixture tenant",async()=>{
 await expect(db.withTenant(org,s=>seedChatReadAsrCreditTariff(s,org,{}))).rejects.toThrow("FIXTURE_SCOPE_REQUIRED");
 await expect(db.withTenant(other,s=>seedChatReadAsrCreditTariff(s,other,{CHAT_E2E_FIXTURE:"1",CHAT_E2E_ORG_ID:org}))).rejects.toThrow("FIXTURE_SCOPE_REQUIRED");

});
it("admits the loopback microphone through the real credit ledger with an explicit native tariff",async()=>{
 const env={CHAT_E2E_FIXTURE:"1",CHAT_E2E_ORG_ID:org};
 await expect(db.withTenant(org,s=>seedChatReadAsrCreditTariff(s,org,env))).rejects.toMatchObject({code:"42501"});
 await asOwner(s=>seedChatReadAsrCreditTariff(s,org,env));await asOwner(s=>seedChatReadAsrCreditTariff(s,org,env));
 expect((await asApp(other,c=>c.query("SELECT quantum::text,hundredths_per_quantum::text FROM credit_global_native_tariffs WHERE model_provider='chat-read-loopback-asr'"))).rows).toEqual([{quantum:"1000",hundredths_per_quantum:"1"}]);
 await new PgTokenUsageRepository(db).startRequest(org,{requestId:"chat-read-asr-credit-start",userId:"speaker",runId:null,executionAttemptId:null,projectId:null,callPurpose:"native-asr",modelProvider:"chat-read-loopback-asr",modelId:"loopback-transcribe",startedAt:new Date().toISOString(),nativeMaximum:{unit:"millisecond",quantity:300000n}});
 expect((await asApp(org,c=>c.query("SELECT native_unit,native_quantum::text,native_rate::text,reserved_hundredths::text FROM credit_consumption_requests WHERE request_id='chat-read-asr-credit-start'"))).rows).toEqual([{native_unit:"millisecond",native_quantum:"1000",native_rate:"1",reserved_hundredths:"300"}]);
});
