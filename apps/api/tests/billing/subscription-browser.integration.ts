// @global-scope-fixture table:billing_purchase_intents: historical stripe-browser-user fixture; cleanup removes this exact owner.
/** Real production page -> Billing HTTP -> isolated PG -> signed Stripe webhook -> page read.
 * Only identity chrome and the independent provider are controlled; billing HTTP is never intercepted.
 */
import "reflect-metadata";
import {json} from "express";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { createHmac, createHash, randomBytes } from "node:crypto";
import { createServer as httpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { NestFactory, APP_GUARD } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { chromium, type Browser } from "playwright";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { BillingModule } from "../../src/billing.module";
import { DATABASE_PORT, type DatabasePort } from "../../src/application/ports/database.port";
import { PRINCIPAL_RESOLVER_PORT } from "../../src/application/ports/principal-resolver.port";
import { PrincipalGuard } from "../../src/interface/guards/principal.guard";
import { registerBillingRawBodyParser } from "../../src/interface/middleware/billing-raw-body-parser";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";
import { BILLING_ENV_KEYS } from "../../src/infrastructure/billing/deployment-billing-config";
import { toOrgId } from "../../src/domain/org-id";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";
let app: NestExpressApplication | undefined, server: Server | undefined, browser: Browser | undefined;
let web: ChildProcess | undefined, webClosed: Promise<void> | undefined, closed = false, spawnError: Error | undefined, output = "";
const user="stripe-browser-user", org="stripe-browser-org", secret=`whsec_${randomBytes(24).toString("hex")}`;
const port=Number(process.env.WORKSPACEX_WEB_PORT), origin=`http://127.0.0.1:${port}`, webRoot=resolve(import.meta.dirname,"../../../web");
const evidence=process.env.BILLING_BROWSER_EVIDENCE_DIR || resolve(import.meta.dirname,"../../test-results/billing-stripe");
let creditSession:Record<string,unknown>|null=null;
let monthlySession:Record<string,unknown>|null=null;
let base="", status="active", token="", cancelAtPeriodEnd=false;
const providerCalls: {path:string;body:string}[]=[];
async function cleanup() { await asOwner(async c=> {
  await c.query("DELETE FROM billing_payment_conflicts WHERE user_id=$1",[user]);
  await c.query("DELETE FROM billing_monthly_orders WHERE user_id=$1",[user]);
  await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=$1)",[user]);
  await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=$1)",[user]);
  await c.query("DELETE FROM billing_orders WHERE owner_type='user' AND owner_id=$1",[user]);
  await c.query("DELETE FROM credit_wallets WHERE owner_id=$1",[user]);
  await c.query("DELETE FROM billing_stripe_bindings WHERE user_id=$1",[user]);
  await c.query("DELETE FROM billing_stripe_reconciliation WHERE provider_event_id LIKE 'evt_browser_%'");
  await c.query("DELETE FROM billing_webhook_events WHERE provider_event_id LIKE 'evt_browser_%'");
  await c.query("DELETE FROM billing_purchase_intents WHERE user_id=$1",[user]);
  await c.query("DELETE FROM billing_subscriptions WHERE user_id=$1",[user]);
}); }
async function callback(type:string,id:string,signature=true) {
 const body=JSON.stringify({id,object:"event",type,data:{object:{id:type==="checkout.session.completed"?"cs_browser":"sub_browser"}}});
 const timestamp=Math.floor(Date.now()/1000), digest=createHmac("sha256",secret).update(`${timestamp}.${body}`).digest("hex");
 return fetch(`${base}/billing/webhooks/stripe`,{method:"POST",headers:{"content-type":"application/json","stripe-signature":`t=${timestamp},v1=${signature?digest:"0".repeat(64)}`},body});
}
function outputTail() { return output.slice(-16000); }
async function assertAllocatedPortFree() {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error("Allocated web port is occupied; no existing listener will be reused or killed")));
    probe.listen(port, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve()));
  });
}
async function waitForServer() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (closed) throw new Error(`Owned Next exited before readiness: ${outputTail()}`);
    if (!output.replace(/\u001b\[[0-9;]*m/g, "").includes("Ready in")) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
    try { const response = await fetch(`${origin}/billing`, { signal: AbortSignal.timeout(5000) }); if (response.ok && !closed && !spawnError) return; } catch { /* Owned server may still be compiling. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Owned Next readiness timed out: ${outputTail()}`);
}
async function stopWeb() {
  if (!web || !webClosed) return;
  const groupAlive = () => {
    if (!web?.pid) return false;
    try { process.kill(process.platform === "win32" ? web.pid : -web.pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      let snapshot = "unavailable";
      try { snapshot = execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,uid=,stat="], { encoding: "utf8" }).split("\n").filter(line => Number(line.trim().split(/\s+/)[2]) === web?.pid).join("\n"); } catch { /* Preserve the original permission failure. */ }
      // Darwin can reject kill(0) while the owned leader is a zombie awaiting
      // Node's child reaper. This is not a live group and must not be signalled.
      // Completion still requires the captured close event below; permission
      // failures with any other process-table evidence remain fatal.
      const members = snapshot.trim().split("\n").map(line => line.trim().split(/\s+/));
      if (process.platform === "darwin" && (error as NodeJS.ErrnoException).code === "EPERM" && members.length === 1) {
        const member = members[0]!;
        if (member.length === 5 && Number(member[0]) === web.pid && Number(member[2]) === web.pid && Number(member[3]) === process.getuid?.() && member[4]!.startsWith("Z")) return false;
      }
      throw new Error(`Owned Next group probe failed: pid=${web.pid} closed=${closed} exitCode=${web.exitCode} code=${(error as NodeJS.ErrnoException).code} members=${snapshot || "none"}`, { cause: error });
    }
  };
  const signal = (name: NodeJS.Signals) => { try { if (process.platform === "win32") web?.kill(name); else if (web?.pid) process.kill(-web.pid, name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } };
  const wait = async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { if (!groupAlive() && closed) { await webClosed; return true; } await new Promise(resolve => setTimeout(resolve, 50)); }
    return !groupAlive() && closed;
  };
  // A closed leader is insufficient: Next may still have owned workers in its group.
  if (groupAlive()) signal("SIGTERM");
  if (!await wait()) { if (groupAlive()) signal("SIGKILL"); if (!await wait()) throw new Error(`Owned Next process group did not stop: ${outputTail()}`); }
  await webClosed;
}

