/** Controlled UI evidence; not real merchant, login or payment settlement proof. */
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const evidence=resolve("../../docs/evidence/billing-cashier-5945/browser");
test("live cashier keyboard, QR, polling recovery and accounting across three widths",async({page,baseURL})=>{
 expect(new URL(baseURL!).hostname).toBe("localhost");mkdirSync(evidence,{recursive:true});
 await page.addInitScript(()=>{
  localStorage.setItem("wsx.sessionToken","billing-ui-session");
  localStorage.setItem("wsx.session",JSON.stringify({version:1,userId:"billing-ui-user",orgs:["billing-ui-org"],currentOrgId:"billing-ui-org",expiresAt:"2099-01-01T00:00:00Z"}));
 });
 let status="PENDING",readsFail=false,posts=0,creditedBalance=100,settledOrder="";
 const wallet={ownerType:"user",ownerId:"billing-ui-user",balance:100,totalPurchased:100,totalGranted:0,updatedAt:new Date().toISOString()};
 const packs=[100,1000,3000,5000,10000,20000].map(credits=>({packageId:`package-${credits}`,ownerType:"user",region:"cn",currency:"CNY",amountFen:credits,displayAmount:`¥${(credits/100).toFixed(2)}`,baseCredits:credits,bonusCredits:0,bonusRate:0,totalCredits:credits}));
 let heldRead: (()=>Promise<void>) | null=null, holdRefresh=false;
 let order:Record<string,unknown>={};
 await page.route("http://localhost:3526/api/**",async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==="/api/identity/me")return route.fulfill({json:{org:{id:"billing-ui-org",name:"计费验证组织",kind:"organization",team:null,modelPolicy:"any",avatarUrl:null},orgRole:"consultant",teamId:null,projectRole:null,groupId:null,displayName:"计费验证用户",avatarUrl:null}});
  if(path==="/api/billing/config")return route.fulfill({json:{enabledProviders:["wechat"]}});
  if(path==="/api/billing/packages")return route.fulfill({json:{items:packs}});
  if(path==="/api/billing/wallet")return route.fulfill({json:{wallet:{...wallet,balance:creditedBalance,totalPurchased:creditedBalance,availableBalance:creditedBalance,reservedCredits:0}}});
  if(path==="/api/billing/transactions")return route.fulfill({json:{items:settledOrder?[{txnId:`txn-${settledOrder}`,type:"purchase",direction:1,credits:100,balanceAfter:200,sourceType:"payment_order",sourceId:settledOrder,operatorId:null,reason:null,createdAt:new Date().toISOString()}]:[],nextCursor:null}});
  if(path==="/api/billing/orders"&&req.method()==="POST"){
   const pack=packs.find(item=>item.packageId===req.postDataJSON().packageId)!;
   expect(req.postDataJSON()).toEqual({ownerType:"user",packageId:pack.packageId,provider:"wechat"});posts++;
   order={orderNo:`bg20261016000000abcde${posts}`,ownerType:"user",ownerId:wallet.ownerId,provider:"wechat",status:"PENDING",packageId:pack.packageId,amountFen:pack.amountFen,baseCredits:pack.baseCredits,bonusCredits:pack.bonusCredits,currency:"CNY",qrCodeUrl:`weixin://wxpay/bizpayurl?pr=controlled-local-evidence-${posts}`,createdAt:new Date().toISOString(),paidAt:null,notifyAt:null,expiredAt:new Date(Date.now()+900000).toISOString(),closedAt:null,lastErrorCode:null};
   return route.fulfill({json:{order}});
  }
  if(path.startsWith("/api/billing/orders/")){
   if(status==="SUCCESS"){creditedBalance=200;settledOrder=String(order.orderNo);}
   const result={...order,status,paidAt:status==="SUCCESS"?new Date().toISOString():null};
   if(holdRefresh){heldRead=()=>route.fulfill({json:{order:result}});return;}
   return readsFail?route.fulfill({status:503,json:{error:"dependency_unavailable"}}):route.fulfill({json:{order:result}});
  }
  return route.fulfill({status:404,json:{error:"not_found"}});
 });
 for(const width of [375,768,1280]){
  status="PENDING";readsFail=false;creditedBalance=100;settledOrder="";await page.setViewportSize({width,height:width>=1024?1100:900});await page.goto("/billing");
  const buy=page.getByRole("button",{name:"购买 credit",exact:true});await expect(buy).toBeVisible();
  // Reach the real trigger through ordinary document keyboard navigation.
  let reached=false;for(let i=0;i<70;i++){await page.keyboard.press("Tab");if(await buy.evaluate(node=>node===document.activeElement)){reached=true;break;}}
  expect(reached).toBe(true);await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();await expect(page.getByText("¥1.00",{exact:true})).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(6);
  await page.getByRole("radio").first().check();await page.getByTestId("billing-generate-qr").click();
  const area=page.getByTestId("billing-qr-code-area");await expect(area).toBeVisible();
  await expect.poll(()=>area.locator("canvas").evaluate(node=>{
   const canvas=node as HTMLCanvasElement;const pixels=canvas.getContext("2d")!.getImageData(0,0,canvas.width,canvas.height).data;
   let dark=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]!<80&&pixels[i+3]!>0)dark++;return dark;
  })).toBeGreaterThan(100);
  const geometry=await page.getByRole("dialog").boundingBox();expect(geometry!.x).toBeGreaterThanOrEqual(0);expect(geometry!.x+geometry!.width).toBeLessThanOrEqual(width);
  const packages=await page.getByRole("radiogroup").boundingBox(),panel=await page.getByRole("region",{name:"微信支付订单"}).boundingBox();
  if(width>=1024){expect(panel!.x).toBeGreaterThan(packages!.x+packages!.width);expect(Math.abs(panel!.y-packages!.y)).toBeLessThan(2);}
  else expect(panel!.y).toBeGreaterThan(packages!.y+packages!.height);
  expect(await page.getByRole("dialog").evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await page.screenshot({path:resolve(evidence,`cashier-${width}-pending.png`),fullPage:true});
  readsFail=true;await page.getByTestId("billing-refresh-status").click();await expect(page.getByTestId("billing-refresh-hint")).toContainText("订单已保留");await expect(area).toBeVisible();
  readsFail=false;status="SUCCESS";await page.getByTestId("billing-refresh-status").click();await expect(page.getByTestId("billing-success-badge")).toBeVisible();await expect(page.getByTestId("billing-updated-balance")).toContainText("200");await expect(area).toHaveCount(0);
  await expect(page.getByTestId("billing-ledger-table")).toContainText("+100");
  await page.screenshot({path:resolve(evidence,`cashier-${width}-success.png`),fullPage:true});
  // A slow GET for a completed order must not swallow "buy again" or restore the old order.
  holdRefresh=true;heldRead=null;await page.getByTestId("billing-refresh-status").click();
  await expect.poll(()=>heldRead!==null).toBe(true);
  const firstOrder=String(order.orderNo),before=posts;
  await page.getByTestId("billing-buy-again").click();
  await expect(page.getByTestId("billing-generate-qr")).toBeEnabled();
  await page.getByRole("radio").nth(1).check();
  holdRefresh=false;status="PENDING";await page.getByTestId("billing-generate-qr").click();
  await expect(page.getByTestId("billing-qr-code-area")).toBeVisible();
  expect(posts).toBe(before+1);expect(order.orderNo).not.toBe(firstOrder);expect(order.packageId).toBe(packs[1]!.packageId);
  await heldRead!();await expect(page.getByTestId("billing-order-no")).toContainText(String(order.orderNo));
  await expect(page.getByTestId("billing-success-badge")).toHaveCount(0);
  await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);await expect(buy).toBeFocused();
 }
 // One account entry leads to billing; purchasing starts from its wallet card.
 await page.goto("/profile");await page.getByTestId("rail-profile-menu").click();
 await expect(page.getByTestId("billing-menu-purchase")).toHaveCount(0);
 await page.getByTestId("personal-menu-billing").click();
 await page.getByRole("button",{name:"购买 credit",exact:true}).click();
 await expect(page.getByRole("dialog")).toBeVisible();
 await expect(page).toHaveURL(/\/billing$/);
 await page.keyboard.press("Escape");
 await expect(page.getByRole("button",{name:"购买 credit",exact:true})).toBeFocused();
 expect(posts).toBe(6);
});
