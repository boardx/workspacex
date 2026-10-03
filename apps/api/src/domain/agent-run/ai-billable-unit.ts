/** Native usage retains its actual dimension. There is deliberately no conversion to Tokens. */
export type AiNativeUnit="image"|"pixel"|"millisecond"|"microsecond"|"character"|"request";
export type AiBillableUsage=
 |{readonly kind:"token";readonly input:bigint|null;readonly output:bigint|null;readonly cachedInput:bigint|null;readonly reasoningOutput:bigint|null;readonly source:"reported"|"unknown"}
 |{readonly kind:"native";readonly unit:AiNativeUnit;readonly quantity:bigint|null;readonly source:"reported"|"unknown"};
export interface AiNativePrice {readonly unit:AiNativeUnit;readonly quantum:bigint;readonly microsPerQuantum:bigint;readonly currency:string;readonly version:string;}
const units:readonly AiNativeUnit[]=["image","pixel","millisecond","microsecond","character","request"];
/** Exact decimal ingestion, e.g. provider seconds ×1000 or ×1000000. Never rounds down. */
export function parseExactNativeDecimal(value:string,decimalPlaces:number):bigint|null{
 if(!Number.isSafeInteger(decimalPlaces)||decimalPlaces<0||decimalPlaces>6)throw new Error("INVALID_AI_NATIVE_SCALE");
 if(!/^(0|[1-9]\d*)(\.\d+)?$/.test(value))return null;
 const [integer,fraction=""]=value.split(".");
 if(fraction.length>decimalPlaces&&/[1-9]/.test(fraction.slice(decimalPlaces)))return null;
 const result=BigInt(integer!)*10n**BigInt(decimalPlaces)+BigInt((fraction.slice(0,decimalPlaces).padEnd(decimalPlaces,"0"))||"0");
 return result<=9223372036854775807n?result:null;
}
/** Unknown native amount stays unknown cost, never a free/zero-Token event. */
export function priceNativeAiUsage(price:AiNativePrice,usage:Extract<AiBillableUsage,{kind:"native"}>):bigint|null{
 if(!units.includes(price.unit)||price.unit!==usage.unit||price.quantum<=0n||price.microsPerQuantum<0n||!price.version||!/^[A-Z]{3}$/.test(price.currency)
  ||(usage.quantity!==null&&usage.quantity<0n)||(usage.source==="unknown"&&usage.quantity!==null)||(usage.source==="reported"&&usage.quantity===null))throw new Error("INVALID_AI_NATIVE_PRICE_OR_USAGE");
 if(usage.quantity===null)return null;
 const cost=(usage.quantity*price.microsPerQuantum+price.quantum-1n)/price.quantum;
 if(cost>9223372036854775807n)throw new Error("AI_NATIVE_COST_UNREPRESENTABLE");
 return cost;
}
