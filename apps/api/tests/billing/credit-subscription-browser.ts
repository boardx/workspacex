// @global-scope-fixture table:billing_subscriptions: exact order-fixture user; parent fixture cleanup deletes its snapshot between cases and on teardown.
/** Real browser + Billing/usage HTTP + PostgreSQL. Identity and model provider are
 * isolated fixtures. Period is seeded through the shared grant helper; signed
 * Stripe grant verification is covered by stripe-webhook.test.ts, not claimed here.
 */
import {expect} from "vitest";
import type {Page} from "playwright";
import {createServer} from "node:http";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {asOwner,seedOrg,addOrgMember} from "../support/db";
import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {DATABASE_PORT,type DatabasePort} from "../../src/application/ports/database.port";
import {grantPaidSubscriptionPeriod} from "../../src/infrastructure/billing/pg-credit-periods";
import {toOrgId} from "../../src/domain/org-id";
import {user,other,org} from "./order-fixture";
import type {notifyFixture} from "./wechat-notify-fixture";
export async function verifyCreditSubscriptionBrowser(f:Awaited<ReturnType<typeof notifyFixture>>,page:Page,origin:string,evidence:string){
 const personal=toOrgId("f04-order-personal-credits");
 await seedOrg({orgId:personal,kind:"personal-local",ownerUserId:user,projectId:personal+"-p"});
 await addOrgMember(personal,user,"admin",null);
 const db=f.app.get<DatabasePort>(DATABASE_PORT),meter=new PgTokenUsageRepository(db);
 let modelCalls=0,loopback="";
 const server=createServer(async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Access-Control-Allow-Headers","content-type");
  if(req.method==="OPTIONS"){res.end();return;}
  if(req.url?.startsWith("/provider?")){modelCalls++;res.setHeader("content-type","application/json");res.end(JSON.stringify({tokens:Number(new URL(req.url,loopback).searchParams.get("tokens"))}));return;}
  try{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const input=JSON.parse(Buffer.concat(chunks).toString());
   if(![personal,org].includes(input.org)||!Number.isSafeInteger(input.tokens)||input.tokens<0||input.tokens>2000000)throw Error("fixture_input_invalid");
   const context=toOrgId(input.org),id="browser-credit-"+randomUUID(),at=new Date().toISOString();
   await meter.startRequest(context,{requestId:id,userId:user,runId:null,callPurpose:"auxiliary",executionAttemptId:null,projectId:null,modelProvider:"loopback-voice",modelId:"voice-credit",startedAt:at,maximumTokens:input.tokens});
   const actual=await(await fetch(`${loopback}/provider?tokens=${input.tokens}`)).json();
   await meter.record(context,{eventId:id,userId:user,runId:null,callPurpose:"auxiliary",modelProvider:"loopback-voice",modelId:"voice-credit",tokensTotal:actual.tokens,promptTokens:actual.tokens,completionTokens:0,totalSource:"reported",outcome:"succeeded",requestStartedAt:at});
   res.end(JSON.stringify({completed:true}));
  }catch(error){res.statusCode=(error as {code?:string}).code==="credit_required"?409:500;res.end(JSON.stringify({code:(error as {code?:string}).code??"fixture_failed"}));}
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();if(!address||typeof address==="string")throw Error("listener");loopback=`http://127.0.0.1:${address.port}`;
 const call=(orgId:string,tokens:number)=>page.evaluate(async({url,orgId,tokens})=>{const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({org:orgId,tokens})});return {status:r.status,body:await r.json()};},{url:loopback,orgId,tokens});
 try{
  // Caller already completed an actual signed loopback merchant recharge through UI.
  // Keep grant alive through cold Next compilation; expire this exact fixture only after consumption assertions.
  const end=new Date(Date.now()+3600000);
  await db.withTenant(personal,s=>grantPaidSubscriptionPeriod(s,{userId:user,subscriptionRef:"sub_browserCredits",invoiceRef:"in_browserCredits",planRef:"price_browserMonthly",periodStart:new Date(end.getTime()-30*86400000),periodEnd:end}));
  // The subscription card reads its verified snapshot, separately from wallet grants.
  await asOwner(c=>c.query("INSERT INTO billing_subscriptions(user_id,subscription_ref,status,plan_ref,current_period_end) VALUES($1,$2,'active',$3,$4)",[user,"sub_browserCredits","price_browserMonthly",end]));
  await page.keyboard.press("Escape");await page.reload();
  await expect.poll(()=>page.getByRole("progressbar",{name:"本期剩余 credit"}).getAttribute("value")).toBe("20000");
  expect((await call(personal,1000)).status).toBe(200);
  await page.reload();await expect.poll(()=>page.getByRole("progressbar",{name:"本期剩余 credit"}).getAttribute("value")).toBe("19999");
  await page.screenshot({path:resolve(evidence,"monthly-balance.png"),fullPage:true});
  await asOwner(c=>c.query("UPDATE credit_subscription_periods SET period_end=now()-interval '1 second' WHERE subscription_ref=$1 AND wallet_id IN(SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$2)",["sub_browserCredits",user]));
  await expect.poll(async()=>((await(await f.request("/billing/wallet?ownerType=user")).json()).wallet.subscriptionCredits),{timeout:30000,interval:500}).toBe(0);
  await page.reload();await expect.poll(()=>page.getByTestId("billing-wallet-balance").textContent()).toBe("1,320 credit");
  expect((await call(personal,1321000)).status).toBe(200);const admitted=modelCalls;
  expect(await call(personal,1)).toMatchObject({status:409,body:{code:"credit_required"}});expect(modelCalls).toBe(admitted);
  await page.reload();await expect.poll(()=>page.getByTestId("billing-wallet-balance").textContent()).toContain("-1");
  await page.screenshot({path:resolve(evidence,"personal-debt.png"),fullPage:true});
  expect((await call(org,2000)).status).toBe(200);expect((await call(org,1000)).status).toBe(200);expect(modelCalls).toBe(admitted+2);
  await page.goto(`${origin}/billing?ownerType=team&ownerId=${org}`);
  await expect.poll(()=>page.getByText(/组织可继续使用/).count()).toBe(1);
  await page.screenshot({path:resolve(evidence,"enterprise-debt.png"),fullPage:true});
  const query=new URLSearchParams({start:new Date(Date.now()-3600000).toISOString(),end:new Date(Date.now()+3600000).toISOString(),timezone:"Etc/UTC",userId:other});
  expect((await f.request(`/billing/usage?${query}`)).status).toBe(403);
  query.set("userId",user);expect((await f.request(`/organizations/${org}/ai-usage?${query}`,undefined,"f04-other")).status).toBe(403);
  await page.goto(`${origin}/usage`);await expect.poll(()=>page.getByText("1,325.00 credit").count()).toBe(1);
  await page.getByRole("tab",{name:"调用明细"}).click();
  await expect.poll(()=>page.getByText("个人账户",{exact:true}).count()).toBeGreaterThan(0);
  await expect.poll(()=>page.getByText("组织账户 · F04 A",{exact:true}).count()).toBeGreaterThan(0);
  await page.screenshot({path:resolve(evidence,"self-credit-usage.png"),fullPage:true});
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await asOwner(async c=>{await c.query("DELETE FROM credit_consumption_requests WHERE org_id=$1",[personal]);await c.query("DELETE FROM organizations WHERE id=$1",[personal]);});}
}
