import {expect,it} from "vitest";
import {beginPersonalCheckout,bindPersonalCheckout,loadPersonalCheckout,clearPersonalCheckout} from "@/components/billing/personal-checkout-state";
const request={sku:"pro-cn-year-v1",catalogVersion:"pricing-v1",provider:"stripe" as const,idempotencyKey:"first-purchase-key-123"};
function storage(){const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);},values};}
const result={purchaseRef:"bg20261102000000abcdef",url:"https://checkout.stripe.com/c/pay/cs_test_fixture#fidkdWxFixture%2Fcheckout",expiresAt:"2026-11-03T00:00:00Z",provider:"stripe" as const,renewalMode:"automatic" as const};
it("persists the original key before network work and does not replace an unresolved purchase",()=>{
 const local=storage();expect(beginPersonalCheckout(local,"payer",request).request).toEqual(request);
 expect(loadPersonalCheckout(local,"payer")?.request).toEqual(request);
 expect(beginPersonalCheckout(local,"payer",{...request,idempotencyKey:"a-second-different-key"}).request).toEqual(request);
 expect(()=>beginPersonalCheckout(local,"payer",{...request,sku:"different-sku"})).toThrow("pending_purchase_exists");
 expect(loadPersonalCheckout(local,"payer")?.request).toEqual(request);
});
it("isolates accounts and only clears the exact original pending purchase",()=>{
 const local=storage();beginPersonalCheckout(local,"payer",request);expect(loadPersonalCheckout(local,"other")).toBeNull();
 clearPersonalCheckout(local,"payer","other-request-key");expect(loadPersonalCheckout(local,"payer")).not.toBeNull();
 clearPersonalCheckout(local,"payer",request.idempotencyKey);expect(loadPersonalCheckout(local,"payer")).toBeNull();
});
it("binds the verified-shaped response only to its original account, request and payment provider",()=>{
 const local=storage();beginPersonalCheckout(local,"payer",request);bindPersonalCheckout(local,"payer",request.idempotencyKey,result);
 expect(loadPersonalCheckout(local,"payer")?.result).toEqual(result);
 expect(()=>bindPersonalCheckout(local,"other",request.idempotencyKey,result)).toThrow("pending_purchase_missing");
 expect(()=>bindPersonalCheckout(local,"payer","another-request-key",result)).toThrow("pending_purchase_conflict");
 expect(()=>bindPersonalCheckout(local,"payer",request.idempotencyKey,{...result,provider:"wechat",renewalMode:"manual",url:"weixin://wxpay/bizpayurl?pr=fixture"})).toThrow("pending_purchase_conflict");
});
it("retains unreadable pending state and rejects unsafe checkout destinations",()=>{
 const local=storage();beginPersonalCheckout(local,"payer",request);
 expect(()=>bindPersonalCheckout(local,"payer",request.idempotencyKey,{...result,url:"https://foreign.example/c/pay/fixture"})).toThrow();
 expect(loadPersonalCheckout(local,"payer")?.result).toBeNull();
 const [key]=[...local.values.keys()];local.setItem(key!,"broken-json");expect(()=>loadPersonalCheckout(local,"payer")).toThrow("pending_purchase_unreadable");expect(local.getItem(key!)).toBe("broken-json");
});
it("keeps a terminal recovery reference without inventing a payment address and accepts later known binding facts",()=>{
 const local=storage();beginPersonalCheckout(local,"payer",request);const absent={...result,url:null,expiresAt:null};
 bindPersonalCheckout(local,"payer",request.idempotencyKey,absent);expect(loadPersonalCheckout(local,"payer")?.result).toEqual(absent);
 bindPersonalCheckout(local,"payer",request.idempotencyKey,result);expect(loadPersonalCheckout(local,"payer")?.result).toEqual(result);
 expect(()=>bindPersonalCheckout(local,"payer",request.idempotencyKey,{...result,url:"https://checkout.stripe.com/c/pay/another"})).toThrow("pending_purchase_conflict");
});
