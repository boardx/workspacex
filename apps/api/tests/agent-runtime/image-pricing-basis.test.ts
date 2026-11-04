import {expect,it,vi} from 'vitest';
import {NativeCreditTariffService} from '../../src/application/billing/native-credit-tariff-service';
import {PgNativeCreditTariffRepository} from '../../src/infrastructure/billing/pg-native-credit-tariff-repository';
import {ConsumptionSettingsForbidden} from '../../src/application/billing/consumption-settings-service';
import {toOrgId} from '../../src/domain/org-id';
const row={package_id:'live-cn-smallest',region:'cn',currency:'CNY',amount_fen:12900,total_credits:10000,owner_type:'user',product_kind:'credit_topup',billing_cycle:null,included_seats:null,extra_seat_amount_fen:null,extra_seat_monthly_credits:null,sort_order:0};
const principal={orgId:toOrgId('operator-org'),userId:'operator'};
function setup(rows:unknown[]=[row]){
 const query=vi.fn(async()=>({rows}));const withTenant=vi.fn(async(_org:unknown,work:(session:{query:typeof query})=>Promise<unknown>)=>work({query}));
 const repo=new PgNativeCreditTariffRepository({withTenant} as never);
 const operator=vi.fn(async(user:string)=>user==='operator');
 return {service:new NativeCreditTariffService(repo,operator),query,withTenant};
}
it('reads the live CN credit_packages query regardless of storefront deployment market',async()=>{
 const f=setup(),catalog=await f.service.imagePricingBasis(principal,'target-org');
 expect(catalog).toMatchObject({market:'cn',products:[{sku:row.package_id,amountMinor:12900,credits:10000}]});expect(catalog.version).toMatch(/^catalog-cn-[a-f0-9]{64}$/);
 expect(f.withTenant).toHaveBeenCalledWith(toOrgId('target-org'),expect.any(Function));expect(f.query).toHaveBeenCalledWith(expect.stringContaining('FROM credit_packages'),['cn']);
 expect(f.query.mock.calls).toHaveLength(1);
});
it('refuses non-operators before any tenant catalog read',async()=>{
 const f=setup();await expect(f.service.imagePricingBasis({...principal,userId:'member'},'foreign-org')).rejects.toBeInstanceOf(ConsumptionSettingsForbidden);expect(f.withTenant).not.toHaveBeenCalled();
});
it.each([{rows:[]},{rows:[{...row,currency:'USD',region:'us'}]}])('fails absent or mismatched CN source',async({rows})=>{
 await expect(setup(rows).service.imagePricingBasis(principal,'org')).rejects.toThrow('image_cny_quote_unconfigured');
});
it('refuses ambiguous equal minimum live packages',async()=>{
 await expect(setup([row,{...row,package_id:'other'}]).service.imagePricingBasis(principal,'org')).rejects.toThrow('image_cny_quote_ambiguous');
});
