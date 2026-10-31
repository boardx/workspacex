import {afterEach,describe,expect,it,vi} from 'vitest';
import {StripeCreditClient} from '../../src/infrastructure/billing/stripe-credit-client';
import type {DeploymentBillingConfig} from '../../src/infrastructure/billing/deployment-billing-config';
import type {OrderDraft} from '../../src/application/billing/billing-order-service';
const config={getStripe:()=>({secretKey:'sk_test_example',returnUrl:'https://example.com/billing'}),getPublicConfig:()=>({enabledProviders:[]})} as unknown as DeploymentBillingConfig;
const order={orderNo:'bg20261031090000ABC123',amountFen:9900} as OrderDraft;
const snapshot={object:'checkout.session',id:'cs_test_example',mode:'payment',livemode:false,url:'https://checkout.stripe.com/c/pay',client_reference_id:order.orderNo,amount_total:9900,currency:'cny',metadata:{product:'credit_topup_v1',order_ref:order.orderNo},status:'open'};
afterEach(()=>vi.unstubAllGlobals());
describe('Stripe credit checkout protocol',()=>{
 it('creates exact fixed CNY snapshot with stable idempotency even when new sales switch disabled',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot)));vi.stubGlobal('fetch',fetch);
  await new StripeCreditClient(config).create(order);
  const options=fetch.mock.calls[0]![1] as RequestInit;
  expect((options.headers as Record<string,string>)['Idempotency-Key']).toBe(`credit-topup:${order.orderNo}`);
  const body=new URLSearchParams(options.body as string);expect(body.get('mode')).toBe('payment');expect(body.get('line_items[0][price_data][unit_amount]')).toBe('9900');expect(body.get('metadata[product]')).toBe('credit_topup_v1');
 });
 it('returns organization topups to their authorized organization cashier',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot)));vi.stubGlobal('fetch',fetch);
  await new StripeCreditClient(config).create({...order,ownerType:'team',ownerId:'org-checkout-fixture'});
  const body=new URLSearchParams((fetch.mock.calls[0]![1] as RequestInit).body as string);
  for(const field of ['success_url','cancel_url']){
   const target=new URL(body.get(field)!);expect(target.pathname).toBe('/billing');
   expect(Object.fromEntries(target.searchParams)).toMatchObject({credit_order:order.orderNo,ownerType:'team',ownerId:'org-checkout-fixture',purchase:'1'});
  }
 });
 it.each([{amount_total:1},{livemode:true},{mode:'subscription'},{url:'https://attacker.example/pay'},{metadata:{product:'monthly_pass',order_ref:order.orderNo}}])('rejects mismatched response %j',async patch=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({...snapshot,...patch}))));
  await expect(new StripeCreditClient(config).create(order)).rejects.toThrow();
 });
});
