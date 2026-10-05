import {describe,it,expect} from "vitest";
import {parseExactNativeDecimal,priceNativeAiUsage} from "../../src/domain/agent-run/ai-billable-unit";
describe("native units do not fabricate tokens",()=>{
 it("keeps reported audio fractional seconds exact and rejects precision loss/float strings",()=>{
  expect(parseExactNativeDecimal("1.234",3)).toBe(1234n);expect(parseExactNativeDecimal("1.234567",6)).toBe(1234567n);
  expect(parseExactNativeDecimal("1.234000",3)).toBe(1234n);expect(parseExactNativeDecimal("1.234001",3)).toBeNull();
  for(const bad of ["NaN","Infinity","-1","1e3","01",".3"])expect(parseExactNativeDecimal(bad,3)).toBeNull();
 });
 it("prices declared milliseconds/images/characters with explicit quantum and upward cost rounding",()=>{
  const price={unit:"millisecond" as const,quantum:1000n,microsPerQuantum:3n,currency:"CNY",version:"v"};
  expect(priceNativeAiUsage(price,{kind:"native",unit:"millisecond",quantity:1234n,source:"reported"})).toBe(4n);
  expect(priceNativeAiUsage({...price,unit:"image",quantum:1n,microsPerQuantum:300n},{kind:"native",unit:"image",quantity:2n,source:"reported"})).toBe(600n);
 });
 it("unknown stays null and incompatible units/prices cannot be settled",()=>{
  const price={unit:"image" as const,quantum:1n,microsPerQuantum:3n,currency:"CNY",version:"v"};
  expect(priceNativeAiUsage(price,{kind:"native",unit:"image",quantity:null,source:"unknown"})).toBeNull();
  expect(()=>priceNativeAiUsage(price,{kind:"native",unit:"pixel",quantity:100n,source:"reported"})).toThrow();
  expect(()=>priceNativeAiUsage(price,{kind:"native",unit:"image",quantity:0n,source:"unknown"})).toThrow();
 });
});
