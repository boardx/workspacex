import {expect,it,vi} from "vitest";
import {TeamCheckoutService} from "../../src/application/billing/team-checkout-service";
const request={quoteRef:"quote-a",idempotencyKey:"stable-original-key"};
function setup(terminal=false){
 const purchase={purchaseRef:"team_purchase_a",quote:{quoteRef:"quote-a",provider:"wechat"},createdAt:new Date(),checkoutExpiresAt:new Date(Date.now()+900000),terminal,binding:null};
 const repository={authorize:vi.fn(async()=>{}),find:vi.fn(async()=>purchase),reserve:vi.fn(async()=>purchase),bind:vi.fn(async()=>purchase),result:vi.fn(async()=>({purchaseRef:purchase.purchaseRef}))};
 const provider={provider:"wechat",enabled:()=>true,createCheckout:vi.fn(async(_purchase:unknown)=>({sessionRef:purchase.purchaseRef,url:"weixin://wxpay/test",expiresAt:purchase.checkoutExpiresAt}))};
 return {purchase,repository,provider,service:new TeamCheckoutService(repository as never,provider as never)};
}
it("recovers terminal outcome without charging again even when provider disabled",async()=>{
 const s=setup(true);s.provider.enabled=()=>false;
 await s.service.checkout({userId:"u",orgId:"org-a"} as never,"org-a",request);
 expect(s.provider.createCheckout).not.toHaveBeenCalled();expect(s.repository.reserve).not.toHaveBeenCalled();
});
it("does not bypass current org authorization on idempotent recovery",async()=>{
 const s=setup(true);s.repository.authorize.mockRejectedValue(Error("forbidden"));
 await expect(s.service.checkout({userId:"u",orgId:"org-a"} as never,"org-b",request)).rejects.toThrow("forbidden");
 expect(s.repository.find).not.toHaveBeenCalled();expect(s.provider.createCheckout).not.toHaveBeenCalled();
});
it("rejects changed quote for an original key without another payment",async()=>{
 const s=setup();await expect(s.service.checkout({userId:"u",orgId:"org-a"} as never,"org-a",{...request,quoteRef:"different"})).rejects.toThrow("idempotency_conflict");
 expect(s.provider.createCheckout).not.toHaveBeenCalled();
});
it("persists intent before upstream and preserves the same reference after a lost response",async()=>{
 const s=setup();s.repository.find.mockResolvedValue(null as never);s.provider.createCheckout.mockRejectedValueOnce(Error("lost response"));
 await expect(s.service.checkout({userId:"u",orgId:"org-a"} as never,"org-a",request)).rejects.toThrow("dependency_unavailable");
 s.repository.find.mockResolvedValue(s.purchase);
 await s.service.checkout({userId:"u",orgId:"org-a"} as never,"org-a",request);
 expect(s.repository.reserve).toHaveBeenCalledTimes(1);expect(s.provider.createCheckout.mock.calls.map(call=>call[0])).toEqual([s.purchase,s.purchase]);
});

it("replays an original purchase before quote TTL or closed sale checks",async()=>{
 const s=setup();Object.assign(s.purchase.quote,{expiresAt:"2000-01-01T00:00:00Z"});
 s.purchase.binding={sessionRef:s.purchase.purchaseRef,url:"weixin://wxpay/original",expiresAt:s.purchase.checkoutExpiresAt} as never;
 s.provider.enabled=()=>false;
 await s.service.checkout({userId:"u",orgId:"org-a"} as never,"org-a",request);
 expect(s.repository.reserve).not.toHaveBeenCalled();expect(s.provider.createCheckout).not.toHaveBeenCalled();
});