beforeAll(async()=> {
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error("Use the standard test isolation wrapper");
 ensureDatabase(); await migrateOnce(); await cleanup(); await assertAllocatedPortFree(); mkdirSync(evidence,{recursive:true});
 for(const key of BILLING_ENV_KEYS)vi.stubEnv(key,"");
 for(const [key,value]of Object.entries({BILLING_DEPLOYMENT:"devapp",STRIPE_SECRET_KEY:`sk_test_${randomBytes(16).toString("hex")}`,STRIPE_WEBHOOK_SECRET:secret,STRIPE_PAYMENT_LINK:"https://buy.stripe.com/browser",STRIPE_RETURN_URL:`${origin}/billing?subscription_return=1`}))vi.stubEnv(key,value);
 server=httpServer((req,res)=> { let body="";req.on("data",chunk=>body+=chunk);req.on("end",()=> {
  providerCalls.push({path:req.url!,body});
  if(req.headers["stripe-version"]!=="2025-09-30.clover"){res.writeHead(400);res.end("{}");return;}
  let value:unknown;
  if(req.url==="/v1/checkout/sessions"&&req.method==="POST") {
   const params=new URLSearchParams(body),id=params.get("client_reference_id");
   if(params.get("metadata[product]")==="credit_topup_v1")value=creditSession={id:"cs_browser_credit",object:"checkout.session",mode:"payment",status:"open",livemode:false,payment_status:"unpaid",amount_total:Number(params.get("line_items[0][price_data][unit_amount]")),currency:"cny",client_reference_id:id,metadata:{product:"credit_topup_v1",order_ref:id},url:"https://checkout.stripe.com/c/pay/credit-browser"};
   else value=monthlySession={id:"cs_browser_monthly",object:"checkout.session",mode:"payment",status:"open",livemode:false,payment_status:"unpaid",amount_total:18000,currency:"cny",client_reference_id:id,metadata:{product:"monthly_pass_v1",order_ref:id},url:"https://checkout.stripe.com/c/pay/monthly-browser"};
  }
  if(req.url==="/v1/checkout/sessions/cs_browser_credit")value=creditSession;
  if(req.url==="/v1/checkout/sessions/cs_browser_monthly")value=monthlySession;
  if(req.url==="/v1/checkout/sessions/cs_browser")value={id:"cs_browser",object:"checkout.session",mode:"subscription",status:"complete",customer:"cus_browser",subscription:"sub_browser",client_reference_id:token};
  if(req.url==="/v1/subscriptions/sub_browser")value={id:"sub_browser",object:"subscription",customer:"cus_browser",status,cancel_at_period_end:cancelAtPeriodEnd,trial_start:null,trial_end:null,items:{data:[{current_period_start:1893456000,current_period_end:1896134400,price:{id:"price_browser",recurring:{interval:"month"}}}],has_more:false}};
  if(req.url==="/v1/billing_portal/sessions")value={object:"billing_portal.session",customer:"cus_browser",url:"https://billing.stripe.com/p/session/browser"};
  res.setHeader("content-type","application/json");res.statusCode=value?200:500;res.end(JSON.stringify(value??{}));
 }); });
 await new Promise<void>(r=>server!.listen(0,"127.0.0.1",r));const address=server.address();if(!address||typeof address==="string")throw Error("provider listener");
 const nativeFetch=globalThis.fetch;vi.stubGlobal("fetch",(input:string|URL|Request,init?:RequestInit)=> {const url=new URL(input instanceof Request?input.url:String(input));return nativeFetch(url.origin==="https://api.stripe.com"?`http://127.0.0.1:${address.port}${url.pathname}`:input,init);});
 app=await NestFactory.create<NestExpressApplication>({module:class StripeBrowserRoot{},imports:[BillingModule],providers:[{provide:PRINCIPAL_RESOLVER_PORT,useValue:{resolve:async(headers:Record<string,string>)=>headers.authorization==="Bearer stripe-browser-session"?{userId:user,orgId:toOrgId(org)}:null}},{provide:APP_GUARD,useClass:PrincipalGuard}]},{logger:false,bodyParser:false});
 app.useGlobalFilters(new AllExceptionsFilter({info(){},error(){}}as never,{record:async()=>{}}as never));registerBillingRawBodyParser(app.getHttpAdapter().getInstance());app.use(json());
 await app.listen(0,"127.0.0.1");const local=app.getHttpServer().address();if(!local||typeof local==="string")throw Error("API listener");base=`http://127.0.0.1:${local.port}`;
 const require=createRequire(resolve(webRoot,"package.json"));const env={...process.env,NEXT_DIST_DIR:".next-billing-stripe-glue",NEXT_PUBLIC_API_URL:"/__fullstack_api",FULLSTACK_E2E_API_ORIGIN:base};
 for(const key of Object.keys(env))if(/^(WECHAT_PAY_|STRIPE_)/.test(key))delete(env as NodeJS.ProcessEnv)[key];
 web=spawn(process.execPath,[require.resolve("next/dist/bin/next"),"dev","--hostname","127.0.0.1","-p",String(port)],{cwd:webRoot,env,detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"]});
 const capture=(chunk:Buffer)=>{output=(output+chunk.toString()).slice(-1000000);};web.stdout?.on("data",capture);web.stderr?.on("data",capture);
 webClosed=new Promise<void>(r=>{web!.once("close",()=>{closed=true;r();});web!.once("error",e=>{closed=true;spawnError=e;r();});});
 await waitForServer();browser=await chromium.launch({headless:true});
},120000);
afterAll(async()=> {try {await browser?.close();}finally {try{await stopWeb();}finally{if(app){await app.close();await app.get<DatabasePort>(DATABASE_PORT).close();}if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));}await cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();mkdirSync(evidence,{recursive:true});writeFileSync(resolve(evidence,"next.log"),outputTail());}}},120000);
it("completes checkout through signed HTTP and PG, renders Pro, recovers billing and never gifts credits",async()=> {
 const page=await browser!.newPage({viewport:{width:1280,height:900}});
 await page.addInitScript(({user,org})=>{localStorage.setItem("wsx.sessionToken","stripe-browser-session");localStorage.setItem("wsx.session",JSON.stringify({version:1,userId:user,orgs:[org],currentOrgId:org,expiresAt:"2099-01-01T00:00:00Z"}));},{user,org});
 await page.route(url=>url.origin===origin&&url.pathname==="/__fullstack_api/identity/me",route=>route.fulfill({json:{org:{id:org,name:"本地支付验收",kind:"organization",team:null,modelPolicy:"any",avatarUrl:null},orgRole:"consultant",teamId:null,projectRole:null,groupId:null,displayName:"Stripe验收",avatarUrl:null}}));
 await page.route("https://buy.stripe.com/**",route=>route.fulfill({contentType:"text/html",body:"<h1>Controlled hosted checkout</h1>"}));
 await page.route("https://billing.stripe.com/**",route=>route.fulfill({contentType:"text/html",body:"<h1>Controlled hosted billing</h1>"}));
 // Simulate a previously issued recurring checkout; new sales use payment-mode Checkout.
 token=randomBytes(32).toString("base64url");await asOwner(c=>c.query("INSERT INTO billing_purchase_intents(intent_hash,user_id,expected_generation) VALUES($1,$2,0)",[createHash("sha256").update(token).digest("hex"),user]));
 expect((await callback("checkout.session.completed","evt_browser_forged",false)).status).toBe(400);
 expect((await asOwner(c=>c.query("SELECT * FROM billing_subscriptions WHERE user_id=$1",[user]))).rows).toEqual([]);
 expect((await callback("checkout.session.completed","evt_browser_checkout")).status).toBe(200);
 expect((await callback("checkout.session.completed","evt_browser_checkout")).status).toBe(200);
 await page.goto(`${origin}/billing?subscription_return=1`);
 await expect.poll(()=>page.getByTestId("billing-subscription-status").textContent()).toBe("使用中");
 expect(await page.getByTestId("billing-subscription-status").count()).toBe(1);await page.screenshot({path:resolve(evidence,"stripe-active.png"),fullPage:true});
 await page.getByRole("button",{name:"管理订阅",exact:true}).click();await page.waitForURL("https://billing.stripe.com/**");
 const portal=providerCalls.find(c=>c.path==="/v1/billing_portal/sessions");expect(new URLSearchParams(portal!.body).get("customer")).toBe("cus_browser");const returnUrl = new URLSearchParams(portal!.body).get("return_url")!;
 expect(returnUrl).toBe(`${origin}/billing?subscription_return=1&subscription_management_return=1`);
 await page.goto(returnUrl);
 await expect.poll(()=>page.getByTestId("billing-subscription-status").count()).toBe(1);
 cancelAtPeriodEnd=true;expect((await callback("customer.subscription.updated","evt_browser_cancel_scheduled")).status).toBe(200);
 await expect.poll(()=>page.getByText(/原订阅已停止续费/).count(),{timeout:12000}).toBe(1);
 expect(await page.getByTestId("billing-subscription-status").count()).toBe(1);
 await page.screenshot({path:resolve(evidence,"stripe-cancellation-scheduled.png"),fullPage:true});
 cancelAtPeriodEnd=false;expect((await callback("customer.subscription.updated","evt_browser_cancel_resumed")).status).toBe(200);
 status="past_due";expect((await callback("customer.subscription.updated","evt_browser_pastdue")).status).toBe(200);
 await page.goto(`${origin}/billing`);await expect.poll(()=>page.getByTestId("billing-subscription-status").textContent()).toBe("待处理");expect(await page.getByTestId("billing-subscription-status").count()).toBe(1);expect(await page.getByRole("button",{name:"购买月度套餐",exact:true}).count()).toBe(0);await page.screenshot({path:resolve(evidence,"stripe-billing-recovery.png"),fullPage:true});
 status="future_state";expect((await callback("customer.subscription.updated","evt_browser_unknown")).status).toBe(500);
 await page.getByRole("button",{name:"刷新状态",exact:true}).click();await expect.poll(()=>page.getByTestId("err-billing-subscription").count()).toBe(1);expect(await page.getByTestId("billing-subscription-status").count()).toBe(0);
 status="active";expect((await callback("customer.subscription.updated","evt_browser_unknown")).status).toBe(200);await page.getByRole("button",{name:"刷新状态",exact:true}).click();await expect.poll(()=>page.getByTestId("billing-subscription-status").textContent()).toBe("使用中");
 const rows=await asOwner(async c=>({state:(await c.query("SELECT status,binding_generation FROM billing_subscriptions WHERE user_id=$1",[user])).rows,events:(await c.query("SELECT count(*)::int AS n FROM billing_webhook_events WHERE provider_event_id='evt_browser_checkout'")).rows,credits:(await c.query("SELECT t.* FROM credit_transactions t JOIN credit_wallets w USING(wallet_id) WHERE w.owner_id=$1",[user])).rows}));
 expect(rows.state).toEqual([{status:"active",binding_generation:"1"}]);expect(rows.events).toEqual([{n:1}]);expect(rows.credits).toEqual([]);
 writeFileSync(resolve(evidence,"receipt.json"),JSON.stringify({source:"real Next/Billing HTTP/PostgreSQL",provider:"controlled Stripe HTTP + independent HMAC",billingHttpIntercepted:false,realMoneyCharged:false,...rows},null,2));
},120000);

