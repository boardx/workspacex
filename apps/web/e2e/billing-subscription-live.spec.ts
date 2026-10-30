/** Production UI with controlled HTTP/hosted-page fixtures; no live merchant settlement claim. */
import {expect,test} from "@playwright/test";
import {mkdirSync} from "node:fs";
test("manual month purchase, reload, paid return, expiry, failed refresh and responsive layout",async({page,baseURL})=>{
 expect(new URL(baseURL!).hostname).toBe("localhost");let phase:"none"|"pending"|"active"|"expired"="none",fail=false,upgrades=0,walletReads=0;
 await page.addInitScript(()=>{
  localStorage.setItem("wsx.sessionToken","billing-browser-session");
  localStorage.setItem("wsx.session",JSON.stringify({version:1,userId:"billing-browser-user",orgs:["billing-browser-org"],currentOrgId:"billing-browser-org",expiresAt:"2099-01-01T00:00:00Z"}));
 });
 await page.route(`${baseURL}/**`,async route=>{
  const request=route.request(),path=new URL(request.url()).pathname.replace(/^\/api(?=\/)/,"");
  if(path==="/identity/me")return route.fulfill({json:{org:{id:"billing-browser-org",name:"个人账户",kind:"organization",team:null,modelPolicy:"any",avatarUrl:null},orgRole:"consultant",teamId:null,projectRole:null,groupId:null,displayName:"验证用户",avatarUrl:null}});
  if(path==="/billing/config")return route.fulfill({json:{enabledProviders:["stripe","wechat"]}});
  if(path==="/billing/wallet"){walletReads++;return route.fulfill({json:{wallet:{ownerType:"user",ownerId:"billing-browser-user",balance:phase==="active"?20100:100,permanentBalance:100,subscriptionCredits:phase==="active"?20000:0,totalPurchased:100,totalGranted:phase==="active"?20000:0,updatedAt:new Date().toISOString()}}});}
  if(path==="/billing/subscription")return route.fulfill(fail?{status:503,json:{error:"dependency_unavailable"}}:{json:{status:phase==="active"?"active":phase==="expired"?"canceled":"none",planRef:null,purchaseMode:"manual_monthly",checkoutPending:phase==="pending",currentPeriodEnd:["active","expired"].includes(phase)?"2030-11-30T00:00:00Z":null,cancelAtPeriodEnd:true,...(phase==="active"?{creditGrant:{status:"granted",grant:{credits:20000,remainingCredits:20000,periodStart:"2030-10-30T00:00:00Z",periodEnd:"2030-11-30T00:00:00Z"}}}:{})}});
  if(path==="/billing/subscription/upgrade-link"){expect(request.method()).toBe("POST");expect(request.postDataJSON()).toEqual({});upgrades++;phase="pending";return route.fulfill({json:{url:"https://checkout.stripe.com/c/pay/monthly"}});}
  if(["fetch","xhr"].includes(request.resourceType()))return route.fulfill({status:404,json:{}});return route.continue();
 });
 await page.route("https://checkout.stripe.com/**",route=>route.fulfill({contentType:"text/html",body:"<h1>Controlled one-time Checkout: CNY180</h1>"}));
 mkdirSync("test-results/prototype-audit",{recursive:true});
 await page.goto("/billing");await expect(page.getByText("¥180",{exact:true})).toBeVisible();await page.getByRole("button",{name:"购买月度套餐",exact:true}).click();await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/monthly");
 await page.goto(`${baseURL}/billing?subscription_return=1`);await expect(page.getByRole("button",{name:"继续付款",exact:true})).toBeVisible();await page.reload();await page.getByRole("button",{name:"继续付款",exact:true}).click();await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/monthly");expect(upgrades).toBe(2); // Backend proves these requests reuse the same order.
 phase="active";await page.goto(`${baseURL}/billing?subscription_return=1`);await expect(page.getByText("20,000 / 20,000 credit",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"管理订阅"})).toHaveCount(0);expect(walletReads).toBeGreaterThan(1);
 for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/prototype-audit/monthly-pass-${width}.png`,fullPage:true});}
 fail=true;await page.getByRole("button",{name:"刷新状态"}).click();await expect(page.getByTestId("err-billing-subscription")).toBeVisible();await expect(page.getByRole("button",{name:"购买月度套餐"})).toHaveCount(0);
 fail=false;phase="expired";await page.getByRole("button",{name:"刷新状态"}).click();await expect(page.getByRole("button",{name:"续费 ¥180",exact:true})).toBeVisible();
});
