import type {Page} from "playwright";
import {user,other,org} from "../billing/order-fixture";
import {asOwner} from "./db";
export async function cleanPersonalPricingFixtures(){await asOwner(async c=>{
 const ids=[user,other];
 await c.query("DELETE FROM billing_personal_stripe_bindings WHERE purchase_ref IN (SELECT purchase_ref FROM billing_personal_purchases WHERE user_id=ANY($1::text[]))",[ids]);
 await c.query("DELETE FROM billing_personal_payment_receipts WHERE purchase_ref IN (SELECT purchase_ref FROM billing_personal_purchases WHERE user_id=ANY($1::text[]))",[ids]);
 await c.query("DELETE FROM billing_personal_terms WHERE user_id=ANY($1::text[])",[ids]);
 await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[ids]);
 await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[ids]);
 await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[])",[ids]);
 await c.query("DELETE FROM billing_personal_purchases WHERE user_id=ANY($1::text[])",[ids]);
});}
export async function openPersonalPricingPage(page:Page,origin:string){
 await page.addInitScript(({userId,orgId})=>{localStorage.setItem("wsx.sessionToken","f04-user");localStorage.setItem("wsx.session",JSON.stringify({version:1,userId,orgs:[orgId],currentOrgId:orgId,expiresAt:"2099-01-01T00:00:00Z"}));},{userId:user,orgId:org});
 await page.route(url=>url.origin===origin&&url.pathname==="/__fullstack_api/identity/me",route=>route.fulfill({json:{org:{id:org,name:"Pricing acceptance",kind:"organization",team:null,modelPolicy:"any",avatarUrl:null},orgRole:"admin",teamId:null,projectRole:null,groupId:null,displayName:"Isolated payer",avatarUrl:null}}));
 await page.goto(`${origin}/billing`);await page.getByTestId("personal-pricing-overview").waitFor();
 await page.getByTestId("pricing-wallet-balance").waitFor();
}
