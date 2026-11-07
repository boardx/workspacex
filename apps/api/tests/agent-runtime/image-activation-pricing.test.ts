import {expect,it} from 'vitest';
import {imageFixedCnyPrice} from '../../src/domain/agent-run/image-activation-pricing';
const catalog={version:'live-test-version',market:'cn',enabledProviders:['wechat'],products:[{sku:'selected',kind:'credit_topup',currency:'CNY',amountMinor:12900,credits:10000}]};
it.each([[250000n,'250000','1938'],[500000n,'500000','3876'],[1000000n,'1000000','7752']] as const)('uses fixed customer prices and ceil hundredths from the selected existing quote', (cost,customer,hundredths)=>{
 expect(imageFixedCnyPrice(cost,catalog,'selected')).toMatchObject({customerMicros:customer,hundredthsPerImage:hundredths,pricing:'fixed-customer-price',catalogVersion:catalog.version});
});
it('refuses missing or foreign-currency conversion sources',()=>{
 expect(()=>imageFixedCnyPrice(1n,catalog,'missing')).toThrow();expect(()=>imageFixedCnyPrice(1n,{...catalog,market:'us'},'selected')).toThrow();
});
it('does not round through IEEE floating point, including sub-cent and large values',()=>{
 const quote={...catalog,products:[{...catalog.products[0],amountMinor:100,credits:1}]};
 expect(imageFixedCnyPrice(1n,quote,'selected').hundredthsPerImage).toBe('1');
 expect(imageFixedCnyPrice(100000n,quote,'selected').hundredthsPerImage).toBe('10');
 expect(imageFixedCnyPrice(9007199254740993n,quote,'selected').customerMicros).toBe('9007199254740993');
});

it('selects the smallest current CNY topup and fails equal-price ambiguity',()=>{
 const larger={...catalog.products[0],sku:'larger',amountMinor:59900,credits:50000};
 expect(imageFixedCnyPrice(100000n,{...catalog,products:[larger,...catalog.products]}).sku).toBe('selected');
 expect(()=>imageFixedCnyPrice(100000n,{...catalog,products:[...catalog.products,{...catalog.products[0],sku:'duplicate'}]})).toThrow('AMBIGUOUS');
});
