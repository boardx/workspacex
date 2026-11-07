import {afterEach,expect,it,vi} from "vitest";
import {StripeMonthlyPassClient} from "../../src/infrastructure/billing/stripe-monthly-pass-client";
import {DeploymentBillingConfig} from "../../src/infrastructure/billing/deployment-billing-config";
const config=()=>new DeploymentBillingConfig({STRIPE_SECRET_KEY:"sk_test_fixture",STRIPE_WEBHOOK_SECRET:"whsec_fixture",STRIPE_PAYMENT_LINK:"https://buy.stripe.com/old",STRIPE_RETURN_URL:"https://example.test/billing"});
const order={orderId:"a2698f8f-8928-42bf-a37f-dfded1be1d99",userId:"private-user",state:"pending" as const,sessionRef:null,createdAt:new Date(),periodStart:null,periodEnd:null,remainingCredits:0};
afterEach(()=>vi.unstubAllGlobals());
it("creates a fixed CNY180 single payment with a stable idempotency key and no recurring terms",async()=>{
 const fetcher=vi.fn(async(_input:string,_options?:RequestInit)=>new Response(JSON.stringify({id:"cs_test_fixed",object:"checkout.session",mode:"payment",status:"open",livemode:false,url:"https://checkout.stripe.com/c/pay/fixed",client_reference_id:order.orderId,metadata:{product:"monthly_pass_v1",order_ref:order.orderId},amount_total:18000,currency:"cny"})));vi.stubGlobal("fetch",fetcher);
 const client=new StripeMonthlyPassClient(config());await client.create(order);await client.create(order);
 const init=fetcher.mock.calls[0]![1] as RequestInit;const body=new URLSearchParams(init.body as string);
 expect(body.get("mode")).toBe("payment");expect(body.get("adaptive_pricing[enabled]")).toBe("false");expect(body.get("line_items[0][price_data][unit_amount]")).toBe("18000");
 expect(body.get("line_items[0][price_data][currency]")).toBe("cny");expect(body.toString()).not.toContain("recurring");expect(body.toString()).not.toContain("private-user");
 expect(new Headers(init.headers).get("Idempotency-Key")).toBe(`monthly-pass:${order.orderId}`);
 expect(fetcher.mock.calls[1]![1]?.body).toBe(init.body);
 expect(new Headers(fetcher.mock.calls[1]![1]?.headers).get("Idempotency-Key")).toBe(new Headers(init.headers).get("Idempotency-Key"));
 expect(body.get("success_url")).toBe("https://example.test/billing?subscription_return=1");
});
it.each(["https://evil.test/pay","https://checkout.stripe.com.evil.test/pay","http://checkout.stripe.com/pay"])("rejects untrusted checkout %s",async url=>{
 vi.stubGlobal("fetch",vi.fn(async(_input:string,_options?:RequestInit)=>new Response(JSON.stringify({id:"cs_test_fixed",object:"checkout.session",mode:"payment",status:"open",livemode:false,url}))));
 await expect(new StripeMonthlyPassClient(config()).create(order)).rejects.toThrow();
});