it("purchases a one-time CNY180 month through real browser, API, signed callback and PG",async()=>{
 await cleanup();const page=await browser!.newPage({viewport:{width:1280,height:900}});
 await page.addInitScript(({user,org})=>{localStorage.setItem("wsx.sessionToken","stripe-browser-session");localStorage.setItem("wsx.session",JSON.stringify({version:1,userId:user,orgs:[org],currentOrgId:org,expiresAt:"2099-01-01T00:00:00Z"}));},{user,org});
 await page.route(url=>url.origin===origin&&url.pathname==="/__fullstack_api/identity/me",route=>route.fulfill({json:{org:{id:org,name:"本地支付验收",kind:"organization",team:null,modelPolicy:"any",avatarUrl:null},orgRole:"consultant",teamId:null,projectRole:null,groupId:null,displayName:"Stripe验收",avatarUrl:null}}));
 await page.route("https://checkout.stripe.com/**",route=>route.fulfill({contentType:"text/html",body:"<h1>Controlled one-time CNY180 Checkout</h1>"}));
 await page.goto(`${origin}/billing`);await page.getByRole("button",{name:"购买月度套餐",exact:true}).click();await page.waitForURL("https://checkout.stripe.com/**");
 const create=providerCalls.find(c=>c.path==="/v1/checkout/sessions")!;const params=new URLSearchParams(create.body);expect(params.get("mode")).toBe("payment");expect(params.get("line_items[0][price_data][unit_amount]")).toBe("18000");
 Object.assign(monthlySession!,{status:"complete",payment_status:"paid",payment_intent:"pi_browser_monthly",url:null});
 const body=JSON.stringify({id:"evt_browser_monthly_paid",object:"event",type:"checkout.session.completed",data:{object:{id:"cs_browser_monthly",mode:"payment"}}});
 const timestamp=Math.floor(Date.now()/1000),digest=createHmac("sha256",secret).update(`${timestamp}.${body}`).digest("hex");
 const paid=()=>fetch(`${base}/billing/webhooks/stripe`,{method:"POST",headers:{"content-type":"application/json","stripe-signature":`t=${timestamp},v1=${digest}`},body});
 expect((await paid()).status).toBe(200);expect((await paid()).status).toBe(200);
 await page.goto(`${origin}/billing?subscription_return=1`);await expect.poll(()=>page.getByText("20,000 / 20,000 credit",{exact:true}).count()).toBe(1);
 expect(await page.getByRole("button",{name:"管理订阅",exact:true}).count()).toBe(0);
 const wallet=await asOwner(c=>c.query("SELECT balance::text,total_granted FROM credit_wallets WHERE owner_id=$1",[user]));expect(wallet.rows).toEqual([{balance:"20000.00",total_granted:20000}]);
 await page.screenshot({path:resolve(evidence,"monthly-pass-active-fullstack.png"),fullPage:true});await page.close();
},120000);

