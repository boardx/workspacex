import {BailianVisionExtractor} from "../../src/infrastructure/chat/bailian-vision-extractor";
// @global-scope-fixture table:credit_wallets: team fixture wallet and transactions are explicitly removed in afterAll.
import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {ensureDatabase,migrateOnce,seedOrg,asApp,asOwner} from '../support/db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgTokenUsageRepository} from '../../src/infrastructure/auth/pg-token-usage-repository';
import {ConfiguredModelProvider} from '../../src/infrastructure/agent-run/configured-model-provider';
import {creditModelGateway} from '../../src/infrastructure/billing/credit-model-gateway';
import {withCreditSubject} from '../../src/application/billing/credit-execution-context';
import {toOrgId} from '../../src/domain/org-id';
const org=toOrgId('credit-model-pg'),user='credit-model-pg-user',db=new PgDatabase(appConfig());
let server:Server,baseUrl:string,dispatches=0;
const policy=(enabled:boolean)=>asApp(org,s=>s.query('UPDATE credit_consumption_settings SET credit_preflight_enabled=$1 WHERE singleton',[enabled]));
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();await seedOrg({orgId:org,projectId:'credit-model-pg-project'});
 await asApp(org,s=>s.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'admin')",[org,user]));
 server=createServer((request,response)=>{dispatches++;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(request.url?.includes('multimodal-generation')?{output:{text:'image description'},usage:{total_tokens:11,input_tokens:6,output_tokens:5}}:{choices:[{message:{content:'paid answer'}}],usage:{total_tokens:11,prompt_tokens:6,completion_tokens:5}}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));baseUrl=`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(async()=>{await policy(false);await asOwner(async s=>{await s.query('DELETE FROM credit_consumption_requests WHERE org_id=$1',[org]);await s.query("DELETE FROM credit_transactions WHERE wallet_id IN(SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1)",[org]);await s.query("DELETE FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org]);});await db.close();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));});
it('zero-credit preflight blocks HTTP; funded reported usage and receipt replay debit exactly once',async()=>{
 const usage=new PgTokenUsageRepository(db),record=vi.spyOn(usage,'record');
 const model=creditModelGateway(new ConfiguredModelProvider({provider:'credit-loopback',baseUrl,apiKey:['local','fixture'].join('-'),timeoutMs:2000,streamEnabled:false,visionModelIds:new Set(),thinkingDisableModelIds:new Set(),bailianExtensionsEnabled:false}),db,usage);
 const call=()=>withCreditSubject({orgId:org,userId:user},()=>model.complete({modelProvider:'credit-loopback',modelId:'test-model',system:'system',user:'question'}));
 await policy(true);
 await expect(call()).rejects.toMatchObject({code:'credit_required',ownerType:'team',ownerId:org});expect(dispatches).toBe(0);
 await asApp(org,s=>s.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('team',$1,10) ON CONFLICT(owner_type,owner_id) DO UPDATE SET balance=10",[org]));
 expect(await call()).toMatchObject({text:'paid answer',tokens:11});expect(dispatches).toBe(1);
 const receipt=record.mock.calls[0]![1];expect(receipt).toMatchObject({tokensTotal:11,totalSource:'reported'});
 await usage.record(org,receipt);
 const facts=await asApp(org,async s=>({wallet:(await s.query("SELECT balance::text,held_hundredths::text FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org])).rows[0],transactions:(await s.query("SELECT credits::text,balance_after::text FROM credit_transactions WHERE source_type='model_request' AND source_id=$1",[receipt.eventId])).rows,receipts:(await s.query('SELECT id FROM token_usage_events WHERE org_id=$1 AND id=$2',[org,receipt.eventId])).rows}));
 expect(facts.wallet).toEqual({balance:'9.98',held_hundredths:'0'});expect(facts.transactions).toEqual([{credits:'0.02',balance_after:'9.98'}]);expect(facts.receipts).toHaveLength(1);expect(dispatches).toBe(1);
});

it('the actual VLM HTTP boundary is blocked at zero and consumes reported tokens when funded',async()=>{
 const usage=new PgTokenUsageRepository(db),record=vi.spyOn(usage,'record');
 const vision=new BailianVisionExtractor({apiKey:'fixture',modelId:'vision-loopback',baseUrl,timeoutMs:2000,maxImageBytes:100,maximumInputTokens:100},usage);
 const call=()=>withCreditSubject({orgId:org,userId:user},()=>vision.describeImage(new Uint8Array([1,2]),'image/png'));
 await policy(true);await asApp(org,s=>s.query("UPDATE credit_wallets SET balance=0 WHERE owner_type='team' AND owner_id=$1",[org]));
 const before=dispatches;await expect(call()).rejects.toMatchObject({code:'credit_required'});expect(dispatches).toBe(before);
 await asApp(org,s=>s.query("UPDATE credit_wallets SET balance=10 WHERE owner_type='team' AND owner_id=$1",[org]));
 expect(await call()).toMatchObject({ok:true});expect(dispatches).toBe(before+1);
 const receipt=record.mock.calls[0]![1];expect(receipt).toMatchObject({modelProvider:'dashscope-vision',tokensTotal:11,totalSource:'reported'});
 await usage.record(org,receipt);
 const balance=await asApp(org,async s=>(await s.query("SELECT balance::text FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org])).rows[0]);
 expect(balance).toEqual({balance:'9.98'});expect(dispatches).toBe(before+1);
});

it('pre-dispatch observer rejection releases each hold and keeps the typed refusal',async()=>{
 await policy(true);await asApp(org,s=>s.query("UPDATE credit_wallets SET balance=10 WHERE owner_type='team' AND owner_id=$1",[org]));
 const usage=new PgTokenUsageRepository(db),before=dispatches;
 const model=creditModelGateway(new ConfiguredModelProvider({provider:'credit-loopback',baseUrl,apiKey:['local','fixture'].join('-'),timeoutMs:2000,streamEnabled:false,visionModelIds:new Set(),thinkingDisableModelIds:new Set(),bailianExtensionsEnabled:false}),db,usage);
 const {CreditConsumptionError}=await import('../../src/application/billing/credit-consumption');const refusal=new CreditConsumptionError('credit_required','team',org);
 for(let index=0;index<2;index++)await expect(withCreditSubject({orgId:org,userId:user},()=>model.complete({modelProvider:'credit-loopback',modelId:'test-model',system:'system',user:'question',onProviderRequest:async()=>{throw refusal;}}))).rejects.toBe(refusal);
 const wallet=await asApp(org,async s=>(await s.query("SELECT balance::text,held_hundredths::text FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org])).rows[0]);
 expect(wallet).toEqual({balance:'10.00',held_hundredths:'0'});expect(dispatches).toBe(before);
});
