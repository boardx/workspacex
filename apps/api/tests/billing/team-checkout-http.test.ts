import "reflect-metadata";
import {randomUUID,generateKeyPairSync,createPublicKey,sign,verify} from "node:crypto";
import {beforeAll,afterAll,expect,it,vi} from "vitest";
import {APP_GUARD,NestFactory} from "@nestjs/core";
import type {INestApplication} from "@nestjs/common";
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asOwner} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {PgIdentityRepository} from "../../src/infrastructure/identity/pg-identity-repository";
import {toOrgId} from "../../src/domain/org-id";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import {TeamCatalog,TeamQuote,TeamPurchaseOutcome} from "@repo/contracts/billing-team";
import {TeamAccountService} from "../../src/application/billing/team-account-service";
import {TeamBillingAccess} from "../../src/application/billing/team-billing-access";
import {TeamCheckoutService} from "../../src/application/billing/team-checkout-service";
import {PgTeamAccountRepository} from "../../src/infrastructure/billing/pg-team-account-repository";
import {PgTeamQuoteRepository} from "../../src/infrastructure/billing/pg-team-quote-repository";
import {PgTeamCheckoutRepository} from "../../src/infrastructure/billing/pg-team-checkout-repository";
import {PgTeamPaymentRepository} from "../../src/infrastructure/billing/pg-team-payment-repository";
import {TeamWechatCheckoutClient} from "../../src/infrastructure/billing/team-wechat-checkout-client";
import {TeamWechatPaymentClient} from "../../src/infrastructure/billing/team-wechat-payment-client";
import {TeamPaymentReconciler} from "../../src/infrastructure/billing/team-payment-reconciler";
import {TeamBillingController} from "../../src/interface/controllers/team-billing.controller";
import {DeploymentBillingConfig} from "../../src/infrastructure/billing/deployment-billing-config";
import {PrincipalGuard} from "../../src/interface/guards/principal.guard";
import {PRINCIPAL_RESOLVER_PORT} from "../../src/application/ports/principal-resolver.port";
import {AllExceptionsFilter} from "../../src/interface/filters/all-exceptions.filter";
const org=toOrgId(`team-http-${randomUUID().slice(0,8)}`),user=`${org}-admin`,member=`${org}-member`,sku=`${org}-sku`,db=new PgDatabase(appConfig());
let app:INestApplication,base:string,paid=false,corruptSignature=false,actualPaidAt:string|undefined,wire:Record<string,unknown>|null=null,creates=0;
const originalFetch=globalThis.fetch,key=generateKeyPairSync("rsa",{modulusLength:2048}).privateKey,platformKey=generateKeyPairSync("rsa",{modulusLength:2048}).privateKey;
const config=new DeploymentBillingConfig({BILLING_DEPLOYMENT:"cn",WECHAT_PAY_APP_ID:"wx-team",WECHAT_PAY_MCH_ID:"1900000000",WECHAT_PAY_API_V3_KEY:"01234567890123456789012345678901",WECHAT_PAY_MCH_SERIAL_NO:"ABC123",WECHAT_PAY_PRIVATE_KEY:key.export({type:"pkcs8",format:"pem"}).toString(),WECHAT_PAY_NOTIFY_URL:"https://example.test/wechat",WECHAT_PAY_PLATFORM_KEY_ID:"PUB_KEY_ID_TEAM",WECHAT_PAY_PLATFORM_PUBLIC_KEY:createPublicKey(platformKey).export({type:"spki",format:"pem"}).toString()});
function signed(value:unknown){const raw=JSON.stringify(value),timestamp=String(Math.floor(Date.now()/1000)),nonce="http-team-fixture";return new Response(raw,{headers:{"Wechatpay-Timestamp":timestamp,"Wechatpay-Nonce":nonce,"Wechatpay-Serial":"PUB_KEY_ID_TEAM","Wechatpay-Signature":corruptSignature?"invalid":sign("RSA-SHA256",Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`),platformKey).toString("base64")}});}
// @global-scope-fixture table:credit_packages: owned sku above is removed in afterAll; no existing product is updated.
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();await seedOrg({orgId:org,kind:"organization",projectId:`${org}-project`});await addOrgMember(org,user,"admin",null);await addOrgMember(org,member,"consultant",null);
 await asOwner(async c=>{await c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true",[generation]);await c.query("INSERT INTO credit_packages(package_id,region,currency,amount_fen,base_credits,total_credits,owner_type,product_kind,billing_cycle,included_seats,extra_seat_amount_fen,extra_seat_monthly_credits) VALUES($1,'cn','CNY',43210,100000,100000,'team','subscription','year',5,1700,15000)",[sku]);});
 vi.stubGlobal("fetch",vi.fn(async(url:string|URL|Request,options?:RequestInit)=>{
  if(!String(url).startsWith("https://api.mch.weixin.qq.com/"))return originalFetch(url,options);
  const authorization=new Headers(options?.headers).get("Authorization")??"",parts=Object.fromEntries([...authorization.matchAll(/(\w+)="([^"]+)"/g)].map(m=>[m[1],m[2]]));
  const endpoint=new URL(String(url)),canonical=`${options?.method??"GET"}\n${endpoint.pathname}${endpoint.search}\n${parts.timestamp}\n${parts.nonce_str}\n${options?.body??""}\n`;
  if(!verify("RSA-SHA256",Buffer.from(canonical),createPublicKey(key),Buffer.from(parts.signature??"","base64")))throw Error("fixture_merchant_signature_invalid");
  if(options?.method==="POST"){creates++;wire=JSON.parse(String(options.body));return signed({code_url:"weixin://wxpay/bizpayurl?pr=team-http"});}
  return signed({appid:"wx-team",mchid:"1900000000",out_trade_no:wire?.out_trade_no,attach:wire?.attach,trade_state:paid?"SUCCESS":"NOTPAY",transaction_id:`${org.replaceAll("-","")}`,success_time:actualPaidAt,amount:wire?.amount});
 }));
 const logger={info:vi.fn(),error:vi.fn()},access=new TeamBillingAccess(new PgIdentityRepository(db)),purchases=new PgTeamCheckoutRepository(db,access,()=>true),provider=new TeamWechatCheckoutClient(config,logger);
 const service=new TeamAccountService(new PgTeamAccountRepository(db,access,()=>true,()=>"cn"),new PgTeamQuoteRepository(db,access,()=>true,undefined,()=>"cn"),purchases,new TeamCheckoutService(purchases,provider),new TeamPaymentReconciler(db,new TeamWechatPaymentClient(config,logger),new PgTeamPaymentRepository(db)));
 app=await NestFactory.create({module:class Fixture{},controllers:[TeamBillingController],providers:[{provide:TeamAccountService,useValue:service},{provide:PRINCIPAL_RESOLVER_PORT,useValue:{resolve:async(headers:Record<string,string>)=>headers.authorization==="Bearer admin"?{userId:user,orgId:org}:headers.authorization==="Bearer member"?{userId:member,orgId:org}:null}},{provide:APP_GUARD,useClass:PrincipalGuard}]},{logger:false});
 app.useGlobalFilters(new AllExceptionsFilter(logger,{record:vi.fn(),list:vi.fn(),getLifecycle:vi.fn(),updateLifecycle:vi.fn()}));await app.listen(0,"127.0.0.1");base=await app.getUrl();
});
afterAll(async()=>{
 await app?.close();vi.unstubAllGlobals();await asOwner(async c=>{
  await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1)",[org]);await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='team' AND owner_id=$1)",[org]);await c.query("DELETE FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[org]);
  for(const t of ["billing_team_receipts","billing_team_terms","billing_team_purchases","billing_team_quotes","org_commercial_licenses"])await c.query(`DELETE FROM ${t} WHERE org_id=$1`,[org]);
  await c.query("DELETE FROM credit_packages WHERE package_id=$1",[sku]);await c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true");
 });await db.close();
});
const url=(part:string)=>`${base}/billing/organizations/${org}/${part}`;
async function get(part:string,token="admin"){return fetch(url(part),{headers:token?{authorization:`Bearer ${token}`}:{}});}
async function post(part:string,body:unknown){return fetch(url(part),{method:"POST",headers:{authorization:"Bearer admin","content-type":"application/json"},body:JSON.stringify(body)});}
it("uses real PrincipalGuard and actual target membership and denies client financial fields",async()=>{
 expect((await get("catalog","")).status).toBe(401);const denied=await get("catalog","member");expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({code:"forbidden",traceId:expect.any(String)});
 const catalog=TeamCatalog.parse(await (await get("catalog")).json());
 const request={purpose:"initial",sku,catalogVersion:catalog.version,provider:"wechat",expectedPlanVersion:0,seats:7};
 expect((await post("quotes",{...request,amountMinor:1})).status).toBe(400);expect(creates).toBe(0);
});
it("quotes configured total, creates one durable Native checkout, and recovers signed real payment",async()=>{
 const catalog=TeamCatalog.parse(await (await get("catalog")).json());
 const quoted=await post("quotes",{purpose:"initial",sku,catalogVersion:catalog.version,provider:"wechat",expectedPlanVersion:0,seats:7});expect(quoted.status).toBe(201);
 const quote=TeamQuote.parse(await quoted.json());expect(quote).toMatchObject({amountMinor:46610,seats:7,monthlyCredits:130000,billingCycle:"year"});
 const input={quoteRef:quote.quoteRef,idempotencyKey:`http-${randomUUID()}`};
 const created=await post("checkout",input);expect(created.status).toBe(201);expect(created.headers.get("cache-control")).toContain("no-store");
 const pending=TeamPurchaseOutcome.parse(await created.json());expect(pending.status).toBe("PENDING");
 expect(TeamPurchaseOutcome.parse(await (await post("checkout",input)).json()).purchaseRef).toBe(pending.purchaseRef);expect(creates).toBe(1);
 const conflict=await post("checkout",{...input,quoteRef:"different-quote"});expect(conflict.status).toBe(409);expect(await conflict.json()).toMatchObject({code:"idempotency_conflict",traceId:expect.any(String)});
 corruptSignature=true;try{const unavailable=await get(`purchases/${pending.purchaseRef}`);expect(unavailable.status).toBe(503);expect(await unavailable.json()).toMatchObject({code:"dependency_unavailable",traceId:expect.any(String)});}finally{corruptSignature=false;}
 paid=true;actualPaidAt=new Date().toISOString();const recovered=TeamPurchaseOutcome.parse(await (await get(`purchases/${pending.purchaseRef}`)).json());
 expect(recovered.status).toBe("SUCCESS");expect(recovered.fulfillment?.firstCreditsApplied).toBe(130000);
 const entitlement=await (await get("entitlement")).json();expect(entitlement).toMatchObject({licenseStatus:"active",memberCount:2,teamPayment:{term:{purchasedSeats:7,monthlyCredits:130000}},wallet:{ownerType:"team",ownerId:org,subscriptionCredits:130000}});
});