it("purchases permanent credits through real Stripe cashier, signed callback and PostgreSQL",async()=>{
 await cleanup();const page=await browser!.newPage({viewport:{width:1280,height:900}});
 await page.addInitScript(({user,org})=>{localStorage.setItem("wsx.sessionToken","stripe-browser-session");localStorage.setItem("wsx.session",JSON.stringify({version:1,userId:user,orgs:[org],currentOrgId:org,expiresAt:"2099-01-01T00:00:00Z"}));},{user,org});
 await page.route(url=>url.origin===origin&&url.pathname==="/__fullstack_api/identity/me",route=>route.fulfill({json:{org:{id:org,name:"本地支付验收",kind:"organization",team:null,modelPolicy:"any",avatarUrl:null},orgRole:"consultant",teamId:null,projectRole:null,groupId:null,displayName:"Stripe验收",avatarUrl:null}}));
 await page.goto(`${origin}/billing`);await page.getByRole("button",{name:"充值 credit",exact:true}).click();
 await page.getByTestId("billing-generate-qr").click();
 await expect.poll(()=>page.getByRole("link",{name:"前往 Stripe 付款"}).count()).toBe(1);
 expect(creditSession).not.toBeNull();expect(creditSession!.metadata).toMatchObject({product:"credit_topup_v1"});
 const orderNo=String(creditSession!.client_reference_id);
 const before=await asOwner(c=>c.query("SELECT status,base_credits,bonus_credits FROM billing_orders WHERE order_no=$1 AND owner_id=$2",[orderNo,user]));expect(before.rows[0].status).toBe("PENDING");
 Object.assign(creditSession!,{status:"complete",payment_status:"paid",payment_intent:"pi_browser_credit",url:null});
 const body=JSON.stringify({id:"evt_browser_credit_paid",object:"event",type:"checkout.session.completed",data:{object:{id:"cs_browser_credit",mode:"payment"}}});
 const timestamp=Math.floor(Date.now()/1000),digest=createHmac("sha256",secret).update(`${timestamp}.${body}`).digest("hex");
 const paid=()=>fetch(`${base}/billing/webhooks/stripe`,{method:"POST",headers:{"content-type":"application/json","stripe-signature":`t=${timestamp},v1=${digest}`},body});
 expect((await paid()).status).toBe(200);expect((await paid()).status).toBe(200);
 await page.getByTestId("billing-refresh-status").click();await expect.poll(()=>page.getByTestId("billing-success-badge").count()).toBe(1);
 const receipt=await asOwner(async c=>({order:(await c.query("SELECT status FROM billing_orders WHERE order_no=$1",[orderNo])).rows,wallet:(await c.query("SELECT balance::text FROM credit_wallets WHERE owner_id=$1",[user])).rows,periods:(await c.query("SELECT * FROM credit_subscription_periods WHERE wallet_id IN(SELECT wallet_id FROM credit_wallets WHERE owner_id=$1)",[user])).rows}));
 expect(receipt.order).toEqual([{status:"SUCCESS"}]);expect(Number(receipt.wallet[0].balance)).toBe(Number(before.rows[0].base_credits)+Number(before.rows[0].bonus_credits));expect(receipt.periods).toEqual([]);
 await page.goto(`${origin}/billing?credit_order=${encodeURIComponent(orderNo)}`);await expect.poll(()=>page.getByTestId("billing-success-badge").count()).toBe(1);
 await page.screenshot({path:resolve(evidence,"stripe-credit-topup-fullstack.png"),fullPage:true});writeFileSync(resolve(evidence,"stripe-credit-receipt.json"),JSON.stringify({billingHttpIntercepted:false,...receipt},null,2));await page.close();
},120000);
