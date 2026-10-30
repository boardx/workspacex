import {beforeAll,afterAll,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asApp,asOwner} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {PgAiUsageRepository} from "../../src/infrastructure/auth/pg-ai-usage-repository";
import {PgIdentityRepository} from "../../src/infrastructure/identity/pg-identity-repository";
import {aiUsage as C} from "@repo/contracts";
import {toOrgId} from "../../src/domain/org-id";
const prefix="cusage-"+randomUUID().slice(0,8),user=prefix+"-self",other=prefix+"-other";
const orgs=["personal","team1","team2","foreign"].map(x=>toOrgId(prefix+"-"+x));
let db:PgDatabase,meter:PgTokenUsageRepository,repo:PgAiUsageRepository,identity:PgIdentityRepository;
const query=C.Query.parse({start:new Date(Date.now()-3600000).toISOString(),end:new Date(Date.now()+3600000).toISOString(),timezone:"Etc/UTC",limit:2});
// @global-scope-fixture table:credit_wallets: exact random fixture owner wallets are removed with their financial rows at teardown.
beforeAll(async()=>{ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());meter=new PgTokenUsageRepository(db);repo=new PgAiUsageRepository(db);identity=new PgIdentityRepository(db);
 for(const [i,org]of orgs.entries()){await seedOrg({orgId:org,projectId:org+"-p",...(i===0?{kind:"personal-local",ownerUserId:user}:{})});await addOrgMember(org,i===3?other:user,"admin",null);if(i>0&&i<3)await addOrgMember(org,other,"consultant",null);}
 await asApp(orgs[0]!,c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,1)",[user]));
 for(const [i,org]of orgs.entries())for(const [j,tokens]of [1,11].entries()){
  const actor=i===3?other:user,id=prefix+`-${i}-${j}`;
  await meter.startRequest(org,{requestId:id,userId:actor,runId:null,callPurpose:"auxiliary",executionAttemptId:null,projectId:null,modelProvider:"test",modelId:"voice",startedAt:new Date().toISOString(),maximumTokens:1000});
  await meter.record(org,{eventId:id,userId:actor,runId:null,modelProvider:"test",modelId:"voice",tokensTotal:tokens,promptTokens:tokens,completionTokens:0,totalSource:"reported",outcome:"succeeded"});
 }
 // Unknown usage is pending, never a settled free call.
 const id=prefix+"-unknown";await meter.startRequest(orgs[1]!,{requestId:id,userId:user,runId:null,callPurpose:"auxiliary",executionAttemptId:null,projectId:null,modelProvider:"test",modelId:"unknown",startedAt:new Date().toISOString()});
 await meter.record(orgs[1]!,{eventId:id,userId:user,runId:null,modelProvider:"test",modelId:"unknown",tokensTotal:0,promptTokens:null,completionTokens:null,totalSource:"unknown",outcome:"failed"});
});
afterAll(async()=>{await asOwner(async c=>{await c.query("DELETE FROM credit_consumption_requests WHERE org_id=ANY($1::text[])",[orgs]);await c.query("DELETE FROM organizations WHERE id=ANY($1::text[])",[orgs]);await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=ANY($1::text[]))",[[user,...orgs]]);await c.query("DELETE FROM credit_wallets WHERE owner_id=ANY($1::text[])",[[user,...orgs]]);});await db.close();});
it("uses per-request settled debit, distinguishes actor/payer and leaves unknown usage pending",async()=>{
 const out=await repo.summary(orgs[1]!,query);expect(out.current).toMatchObject({creditHundredths:"3",pendingCreditCalls:1});
 const calls=await repo.calls(orgs[1]!,{...query,limit:10,asOf:out.asOf});
 expect(calls.calls.find(x=>x.modelId==="unknown")).toMatchObject({creditStatus:"pending"});
 expect(calls.calls.filter(x=>x.modelId==="voice").map(x=>x.creditHundredths).sort()).toEqual(["1","2"]);
 expect(calls.calls.every(x=>x.payer?.ownerType==="team"&&x.payer.ownerId===orgs[1]&&x.userId===user)).toBe(true);
});
it("self scope spans verified memberships, excludes another actor and foreign tenant, binds cursors to filters",async()=>{
 const {SelfAiUsageService}=await import("../../src/application/auth/self-ai-usage-service");
 const self=new SelfAiUsageService(identity,repo),principal={userId:user,orgId:orgs[0]!};
 const out=await self.summary(principal,query);expect(out.current).toMatchObject({totalTokens:"36",creditHundredths:"9",callCount:7,pendingCreditCalls:1});
 const first=await self.calls(principal,{...query,asOf:out.asOf});expect(first.calls).toHaveLength(2);expect(first.nextCursor).not.toBeNull();
 const second=await self.calls(principal,{...query,asOf:out.asOf,cursorTime:first.nextCursor!.occurredAt,cursorId:first.nextCursor!.id});
 expect(second.calls.every(x=>!first.calls.some(y=>x.id===y.id)&&x.userId===user&&x.orgId!==orgs[3])).toBe(true);
 await expect(self.calls(principal,{...query,userId:other})).rejects.toMatchObject({reasonCode:"FORBIDDEN"});
 await expect(self.calls(principal,{...query,modelId:"changed",asOf:out.asOf,cursorTime:first.nextCursor!.occurredAt,cursorId:first.nextCursor!.id})).rejects.toThrow();
});
