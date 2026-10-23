import "reflect-metadata";
import {NativeCreditTariffController} from "../../src/interface/controllers/native-credit-tariff.controller";
import {NativeCreditTariffService,type NativeTariff} from "../../src/application/billing/native-credit-tariff-service";
import {afterAll,beforeAll,expect,it} from "vitest";
import {NestFactory,APP_GUARD} from "@nestjs/core";
import type {NestExpressApplication} from "@nestjs/platform-express";
import {ConsumptionSettingsController} from "../../src/interface/controllers/consumption-settings.controller";
import {ConsumptionSettingsService,type ConsumptionSettingsRepository} from "../../src/application/billing/consumption-settings-service";
import {PrincipalGuard} from "../../src/interface/guards/principal.guard";
import {PRINCIPAL_RESOLVER_PORT} from "../../src/application/ports/principal-resolver.port";
import {toOrgId} from "../../src/domain/org-id";
const orgId=toOrgId("credit-settings-org");
let enabled=false;const audit:string[]=[];
const store:ConsumptionSettingsRepository={read:async()=>({creditPreflightEnabled:enabled}),update:async(_org,user,value)=>{enabled=value.creditPreflightEnabled;audit.push(user);return value;}};
const service=new ConsumptionSettingsService(store,async user=>user==="operator");
let app:NestExpressApplication,base:string;
beforeAll(async()=>{
 app=await NestFactory.create<NestExpressApplication>({module:class SettingsFixture{},controllers:[ConsumptionSettingsController,NativeCreditTariffController],providers:[
 {provide:ConsumptionSettingsService,useValue:service},
 {provide:NativeCreditTariffService,useValue:new NativeCreditTariffService({list:async()=>[],upsert:async(_actor,input)=>input},async user=>user==="operator")},
 {provide:PRINCIPAL_RESOLVER_PORT,useValue:{resolve:async(headers:Record<string,string>)=>headers.authorization?{userId:headers.authorization.replace("Bearer ",""),orgId}:null}},
 {provide:APP_GUARD,useClass:PrincipalGuard},
 ]},{logger:false,abortOnError:false});
 await app.listen(0,"127.0.0.1");const address=app.getHttpServer().address();if(!address||typeof address==="string")throw new Error("no fixture address");base=`http://127.0.0.1:${address.port}`;
});
afterAll(async()=>app?.close());
const call=(path:string,user?:string,body?:unknown)=>fetch(base+path,{method:body?"PATCH":"GET",headers:{...(user?{Authorization:`Bearer ${user}`} : {}),"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
it("requires authentication for the nonsecret setting",async()=>{
 expect((await call('/billing/consumption/settings')).status).toBe(401);
 const response=await call('/billing/consumption/settings','member');expect(response.status).toBe(200);expect(await response.json()).toEqual({creditPreflightEnabled:false});
});
it("only platform operators may inspect platform settings or change the switch",async()=>{
 expect((await call('/platform/billing/consumption/settings','member')).status).toBe(403);
 expect((await call('/platform/billing/consumption/settings','member',{creditPreflightEnabled:true})).status).toBe(403);
 expect(audit).toEqual([]);
 const response=await call('/platform/billing/consumption/settings','operator',{creditPreflightEnabled:true});
 expect(response.status).toBe(200);expect(await response.json()).toEqual({creditPreflightEnabled:true});expect(audit).toEqual(['operator']);
 expect(await (await call('/billing/consumption/settings','member')).json()).toEqual({creditPreflightEnabled:true});
});
it("rejects coerced booleans and arbitrary settings without writing",async()=>{
 for(const body of [{creditPreflightEnabled:'false'},{creditPreflightEnabled:true,ownerId:'other'}])expect((await call('/platform/billing/consumption/settings','operator',body)).status).toBe(400);
 expect(audit).toEqual(['operator']);
});

it("tariff routes authenticate operators and validate native pricing before writes",async()=>{
 const path='/platform/billing/consumption/native-tariffs';
 expect((await call(path+'?orgId='+orgId)).status).toBe(401);
 expect((await call(path+'?orgId='+orgId,'member')).status).toBe(403);
 expect((await call(path+'?orgId='+orgId,'operator')).status).toBe(200);
 const body:NativeTariff={orgId,modelProvider:'openai',modelId:'image',unit:'image',quantum:'1',hundredthsPerQuantum:'25',version:'v1'};
 const put=(user:string,value:unknown)=>fetch(base+path,{method:'PUT',headers:{Authorization:'Bearer '+user,'Content-Type':'application/json'},body:JSON.stringify(value)});
 expect((await put('member',body)).status).toBe(403);
 expect((await put('operator',{...body,quantum:'0'})).status).toBe(400);
 const response=await put('operator',body);expect(response.status).toBe(200);expect(await response.json()).toEqual(body);
});
