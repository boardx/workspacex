import {expect,it} from "vitest";
import {requirePaymentUrl,requireManagementUrl} from "@/components/billing/payment-url";
const stripe="https://checkout.stripe.com/c/pay/cs_test_fixture#fidkdWxFixture%2Fcheckout";
it("preserves the complete hosted Stripe Checkout address including its fragment",()=>{
 expect(requirePaymentUrl(stripe,"stripe")).toBe(stripe);
});
it.each([
 "http://checkout.stripe.com/c/pay/test#fid",
 "https://checkout.stripe.com.evil.example/c/pay/test#fid",
 "https://foreign.example/c/pay/test#fid",
 "https://payer:pass@checkout.stripe.com/c/pay/test#fid",
 "https://checkout.stripe.com:8443/c/pay/test#fid",
 "javascript:alert(1)",
])("rejects an unsafe Stripe destination %s",value=>{
 expect(()=>requirePaymentUrl(value,"stripe")).toThrow();
});
it("keeps WeChat payment and Stripe management fragment restrictions",()=>{
 const wechat="weixin://wxpay/bizpayurl?pr=fixture";
 expect(requirePaymentUrl(wechat,"wechat")).toBe(wechat);
 expect(()=>requirePaymentUrl(wechat+"#fid","wechat")).toThrow();
 expect(()=>requireManagementUrl("https://billing.stripe.com/p/session/fixture#fid")).toThrow();
});
