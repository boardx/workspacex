import {PricingCatalog} from '@repo/contracts/billing-pricing';
/** An explicit live credit SKU is the exchange source; never invent a universal CNY peg. */
export function imageFixedCnyPrice(customerMicros:bigint,rawCatalog:unknown,sku?:string){
 const catalog=PricingCatalog.parse(rawCatalog);
 if(catalog.market!=='cn')throw new Error('IMAGE_CNY_CREDIT_QUOTE_REQUIRED');
 const topups=catalog.products.filter(row=>row.kind==='credit_topup'&&row.currency==='CNY').sort((a,b)=>a.amountMinor-b.amountMinor);
 const product=topups[0];
 if(!product)throw new Error('IMAGE_CNY_CREDIT_QUOTE_REQUIRED');
 if(topups[1]?.amountMinor===product.amountMinor||sku&&product.sku!==sku)throw new Error('IMAGE_MINIMUM_CNY_CREDIT_QUOTE_AMBIGUOUS');
 if(catalog.market!=='cn'||!product||product.kind!=='credit_topup'||product.currency!=='CNY'||customerMicros<=0n)throw new Error('IMAGE_CNY_CREDIT_QUOTE_REQUIRED');
 const numerator=customerMicros*BigInt(product.credits)*100n,denominator=BigInt(product.amountMinor)*10000n;
 const hundredths=(numerator+denominator-1n)/denominator;
 return {region:'cn-beijing',currency:'CNY',pricing:'fixed-customer-price',customerMicros:customerMicros.toString(),catalogVersion:catalog.version,sku:product.sku,amountMinor:product.amountMinor,credits:product.credits,rounding:'ceil-to-credit-hundredth',hundredthsPerImage:hundredths.toString()};
}
