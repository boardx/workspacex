// @global-scope-fixture table:billing_orders: exact recorded order numbers are removed in afterAll.
import {afterAll,afterEach,beforeAll,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {ensureDatabase,migrateOnce,asOwner} from '../support/db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {toOrgId} from '../../src/domain/org-id';
import {StripeCreditCheckout} from '../../src/infrastructure/billing/stripe-credit-checkout';
import type {DeploymentBillingConfig} from '../../src/infrastructure/billing/deployment-billing-config';
import type {OrderDraft} from '../../src/application/billing/billing-order-service';
const db=new PgDatabase(appConfig()),owners:string[]=[],orders:string[]=[];
const config={getStripe:()=>({secretKey:'sk_test_example',returnUrl:'https://example.com/billing'}),getPublicConfig:()=>({enabledProviders:[]})} as unknown as DeploymentBillingConfig;
const service=new StripeCreditCheckout(db,config);
beforeAll(async()=>{ensureDatabase();await migrateOnce();},120000);
afterEach(()=>vi.unstubAllGlobals());
afterAll(async()=>{await asOwner(async c=>{await c.query('DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=ANY($1::text[]))',[owners]);await c.query('DELETE FROM credit_wallets WHERE owner_id=ANY($1::text[])',[owners]);await c.query('DELETE FROM billing_orders WHERE order_no=ANY($1::text[])',[orders]);});await db.close();});
async function fixture(provider='stripe'){
 const id=`stripe6050-${randomUUID()}`,orderNo=`bg20261031090000${randomUUID().replaceAll('-','').slice(0,6)}`;owners.push(id);orders.push(orderNo);
 const owner={orgId:toOrgId('stripe6050'),ownerType:'user' as const,ownerId:id};
 const p=(await asOwner(c=>c.query('SELECT * FROM credit_packages WHERE enabled=true LIMIT 1'))).rows[0]!;
 await asOwner(c=>c.query("INSERT INTO billing_orders(order_no,owner_type,owner_id,created_by,package_id,amount_fen,base_credits,bonus_credits,currency,provider,status,qr_code_url,created_at,expired_at) VALUES($1,'user',$2,$2,$3,100,10,2,'CNY',$4,'PENDING','pending',now(),now()+interval '1 day')",[orderNo,id,p.package_id,provider]));
 const session={object:'checkout.session',id:`cs_${randomUUID().replaceAll('-','')}`,mode:'payment',livemode:false,status:'complete',payment_status:'paid',currency:'cny',amount_total:100,client_reference_id:orderNo,metadata:{product:'credit_topup_v1',order_ref:orderNo},payment_intent:`pi_${randomUUID().replaceAll('-','')}`};
 return {owner,orderNo,session};
}
function respond(value:unknown){vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response(JSON.stringify(value))));}
it('settles callback before session bind exactly once under duplicate delivery',async()=>{
 const f=await fixture();respond(f.session);await Promise.all([service.accept(f.session.id),service.accept(f.session.id)]);
 const r=await asOwner(c=>c.query('SELECT balance,total_purchased FROM credit_wallets WHERE owner_id=$1',[f.owner.ownerId]));expect(Number(r.rows[0]?.balance)).toBe(12);expect(r.rows[0]?.total_purchased).toBe(10);
 expect((await asOwner(c=>c.query('SELECT * FROM credit_transactions WHERE source_id=$1',[f.orderNo]))).rows).toHaveLength(2);
});
it('rejects wrong amount and cross provider without wallet writes',async()=>{
 const f=await fixture();respond({...f.session,amount_total:101});await expect(service.accept(f.session.id)).rejects.toThrow('snapshot_mismatch');
 const w=await fixture('wechat');respond(w.session);expect(await service.accept(w.session.id)).toBe(false);
 expect((await asOwner(c=>c.query('SELECT * FROM credit_wallets WHERE owner_id=ANY($1::text[])',[[f.owner.ownerId,w.owner.ownerId]]))).rows).toHaveLength(0);
});
it('rejects reconciliation under another principal owner',async()=>{
 const f=await fixture();await expect(service.reconcile({...f.owner,ownerId:'different'}, {orderNo:f.orderNo} as OrderDraft & {qrCodeUrl:string})).rejects.toThrow('order_not_found');
});

it('recovers only the existing unbound order even when new purchases are disabled',async()=>{
 const f=await fixture();respond({...f.session,status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/c/pay/recovered'});
 const order=await service.reconcile(f.owner,{orderNo:f.orderNo} as OrderDraft & {qrCodeUrl:string});
 expect(order).toMatchObject({orderNo:f.orderNo,provider:'stripe',status:'PENDING',qrCodeUrl:'https://checkout.stripe.com/c/pay/recovered'});
 expect((await asOwner(c=>c.query('SELECT * FROM billing_orders WHERE owner_id=$1',[f.owner.ownerId]))).rows).toHaveLength(1);
 await expect(service.create(f.owner,{...order,createdBy:f.owner.ownerId})).rejects.toMatchObject({code:'payment_provider_not_configured'});
});
