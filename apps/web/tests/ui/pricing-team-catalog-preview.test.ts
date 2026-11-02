import {expect,it} from "vitest";
import {TeamCatalog} from "@repo/contracts/billing-team";
import {previewTeamCatalog,previewSeatQuote} from "@/components/billing/pricing-preview-data";
it.each(["cn","us","devapp"] as const)("uses one strict organization catalog for %s Team quotes",region=>{
 const catalog=previewTeamCatalog(region);expect(TeamCatalog.parse(catalog)).toEqual(catalog);
 expect(catalog.products).toHaveLength(5);
 for(const cycle of ["month","year"] as const){
  const quote=previewSeatQuote(region,cycle,2,region==="us"?"stripe":"wechat");
  const product=catalog.products.find(p=>p.kind==="subscription"&&p.cycle===cycle);
  expect(product?.sku).toBe(quote.sku);expect(quote.catalogVersion).toBe(catalog.version);expect(quote.orgId).toBe(catalog.orgId);
  expect(product?.currency).toBe(quote.currency);
  if(!product||product.kind!=="subscription")throw Error("subscription_product_required");
  expect(product.monthlyCredits).toBe(100000);expect(product.includedSeats).toBe(5);
  expect(quote.amountMinor).toBe(product.additionalSeatAmountMinor);
 }
});
it("only uses channels present in the selected mock catalog",()=>{
 expect(()=>previewSeatQuote("cn","month",1,"stripe")).toThrow();
 expect(()=>previewSeatQuote("us","month",1,"wechat")).toThrow();
 expect(previewSeatQuote("devapp","month",1,"stripe").currency).toBe("CNY");
});
