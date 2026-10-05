/** Exact decimal money conversion. Never use floating point for budget boundaries. */
const scale=1_000_000n;
const maximumMicros=9_223_372_036_854_775_807n;
export function modelTestAmountToMicros(value:string):string|null {
 const match=/^(0|[1-9]\d{0,12})(?:\.(\d{1,6}))?$/.exec(value.trim());
 if(!match)return null;
 const micros=BigInt(match[1]!)*scale+BigInt((match[2]??"").padEnd(6,"0"));
 return micros>0n&&micros<=maximumMicros?micros.toString():null;
}
export function modelTestMicrosToAmount(value:string):string|null {
 if(!/^(0|[1-9]\d{0,18})$/.test(value))return null;
 const micros=BigInt(value);if(micros>maximumMicros)return null;
 const whole=(micros/scale).toString(),fraction=(micros%scale).toString().padStart(6,"0").replace(/0+$/,"");
 return fraction?`${whole}.${fraction}`:whole;
}
