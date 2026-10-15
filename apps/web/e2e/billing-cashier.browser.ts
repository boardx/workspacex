/** Controlled UI evidence; not real merchant, login or payment settlement proof. */
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const evidence=resolve("../../phases/phase-21-billing-payment/sprints/sprint-06/evidence/browser");
test("live cashier keyboard, QR, polling recovery and accounting across three widths",async({page,baseURL})=>{
 expect(new URL(baseURL!).hostname).toBe("localhost");mkdirSync(evidence,{recursive:true});
 await page.addInitScript(()=>{
  localStorage.setItem("wsx.sessionToken","billing-ui-session");
  localStorage.setItem("wsx.session",JSON.stringify({version:1,userId:"billing-ui-user",orgs:["billing-ui-org"],currentOrgId:"billing-ui-org",expiresAt:"2099-01-01T00:00:00Z"}));
 });
 let status="PENDING",readsFail=false,posts=0;
 const wallet={ownerType:"user",ownerId:"billing-ui-user",balance:100,totalPurchased:100,totalGranted:0,updatedAt:new Date().toISOString()};
 const pack={packageId:"real-package",ownerType:"user",region:"cn",currency:"CNY",amountFen:9900,displayAmount:"¥99.00",baseCredits:100,bonusCredits:20,bonusRate:0.2,totalCredits:120};
 let order:Record<string,unknown>={};
 await page.route("http://localhost:3526/api/**",async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==="/api/identity/me")return route.fulfill({json:{org:{id:"billing-ui-org",name:"计费验证组织",kind:"organization",team:null,modelPolicy:"any",avatarUrl:null},orgRole:"consultant",teamId:null,projectRole:null,groupId:null,displayName:"计费验证用户",avatarUrl:null}});
  if(path==="/api/billing/config")return route.fulfill({json:{enabledProviders:["wechat"]}});
  if(path==="/api/billing/packages")return route.fulfill({json:{items:[pack]}});
  if(path==="/api/billing/wallet")return route.fulfill({json:{wallet:{...wallet,balance:status==="SUCCESS"?220:100}}});
  if(path==="/api/billing/transactions")return route.fulfill({json:{items:[],nextCursor:null}});
  if(path==="/api/billing/orders"&&req.method()==="POST"){
   expect(req.postDataJSON()).toEqual({ownerType:"user",packageId:pack.packageId,provider:"wechat"});posts++;
   order={orderNo:`bg20261016000000abcde${posts}`,ownerType:"user",ownerId:wallet.ownerId,provider:"wechat",status:"PENDING",packageId:pack.packageId,amountFen:9900,baseCredits:100,bonusCredits:20,currency:"CNY",qrCodeUrl:"weixin://wxpay/bizpayurl?pr=controlled-local-evidence",createdAt:new Date().toISOString(),paidAt:null,notifyAt:null,expiredAt:new Date(Date.now()+900000).toISOString(),closedAt:null,lastErrorCode:null};
   return route.fulfill({json:{order}});
  }
  if(path.startsWith("/api/billing/orders/"))return readsFail?route.fulfill({status:503,json:{error:"dependency_unavailable"}}):route.fulfill({json:{order:{...order,status,paidAt:status==="SUCCESS"?new Date().toISOString():null}}});
  return route.fulfill({status:404,json:{error:"not_found"}});
 });
 for(const width of [375,768,1280]){
  status="PENDING";readsFail=false;await page.setViewportSize({width,height:900});await page.goto("/billing");
  const buy=page.getByRole("button",{name:"购买额度",exact:true});await expect(buy).toBeVisible();
  // Reach the real trigger through ordinary document keyboard navigation.
  let reached=false;for(let i=0;i<70;i++){await page.keyboard.press("Tab");if(await buy.evaluate(node=>node===document.activeElement)){reached=true;break;}}
  expect(reached).toBe(true);await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();await expect(page.getByText("¥99.00",{exact:true})).toBeVisible();
  await page.getByRole("radio").check();await page.getByTestId("billing-generate-qr").click();
  const area=page.getByTestId("billing-qr-code-area");await expect(area).toBeVisible();
  await expect.poll(()=>area.locator("canvas").evaluate(node=>{
   const canvas=node as HTMLCanvasElement;const pixels=canvas.getContext("2d")!.getImageData(0,0,canvas.width,canvas.height).data;
   let dark=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]!<80&&pixels[i+3]!>0)dark++;return dark;
  })).toBeGreaterThan(100);
  const geometry=await page.getByRole("dialog").boundingBox();expect(geometry!.x).toBeGreaterThanOrEqual(0);expect(geometry!.x+geometry!.width).toBeLessThanOrEqual(width);
  await page.screenshot({path:resolve(evidence,`cashier-${width}-pending.png`),fullPage:true});
  readsFail=true;await page.getByTestId("billing-refresh-status").click();await expect(page.getByTestId("billing-refresh-hint")).toContainText("订单已保留");await expect(area).toBeVisible();
  readsFail=false;status="SUCCESS";await page.getByTestId("billing-refresh-status").click();await expect(page.getByTestId("billing-success-badge")).toBeVisible();await expect(page.getByTestId("billing-updated-balance")).toContainText("220");await expect(area).toHaveCount(0);
  await page.screenshot({path:resolve(evidence,`cashier-${width}-success.png`),fullPage:true});
  await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);await expect(buy).toBeFocused();
 }
 expect(posts).toBe(3);
});
