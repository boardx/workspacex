import {expect,it,vi} from "vitest";
import {TeamWechatCreditingStore} from "../../src/infrastructure/billing/team-wechat-crediting-store";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../src/domain/billing/billing-generation";
import type {VerifiedPaymentReceipt} from "../../src/application/billing/billing-notify-ports";
function fixture(found=true){
 const now=new Date("2026-11-02T10:00:00Z"),paidAt=new Date("2026-11-02T10:01:00Z");
 const quote={orgId:"org-a",generation,quoteRef:"quote-a",catalogVersion:"frozen",sku:"team-year",provider:"wechat",currency:"CNY",amountMinor:46610,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+300000).toISOString(),purpose:"initial",seats:7,monthlyCredits:130000,billingCycle:"year",renewalMode:"manual",planVersion:0};
 const row={purchase_ref:"bt20261102100000ABC123",org_id:"org-a",generation,quote,created_at:now,checkout_expires_at:new Date(now.getTime()+900000),session_ref:null,payment_url:null,expires_at:null,fulfilled_at:null,closed_at:null,payment_review_required:false,fulfillment:null};
 const global=vi.fn(async(sql:string)=>({rows:sql.includes("billing_team_purchase_org")?[{org_id:found?"org-a":null}]:[]}));
 const db={withoutTenant:async(fn:Function)=>fn({query:global}),withTenant:async(_org:string,fn:Function)=>fn({query:async(sql:string)=>({rows:sql.includes("billing_pricing_epoch")?[{generation,active:true}]:sql.includes("billing_team_purchases")?[row]:[]})})};
 const client={read:vi.fn(async()=>({state:"paid",paymentRef:"wx_actual",paidAt,amountMinor:46610,currency:"CNY"}))};
 const payments={settle:vi.fn(async()=>({completed:true,manual:false}))};
 const previous={accept:vi.fn(async()=>({completed:true,manual:false})),processOne:vi.fn(),due:vi.fn(),auditRejection:vi.fn()};
 const store=new TeamWechatCreditingStore(db as never,client as never,payments as never,previous as never);
 const notice:VerifiedPaymentReceipt={providerEventId:"wx-event",orderNo:row.purchase_ref,appId:"wx-team",mchId:"merchant",amountFen:46610,currency:"CNY",transactionId:"actual",tradeState:"SUCCESS",paidAt:paidAt.toISOString(),receiptHash:"signed-hash",signatureVerified:true};
 return {store,notice,client,payments,previous,global,paidAt};
}
it("rejects an unsigned Team notice before merchant read or settlement",async()=>{
 const f=fixture();await expect(f.store.accept({...f.notice,signatureVerified:false})).rejects.toThrow("signature_invalid");expect(f.client.read).not.toHaveBeenCalled();expect(f.previous.accept).not.toHaveBeenCalled();expect(f.payments.settle).not.toHaveBeenCalled();
});
it("delegates a non-Team unsigned notice to the unchanged legacy verification policy",async()=>{
 const f=fixture(false),notice={...f.notice,signatureVerified:false};
 expect(await f.store.accept(notice)).toEqual({completed:true,manual:false});expect(f.previous.accept).toHaveBeenCalledTimes(1);expect(f.previous.accept).toHaveBeenCalledWith(notice);expect(f.client.read).not.toHaveBeenCalled();expect(f.payments.settle).not.toHaveBeenCalled();
});
it("keeps personal/legacy routing when no immutable Team purchase exists",async()=>{
 const f=fixture(false);await f.store.accept(f.notice);expect(f.previous.accept).toHaveBeenCalledWith(f.notice);expect(f.client.read).not.toHaveBeenCalled();expect(f.payments.settle).not.toHaveBeenCalled();
});
it("keeps actual mismatched signed cash for reconciliation, never replacing it with quote money",async()=>{
 const f=fixture();f.client.read.mockResolvedValue({state:"paid",paymentRef:"wx_actual",paidAt:f.paidAt,amountMinor:1,currency:"USD"});f.payments.settle.mockResolvedValue({completed:true,manual:true});
 expect(await f.store.accept({...f.notice,amountFen:1,currency:"USD"})).toEqual({completed:true,manual:true});
 expect(f.payments.settle).toHaveBeenCalledWith("org-a",expect.objectContaining({amountMinor:1,currency:"USD",paymentRef:"wx_actual"}));
});
it("requires callback cash identity to agree with the authoritative merchant reread",async()=>{
 const f=fixture();await expect(f.store.accept({...f.notice,transactionId:"another"})).rejects.toThrow("order_mismatch");expect(f.payments.settle).not.toHaveBeenCalled();
});
