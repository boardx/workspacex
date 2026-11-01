import { expect, it } from "vitest";
import { BillingOrder } from "../src/billing-credits";
import { PersonalCheckoutResult } from "../src/billing-pricing";

const order={orderNo:"bg20261102000000abcdef",ownerType:"user",ownerId:"payer",provider:"stripe",status:"PENDING",packageId:"pro-us-year-v1",amountFen:29000,baseCredits:20000,bonusCredits:0,currency:"USD",qrCodeUrl:"https://checkout.stripe.com/c/pay/fixture",createdAt:"2026-11-02T00:00:00Z",expiredAt:"2026-11-03T00:00:00Z",paidAt:null,notifyAt:null,closedAt:null,lastErrorCode:null};
const missing=[{qrCodeUrl:null},{expiredAt:null},{qrCodeUrl:null,expiredAt:null}];
it.each(["PENDING","PROCESSING"])("requires both original payment facts for %s",status=>{
 for(const patch of missing)expect(BillingOrder.safeParse({...order,status,...patch}).success).toBe(false);
 expect(BillingOrder.safeParse({...order,status}).success).toBe(true);
});
it.each(["SUCCESS","FAILED","CLOSED"])("preserves known fields and allows unknown original binding for %s",status=>{
 for(const patch of missing)expect(BillingOrder.parse({...order,status,...patch})).toMatchObject(patch);
});
it("returns the original checkout reference with either a complete binding or two explicit nulls",()=>{
 const result={purchaseRef:order.orderNo,url:order.qrCodeUrl,expiresAt:order.expiredAt,provider:"stripe",renewalMode:"automatic"};
 expect(PersonalCheckoutResult.parse({...result,url:null,expiresAt:null})).toMatchObject({purchaseRef:order.orderNo,url:null,expiresAt:null});
 expect(PersonalCheckoutResult.safeParse({...result,url:null}).success).toBe(false);
 expect(PersonalCheckoutResult.safeParse({...result,expiresAt:null}).success).toBe(false);
 expect(PersonalCheckoutResult.parse(result)).toEqual(result);
});
