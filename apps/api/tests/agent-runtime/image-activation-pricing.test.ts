import {expect,it} from 'vitest';
import {imageMarkup10Price} from '../../src/domain/agent-run/image-activation-pricing';
const catalog={version:'live-test-version',market:'cn',enabledProviders:['wechat'],products:[{sku:'selected',kind:'credit_topup',currency:'CNY',amountMinor:12900,credits:10000}]};
it.each([[180000n,'1800000','13954'],[500000n,'5000000','38760'],[100000n,'1000000','7752']] as const)('uses exact10x cost and ceil hundredths from the selected existing quote', (cost,customer,hundredths)=>{
 expect(imageMarkup10Price(cost,catalog,'selected')).toMatchObject({customerMicros:customer,hundredthsPerImage:hundredths,markup:10,catalogVersion:catalog.version});
});
it('refuses missing or foreign-currency conversion sources',()=>{
 expect(()=>imageMarkup10Price(1n,catalog,'missing')).toThrow();expect(()=>imageMarkup10Price(1n,{...catalog,market:'us'},'selected')).toThrow();
});
it('does not round through IEEE floating point, including sub-cent and large values',()=>{
 const quote={...catalog,products:[{...catalog.products[0],amountMinor:100,credits:1}]};
 expect(imageMarkup10Price(1n,quote,'selected').hundredthsPerImage).toBe('1');
 expect(imageMarkup10Price(100000n,quote,'selected').hundredthsPerImage).toBe('100');
 expect(imageMarkup10Price(9007199254740993n,quote,'selected').customerMicros).toBe('90071992547409930');
});

it('selects the smallest current CNY topup and fails equal-price ambiguity',()=>{
 const larger={...catalog.products[0],sku:'larger',amountMinor:59900,credits:50000};
 expect(imageMarkup10Price(100000n,{...catalog,products:[larger,...catalog.products]}).sku).toBe('selected');
 expect(()=>imageMarkup10Price(100000n,{...catalog,products:[...catalog.products,{...catalog.products[0],sku:'duplicate'}]})).toThrow('AMBIGUOUS');
});
